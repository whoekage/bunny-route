// ./src/client/RMQClient.ts
import * as amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { RMQClientOptions, SendOptions, RMQClient as IRMQClient } from '../interfaces/client';
import { ConnectionManager } from '../interfaces/common';
import { RMQConnectionManager } from '../core/RMQConnectionManager';
import { RMQTimeoutError, RMQPublishError, RMQConnectionError } from '../errors';

export class RMQClient implements IRMQClient {
  private exchange: string;
  private appName: string;
  private connectionManager: ConnectionManager;
  private channel: amqp.Channel | null = null;
  private replyQueue: amqp.Replies.AssertQueue | null = null;
  private responseEmitter: EventEmitter;

  constructor(private options: RMQClientOptions) {
    this.appName = options.appName;
    this.connectionManager = RMQConnectionManager.getInstance(options.uri);
    this.responseEmitter = new EventEmitter();
    this.responseEmitter.setMaxListeners(0);
    this.exchange = options.exchange || options.appName;
  }
  public static async connect(options: RMQClientOptions): Promise<RMQClient> {
    const client = new RMQClient(options);
    await client.connect();
    return client;
  }

  public async connect(): Promise<void> {
    this.channel = await this.connectionManager.createChannel();
    await this.channel.assertExchange(this.exchange, 'direct', { durable: true });
    this.replyQueue = await this.channel.assertQueue('', { exclusive: true });
    
    this.channel.consume(
      this.replyQueue.queue,
      (msg: amqp.ConsumeMessage | null) => {
        if (msg) {
          const correlationId = msg.properties.correlationId;
          const content = msg.content.toString();
          this.responseEmitter.emit(correlationId, content);
          this.channel!.ack(msg);
        }
      },
      { noAck: false }
    );
  }

  public async send<T>(routingKey: string, message: any, options: SendOptions = {}): Promise<T> {
    if (!this.channel) {
      throw new RMQConnectionError('Client not connected. Call connect() first.');
    }

    const correlationId = uuidv4();
    message.id = correlationId;
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;

      if (options.timeout !== null && options.timeout !== undefined) {
        timer = setTimeout(() => {
          this.responseEmitter.removeAllListeners(correlationId);
          reject(new RMQTimeoutError(`Request timed out after ${options.timeout}ms`));
        }, options.timeout);
      }

      const cleanupAndResolve = (content: string) => {
        if (timer) clearTimeout(timer);
        this.responseEmitter.removeAllListeners(correlationId);
        try {
          const response = JSON.parse(content);
          resolve(response);
        } catch (error) {
          reject(new Error('Failed to parse response'));
        }
      };

      this.responseEmitter.once(correlationId, cleanupAndResolve);

      try {
        const sent = this.channel!.publish(
          this.exchange,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            replyTo: this.replyQueue!.queue,
            correlationId,
            persistent: options.persistent ?? true,
          }
        );
        if (!sent) {
          throw new RMQPublishError('Channel\'s internal buffer is full');
        }
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.responseEmitter.removeAllListeners(correlationId);
        reject(error instanceof Error ? error : new Error('Unknown error during publish'));
      }
    });
  }

  public async close() {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
  }
}

export async function createRMQClient(options: RMQClientOptions): Promise<RMQClient> {
  const client = new RMQClient(options);
  await client.connect();
  return client;
}