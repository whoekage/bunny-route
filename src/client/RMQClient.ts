// ./src/client/RMQClient.ts
import * as amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { RMQClientOptions, SendOptions, RMQClient as IRMQClient } from '../interfaces/client';
import { ConnectionManager } from '../interfaces/common';
import { RMQConnectionManager } from '../core/RMQConnectionManager';


export class RMQClient implements IRMQClient {
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
  }

  public async connect(): Promise<void> {
    this.channel = await this.connectionManager.createChannel();
    await this.channel.assertExchange(this.appName, 'direct', { durable: true });
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
      throw new Error('Client not connected. Call connect() first.');
    }

    const correlationId = uuidv4();

    return new Promise<T>((resolve, reject) => {
      const timeout = options.timeout || 30000; // Default 30 seconds timeout
      const timer = setTimeout(() => {
        this.responseEmitter.removeAllListeners(correlationId);
        reject(new Error('Request timed out'));
      }, timeout);

      this.responseEmitter.once(correlationId, (content: string) => {
        clearTimeout(timer);
        const response = JSON.parse(content);
        resolve(response);
      });

      this.channel!.publish(
        this.appName,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          replyTo: this.replyQueue!.queue,
          correlationId,
          persistent: options.persistent ?? true,
        }
      );
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