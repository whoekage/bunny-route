// ./src/server/RMQServer.ts
import * as amqp from 'amqplib';
import { ConsumeMessage } from 'amqplib';
import { RMQConnectionManager } from '../core/RMQConnectionManager';
import { HandlerRegistry } from '../core/HandlerRegistry';
import { MiddlewareManager, MiddlewareFunction } from '../core/MiddlewareManager';
import { RMQServerOptions, HandlerOptions, ListenOptions, RMQServer as IRMQServer } from '../interfaces/server';
import { HandlerFunction, RetryOptions, HandlerContext, ReplyFunction } from '../interfaces/common';
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

    constructor(options: RMQServerOptions) {
        if (!options.appName && !options.exchange) {
            throw new Error('Either appName or exchange must be provided');
        }
        this.exchange = options.exchange ?? options.appName;
        this.appName = options.appName;
        this.connectionManager = RMQConnectionManager.getInstance(options.uri);
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

    private async initialize() {
        this.channel = await this.connectionManager.createChannel();
    
        await assertExchange(this.channel, this.exchange);
    
        await this.channel!.assertQueue(this.dlqName, { durable: true });
    
        await this.channel!.assertQueue(this.retryQueueName, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': this.exchange,
            },
            messageTtl: this.defaultRetryOptions.retryTTL,
        });
    
        await this.channel!.bindQueue(this.retryQueueName, this.exchange, '#');
    
        await this.channel!.assertQueue(this.mainQueueName, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': this.exchange,
                'x-dead-letter-routing-key': '#',
            },
        });
    
        for (const routingKey of this.handlerRegistry.getRoutingKeys()) {
            await this.channel!.bindQueue(this.mainQueueName, this.exchange, routingKey);
        }
    }

    public on(routingKey: string, handler: HandlerFunction, options: HandlerOptions = {}) {
        this.handlerRegistry.register(routingKey, handler, options);
    }

    public async listen(options?: ListenOptions) {
        await this.initialize();

        if (options?.prefetch) {
            this.channel!.prefetch(options.prefetch);
        }

        await this.channel!.consume(this.mainQueueName, this.handleMessage.bind(this), { noAck: false });
        console.log(`RMQServer '${this.appName}' is listening for messages...`);
    }

    private async handleMessage(msg: ConsumeMessage | null) {
        if (msg) {
            const headers = msg.properties.headers || {};
            const retryCount = headers['x-retry-count'] ? parseInt(headers['x-retry-count']) : 0;
            const originalRoutingKey = msg.fields.routingKey;
    
            const registeredHandler = this.handlerRegistry.getHandler(originalRoutingKey);
    
            if (registeredHandler) {
                const { handler, options } = registeredHandler;
                const content = JSON.parse(msg.content.toString());
                const context = { content, routingKey: originalRoutingKey, headers };
    
                const reply = (response: any) => {
                    if (msg.properties.replyTo && msg.properties.correlationId) {
                        this.channel!.sendToQueue(
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
                    this.channel!.ack(msg);
                } catch (error) {
                    console.error(`Error processing routingKey '${originalRoutingKey}':`, error);
    
                    if (retryOptions.enabled && retryCount < retryOptions.maxRetries) {
                        headers['x-retry-count'] = retryCount + 1;
                        headers['x-original-routing-key'] = originalRoutingKey;
                        this.channel!.publish(this.exchange, originalRoutingKey, msg.content, {
                            headers,
                            persistent: true,
                            expiration: retryOptions.retryTTL.toString(),
                        });
                        this.channel!.ack(msg);
                    } else {
                        await this.sendToDLQ(msg);
                        this.channel!.ack(msg);
                    }
                }
            } else {
                console.warn(`No handler for routingKey: ${originalRoutingKey}`);
                this.channel!.ack(msg);
            }
        }
    }

    private async sendToDLQ(msg: ConsumeMessage) {
        console.log(`Sending message to DLQ: ${msg.fields.routingKey}`);
        this.channel!.sendToQueue(this.dlqName, msg.content, {
            headers: msg.properties.headers,
            persistent: true,
        });
    }

    public async close() {
        if (this.channel) {
            try {
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
}
