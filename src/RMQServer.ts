import * as amqp from 'amqplib';
import { ConsumeMessage } from 'amqplib';
import { RMQConnectionManager } from './RMQConnectionManager';
import { HandlerRegistry, HandlerFunction, HandlerOptions } from './HandlerRegistry';

interface RMQServerOptions {
    uri: string;
    appName: string;
    retryOptions?: RetryOptions;
}

interface RetryOptions {
    maxRetries?: number;
    retryTTL?: number; // В миллисекундах
    enabled?: boolean;
}

interface ListenOptions {
    prefetch?: number;
}

export class RMQServer {
    private appName: string;
    private connectionManager: RMQConnectionManager;
    private handlerRegistry: HandlerRegistry;
    private channel: amqp.Channel | null = null;
    private defaultRetryOptions: Required<RetryOptions>;
    private mainQueueName: string;
    private exchangeName: string;
    private retryExchangeName: string;
    private retryQueueName: string;
    private dlqName: string;

    constructor(options: RMQServerOptions) {
        this.appName = options.appName;
        this.connectionManager = RMQConnectionManager.getInstance(options.uri);
        this.handlerRegistry = new HandlerRegistry();
        this.defaultRetryOptions = {
            maxRetries: options.retryOptions?.maxRetries ?? 3,
            retryTTL: options.retryOptions?.retryTTL ?? 5000,
            enabled: options.retryOptions?.enabled ?? true,
        };
        this.mainQueueName = `${this.appName}`;
        this.exchangeName = `${this.appName}`;
        this.retryExchangeName = `${this.exchangeName}.retry`;
        this.retryQueueName = `${this.mainQueueName}.retry`;
        this.dlqName = `${this.mainQueueName}.dlq`;
    }

    private async initialize() {
        this.channel = await this.connectionManager.createChannel();
    
        // Declare the single exchange (shared by both main and retry queues)
        await this.channel!.assertExchange(this.exchangeName, 'direct', { durable: true });
    
        // DLQ (Dead Letter Queue) for failed messages that exceeded retry count
        await this.channel!.assertQueue(this.dlqName, { durable: true });
    
        // Retry Queue with TTL, re-routing back to the main exchange
        await this.channel!.assertQueue(this.retryQueueName, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': this.exchangeName, // Route back to the main exchange
            },
            messageTtl: this.defaultRetryOptions.retryTTL,
        });
    
        // Bind Retry Queue to the same exchange (single exchange)
        await this.channel!.bindQueue(this.retryQueueName, this.exchangeName, '#');
    
        // Main Queue with dead letter configuration to forward failed messages to the retry queue
        await this.channel!.assertQueue(this.mainQueueName, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': this.exchangeName, // Route to retry queue on failure
                'x-dead-letter-routing-key': '#',           // Same routing key for retry
            },
        });
    
        // Bind Main Queue to the single exchange
        for (const routingKey of this.handlerRegistry.getRoutingKeys()) {
            await this.channel!.bindQueue(this.mainQueueName, this.exchangeName, routingKey);
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
        console.log(`RMQServer '${this.appName}' слушает сообщения...`);
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
                const context = { content, routingKey: originalRoutingKey };
    
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
    
                const retryOptions = {
                    maxRetries: options.maxRetries ?? this.defaultRetryOptions.maxRetries,
                    retryTTL: options.retryTTL ?? this.defaultRetryOptions.retryTTL,
                    enabled: options.retryEnabled ?? this.defaultRetryOptions.enabled,
                };
    
                try {
                    await handler(context, reply);
                    this.channel!.ack(msg); // Acknowledge successful processing
                } catch (error) {
                    console.error(`Error processing routingKey '${originalRoutingKey}':`, error);
    
                    if (retryOptions.enabled && retryCount < retryOptions.maxRetries) {
                        console.log({
                            retryOptions,
                            retryCount
                        })
                        headers['x-retry-count'] = retryCount + 1;
                        headers['x-original-routing-key'] = originalRoutingKey;
                        console.log(`Retrying message for the ${retryCount + 1} time...`);
                        console.log({ headers });
                        // Send message to the same exchange (back to retry queue)
                        const published = this.channel!.publish(this.exchangeName, originalRoutingKey, msg.content, {
                            headers,
                            persistent: true,
                            expiration: retryOptions.retryTTL.toString(),
                        });
                        console.log({ published });
                        console.log(`Message sent to retry queue through the exchange: ${this.exchangeName} with routingKey: ${originalRoutingKey}`);
                        const queueInfo = await this.channel!.checkQueue(this.retryQueueName);
                        console.log(`Retry queue message count: ${queueInfo.messageCount}`);
                        this.channel!.ack(msg); // Acknowledge the current message
                    } else {
                        // Max retries reached, send to DLQ
                        await this.sendToDLQ(msg);
                        this.channel!.ack(msg); // Acknowledge message
                    }
                }
            } else {
                console.warn(`No handler for routingKey: ${originalRoutingKey}`);
                this.channel!.ack(msg); // Acknowledge to avoid looping
            }
        }
    }

    private async sendToDLQ(msg: ConsumeMessage) {
        this.channel!.sendToQueue(this.dlqName, msg.content, {
            headers: msg.properties.headers,
            persistent: true,
        });
    
        console.log(`Message sent to DLQ: ${this.dlqName}`);
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
}