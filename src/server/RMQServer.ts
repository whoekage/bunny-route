// ./src/server/RMQServer.ts
import * as amqp from 'amqplib';
import { ConsumeMessage } from 'amqplib';
import { RMQConnectionManager } from '../core/RMQConnectionManager';
import { HandlerRegistry } from '../core/HandlerRegistry';
import { MiddlewareManager, MiddlewareFunction } from '../core/MiddlewareManager';
import { RMQServerOptions, HandlerOptions, ListenOptions, RMQServer as IRMQServer } from '../interfaces/server';
import { HandlerFunction, RetryOptions } from '../interfaces/common';
import { validateExchange, assertExchange } from '../utils/exchangeUtils';

export class RMQServer implements IRMQServer {
    private appName: string;
    private exchange: string;
    private connectionManager: RMQConnectionManager;
    private handlerRegistry: HandlerRegistry;
    private channel: amqp.Channel | null = null;
    private defaultRetryOptions: Required<RetryOptions>;
    private mainQueueName: string;
    private retryExchangeName: string;
    private retryQueueName: string;
    private dlqName: string;
    private middlewareManager: MiddlewareManager;

    // For reconnection
    private prefetch: number | null = null;
    private consumerTag: string | null = null;
    private isListening: boolean = false;

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
        this.retryExchangeName = `${this.exchange}.retry`;
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
            const result = await channel.consume(
                this.mainQueueName,
                this.handleMessage.bind(this),
                { noAck: false }
            );
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
        const result = await this.channel!.consume(
            this.mainQueueName,
            this.handleMessage.bind(this),
            { noAck: false }
        );
        this.consumerTag = result.consumerTag;

        console.log(`[RMQServer] '${this.appName}' is listening for messages...`);
    }

    private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
        if (!msg || !this.channel) return;

        const headers = msg.properties.headers || {};
        const retryCount = headers['x-retry-count'] ? parseInt(headers['x-retry-count']) : 0;
        const originalRoutingKey = msg.fields.routingKey;

        const registeredHandler = this.handlerRegistry.getHandler(originalRoutingKey);

        if (registeredHandler) {
            const { handler, options } = registeredHandler;

            let content;
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
                    this.channel.sendToQueue(
                        msg.properties.replyTo,
                        Buffer.from(JSON.stringify(response)),
                        {
                            correlationId: msg.properties.correlationId,
                        }
                    );
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

    public async close(): Promise<void> {
        this.isListening = false;

        if (this.channel) {
            try {
                // Cancel consumer first
                if (this.consumerTag) {
                    await this.channel.cancel(this.consumerTag);
                    this.consumerTag = null;
                }

                // Unregister channel from connection manager
                this.connectionManager.unregisterChannel(this.channel);

                await this.channel.close();
                this.channel = null;
            } catch (error) {
                if (error instanceof Error && error.message !== 'Channel closed') {
                    throw error;
                }
            }
        }
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
