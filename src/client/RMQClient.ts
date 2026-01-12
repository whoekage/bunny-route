// ./src/client/RMQClient.ts

import { EventEmitter } from 'node:events';
import type * as amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { RMQConnectionManager } from '../core/RMQConnectionManager';
import { RMQConnectionError, RMQPublishError, RMQTimeoutError } from '../errors';
import type { RMQClient as IRMQClient, RMQClientOptions, SendOptions } from '../interfaces/client';
import type { ShutdownOptions, ShutdownResult } from '../interfaces/common';
import { assertExchange, validateExchange } from '../utils/exchangeUtils';

export class RMQClient extends EventEmitter implements IRMQClient {
  private exchange: string;
  private appName: string;
  private connectionManager: RMQConnectionManager;
  private channel: amqp.Channel | null = null;
  private replyQueue: amqp.Replies.AssertQueue | null = null;
  private responseEmitter: EventEmitter;
  private isConnected: boolean = false;

  // For graceful shutdown - tracks pending RPC requests
  private pendingRequests: Map<
    string,
    { reject: (error: Error) => void; timer: NodeJS.Timeout | null }
  > = new Map();

  constructor(options: RMQClientOptions) {
    super();

    this.appName = options.appName;
    this.connectionManager = RMQConnectionManager.getInstance(options.uri);
    this.responseEmitter = new EventEmitter();
    this.responseEmitter.setMaxListeners(0);
    this.exchange = options.exchange ?? options.appName;
    validateExchange(this.exchange);

    // Listen to connection events
    this.setupConnectionListeners();
  }

  /**
   * Setup listeners for connection events
   */
  private setupConnectionListeners(): void {
    this.connectionManager.on('disconnected', (error) => {
      this.isConnected = false;
      this.emit('disconnected', error);
    });

    this.connectionManager.on('reconnecting', (attempt, delay) => {
      this.emit('reconnecting', attempt, delay);
    });

    this.connectionManager.on('reconnected', () => {
      this.isConnected = true;
      this.emit('reconnected');
    });

    this.connectionManager.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Setup channel - called on initial connection and after each reconnect
   */
  private async setupChannel(channel: amqp.Channel): Promise<void> {
    this.channel = channel;

    // Setup exchange
    await assertExchange(channel, this.exchange);

    // Create exclusive reply queue
    this.replyQueue = await channel.assertQueue('', { exclusive: true });

    // Setup consumer for RPC replies
    await channel.consume(
      this.replyQueue.queue,
      (msg: amqp.ConsumeMessage | null) => {
        if (msg && this.channel) {
          const correlationId = msg.properties.correlationId;
          const content = msg.content.toString();
          this.responseEmitter.emit(correlationId, content);
          this.channel.ack(msg);
        }
      },
      { noAck: false },
    );
  }

  public static async connect(options: RMQClientOptions): Promise<RMQClient> {
    const client = new RMQClient(options);
    await client.connect();
    return client;
  }

  public async connect(): Promise<void> {
    // Create channel with setup callback for reconnection
    await this.connectionManager.createChannel(this.setupChannel.bind(this));
    this.isConnected = true;
    this.emit('connected');
  }

  public async send<T>(routingKey: string, message: any, options: SendOptions = {}): Promise<T> {
    if (!this.channel || !this.isConnected) {
      throw new RMQConnectionError('Client not connected. Call connect() first.');
    }

    if (!this.replyQueue) {
      throw new RMQConnectionError('Reply queue not initialized.');
    }

    const correlationId = uuidv4();
    if (options.nestCompatible) {
      message.id = correlationId; // for Nest.js compatibility
    }

    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;

      // Track this request for graceful shutdown
      this.pendingRequests.set(correlationId, { reject, timer });

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.responseEmitter.removeAllListeners(correlationId);
        this.pendingRequests.delete(correlationId);
      };

      if (options.timeout !== null && options.timeout !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          reject(new RMQTimeoutError(`Request timed out after ${options.timeout}ms`));
        }, options.timeout);
        // Update timer reference in pending requests
        const pending = this.pendingRequests.get(correlationId);
        if (pending) pending.timer = timer;
      }

      const cleanupAndResolve = (content: string) => {
        cleanup();
        try {
          const response = JSON.parse(content);
          resolve(response);
        } catch {
          reject(new Error('Failed to parse response'));
        }
      };

      this.responseEmitter.once(correlationId, cleanupAndResolve);

      try {
        const sent = this.channel?.publish(
          this.exchange,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            replyTo: this.replyQueue?.queue,
            correlationId,
            persistent: options.persistent ?? true,
            headers: options.headers,
          },
        );
        if (!sent) {
          cleanup();
          reject(new RMQPublishError("Channel's internal buffer is full"));
        }
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('Unknown error during publish'));
      }
    });
  }

  /**
   * Gracefully shutdown the client
   * @param options.timeout - Max time to wait for pending requests (default: 5000ms)
   * @param options.force - If true, reject all pending requests immediately (default: true)
   * @returns ShutdownResult with success status and pending request count
   */
  public async shutdown(options: ShutdownOptions = {}): Promise<ShutdownResult> {
    const force = options.force ?? true;

    this.isConnected = false;

    // Reject all pending requests
    if (force) {
      for (const [correlationId, { timer, reject }] of this.pendingRequests) {
        if (timer) clearTimeout(timer);
        this.responseEmitter.removeAllListeners(correlationId);
        reject(new Error('Client shutdown: request cancelled'));
      }
    }

    const pendingCount = this.pendingRequests.size;
    this.pendingRequests.clear();

    // Close channel
    if (this.channel) {
      this.connectionManager.unregisterChannel(this.channel);
      try {
        await this.channel.close();
      } catch {
        // Ignore errors when closing
      }
      this.channel = null;
      this.replyQueue = null;
    }

    return {
      success: true,
      pendingCount,
      timedOut: false,
    };
  }

  /**
   * Close the client immediately, rejecting all pending requests
   * @deprecated Use shutdown() for graceful shutdown
   */
  public async close(): Promise<void> {
    await this.shutdown({ force: true });
  }

  /**
   * Check if client is connected
   */
  public getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get connection state
   */
  public getConnectionState(): string {
    return this.connectionManager.getState();
  }
}

export async function createRMQClient(options: RMQClientOptions): Promise<RMQClient> {
  const client = new RMQClient(options);
  await client.connect();
  return client;
}
