// ./src/server/RMQServer.ts
import type * as amqp from 'amqplib';
import type { ConsumeMessage } from 'amqplib';
import { HandlerRegistry } from '../core/HandlerRegistry';
import { type MiddlewareFunction, MiddlewareManager } from '../core/MiddlewareManager';
import { RMQConnectionManager } from '../core/RMQConnectionManager';
import type {
  HandlerFunction,
  RetryOptions,
  ShutdownOptions,
  ShutdownResult,
} from '../interfaces/common';
import type {
  HandlerOptions,
  RMQServer as IRMQServer,
  ListenOptions,
  RMQServerOptions,
} from '../interfaces/server';
import { assertExchange, validateExchange } from '../utils/exchangeUtils';

export class RMQServer implements IRMQServer {
  private appName: string;
  private exchange: string;
  private connectionManager: RMQConnectionManager;
  private handlerRegistry: HandlerRegistry;
  private channel: amqp.Channel | null = null;
  private defaultRetryOptions: Required<RetryOptions>;
  private mainQueueName: string;
  private retryQueueName: string;
  private dlqName: string;
  private middlewareManager: MiddlewareManager;

  // For reconnection
  private prefetch: number | null = null;
  private consumerTag: string | null = null;
  private isListening: boolean = false;

  // For graceful shutdown - tracks currently executing message handlers
  private inFlightHandlers: Set<Promise<void>> = new Set();

  /**
   * Connection events emitter
   * Use this to subscribe to connection lifecycle events:
   * - 'connected' - connection established
   * - 'disconnected' - connection lost
   * - 'reconnecting' - attempting to reconnect (attempt, delayMs)
   * - 'reconnected' - successfully reconnected
   * - 'error' - non-recoverable error
   */
  public readonly connection: RMQConnectionManager;

  constructor(options: RMQServerOptions) {
    if (!options.appName && !options.exchange) {
      throw new Error('Either appName or exchange must be provided');
    }
    this.exchange = options.exchange ?? options.appName;
    this.appName = options.appName;

    // Pass heartbeat and reconnect options to ConnectionManager
    this.connectionManager = RMQConnectionManager.getInstance(options.uri, {
      heartbeat: options.heartbeat,
      reconnect: options.reconnect,
    });

    // Expose connection for event subscription
    this.connection = this.connectionManager;

    this.handlerRegistry = new HandlerRegistry();
    this.defaultRetryOptions = {
      maxRetries: options.retryOptions?.maxRetries ?? 3,
      retryTTL: options.retryOptions?.retryTTL ?? 5000,
      enabled: options.retryOptions?.enabled ?? false,
    };
    this.mainQueueName = `${this.appName}`;
    this.retryQueueName = `${this.mainQueueName}.retry`;
    this.dlqName = `${this.mainQueueName}.dlq`;
    validateExchange(this.exchange);
    this.middlewareManager = new MiddlewareManager();
  }

  /**
   * Setup channel - called on initial connection and after each reconnect
   */
  private async setupChannel(channel: amqp.Channel): Promise<void> {
    this.channel = channel;

    // Setup exchange
    await assertExchange(channel, this.exchange);

    // Setup DLQ
    await channel.assertQueue(this.dlqName, { durable: true });

    // Setup retry queue
    await channel.assertQueue(this.retryQueueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchange,
      },
      messageTtl: this.defaultRetryOptions.retryTTL,
    });

    await channel.bindQueue(this.retryQueueName, this.exchange, '#');

    // Setup main queue
    await channel.assertQueue(this.mainQueueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.exchange,
        'x-dead-letter-routing-key': '#',
      },
    });

    // Bind all routing keys
    for (const routingKey of this.handlerRegistry.getRoutingKeys()) {
      await channel.bindQueue(this.mainQueueName, this.exchange, routingKey);
    }

    // Apply prefetch if set
    if (this.prefetch) {
      channel.prefetch(this.prefetch);
    }

    // Re-start consumer if was listening
    if (this.isListening) {
      const result = await channel.consume(this.mainQueueName, this.handleMessage.bind(this), {
        noAck: false,
      });
      this.consumerTag = result.consumerTag;
      console.log(`[RMQServer] Consumer re-established for '${this.appName}'`);
    }
  }

  /**
   * Register a message handler for a routing key
   */
  public on(routingKey: string, handler: HandlerFunction, options: HandlerOptions = {}): void {
    this.handlerRegistry.register(routingKey, handler, options);
  }

  public async listen(options?: ListenOptions): Promise<void> {
    // Store prefetch for reconnection
    if (options?.prefetch) {
      this.prefetch = options.prefetch;
    }

    // Create channel with setup callback for reconnection
    await this.connectionManager.createChannel(this.setupChannel.bind(this));

    // Start consuming
    this.isListening = true;
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }
    const result = await this.channel.consume(this.mainQueueName, this.handleMessage.bind(this), {
      noAck: false,
    });
    this.consumerTag = result.consumerTag;

    console.log(`[RMQServer] '${this.appName}' is listening for messages...`);
  }

  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    // Track this handler for graceful shutdown
    const handlerPromise = this.processMessage(msg);
    this.inFlightHandlers.add(handlerPromise);

    try {
      await handlerPromise;
    } finally {
      this.inFlightHandlers.delete(handlerPromise);
    }
  }

  private async processMessage(msg: ConsumeMessage): Promise<void> {
    if (!this.channel) return;

    const headers = msg.properties.headers || {};
    const retryCount = headers['x-retry-count'] ? parseInt(headers['x-retry-count'], 10) : 0;
    const originalRoutingKey = msg.fields.routingKey;

    const registeredHandler = this.handlerRegistry.getHandler(originalRoutingKey);

    if (registeredHandler) {
      const { handler, options } = registeredHandler;

      let content: unknown;
      try {
        content = JSON.parse(msg.content.toString());
      } catch {
        console.error(`[RMQServer] Failed to parse message content for '${originalRoutingKey}'`);
        this.channel.ack(msg);
        return;
      }

      const context = { content, routingKey: originalRoutingKey, headers };

      const reply = (response: any) => {
        if (msg.properties.replyTo && msg.properties.correlationId && this.channel) {
          this.channel.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify(response)), {
            correlationId: msg.properties.correlationId,
          });
        }
      };

      const composedMiddleware = this.middlewareManager.compose(handler);

      const retryOptions = {
        maxRetries: options.maxRetries ?? this.defaultRetryOptions.maxRetries,
        retryTTL: options.retryTTL ?? this.defaultRetryOptions.retryTTL,
        enabled: options.retryEnabled ?? this.defaultRetryOptions.enabled,
      };

      try {
        await composedMiddleware(context, async () => {}, reply);
        this.channel.ack(msg);
      } catch (error) {
        console.error(`[RMQServer] Error processing '${originalRoutingKey}':`, error);

        if (retryOptions.enabled && retryCount < retryOptions.maxRetries) {
          headers['x-retry-count'] = retryCount + 1;
          headers['x-original-routing-key'] = originalRoutingKey;
          this.channel.publish(this.exchange, originalRoutingKey, msg.content, {
            headers,
            persistent: true,
            expiration: retryOptions.retryTTL.toString(),
          });
          this.channel.ack(msg);
        } else {
          await this.sendToDLQ(msg);
          this.channel.ack(msg);
        }
      }
    } else {
      console.warn(`[RMQServer] No handler for routingKey: ${originalRoutingKey}`);
      this.channel.ack(msg);
    }
  }

  private async sendToDLQ(msg: ConsumeMessage): Promise<void> {
    if (!this.channel) return;

    console.log(`[RMQServer] Sending message to DLQ: ${msg.fields.routingKey}`);
    this.channel.sendToQueue(this.dlqName, msg.content, {
      headers: msg.properties.headers,
      persistent: true,
    });
  }

  /**
   * Gracefully shutdown the server
   * @param options.timeout - Max time to wait for in-flight handlers (default: 30000ms)
   * @param options.force - If true, don't wait for handlers (default: false)
   * @returns ShutdownResult with success status and pending handler count
   */
  public async shutdown(options: ShutdownOptions = {}): Promise<ShutdownResult> {
    const timeout = options.timeout ?? 30000;
    const force = options.force ?? false;

    this.isListening = false;

    // 1. Cancel consumer to stop receiving new messages
    if (this.channel && this.consumerTag) {
      try {
        await this.channel.cancel(this.consumerTag);
        this.consumerTag = null;
      } catch {
        // Channel may already be closed
      }
    }

    // 2. Wait for in-flight handlers to complete (unless force)
    let timedOut = false;
    if (!force && this.inFlightHandlers.size > 0) {
      const startTime = Date.now();

      while (this.inFlightHandlers.size > 0) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeout) {
          timedOut = true;
          console.warn(
            `[RMQServer] Shutdown timeout: ${this.inFlightHandlers.size} handlers still in-flight`,
          );
          break;
        }

        // Wait for either all handlers to complete or a short interval
        await Promise.race([
          Promise.all([...this.inFlightHandlers]),
          new Promise((r) => setTimeout(r, 100)),
        ]);
      }
    }

    const pendingCount = this.inFlightHandlers.size;

    // 3. Close channel
    if (this.channel) {
      this.connectionManager.unregisterChannel(this.channel);
      try {
        await this.channel.close();
      } catch (error) {
        // Ignore "Channel closed" and "Channel closing" errors (already closing)
        if (
          error instanceof Error &&
          !error.message.includes('Channel closed') &&
          !error.message.includes('Channel closing')
        ) {
          throw error;
        }
      }
      this.channel = null;
    }

    return {
      success: pendingCount === 0,
      pendingCount,
      timedOut,
    };
  }

  /**
   * Close the server immediately without waiting for in-flight handlers
   * @deprecated Use shutdown() for graceful shutdown
   */
  public async close(): Promise<void> {
    await this.shutdown({ timeout: 0, force: true });
  }

  public use(middleware: MiddlewareFunction): void {
    this.middlewareManager.use(middleware);
  }

  /**
   * Check if server is connected
   */
  public isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  /**
   * Get connection state
   */
  public getConnectionState(): string {
    return this.connectionManager.getState();
  }
}
