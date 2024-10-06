// RMQClient.ts
import * as amqp from 'amqplib';
import { RMQConnectionManager } from './RMQConnectionManager';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

interface RMQClientOptions {
  uri: string;
  appName: string;
}

export class RMQClient {
  private appName: string;
  private connectionManager: RMQConnectionManager;
  private channel: amqp.Channel | null = null;
  private replyQueue: amqp.Replies.AssertQueue | null = null;
  private responseEmitter: EventEmitter;

  private constructor(options: RMQClientOptions) {
    this.appName = options.appName;
    this.connectionManager = RMQConnectionManager.getInstance(options.uri);
    this.responseEmitter = new EventEmitter();
    this.responseEmitter.setMaxListeners(0);
  }

  public static async connect(options: RMQClientOptions): Promise<RMQClient> {
    const client = new RMQClient(options);
    await client.initialize();
    return client;
  }

  private async initialize() {
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

  public async send<T>(routingKey: string, message: any): Promise<T> {
    const correlationId = uuidv4();

    return new Promise<T>((resolve, reject) => {
      this.responseEmitter.once(correlationId, (content: string) => {
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
          persistent: true,
        }
      );
    });
  }

  public async close() {
    console.log({ channel: this.channel });
    if (this.channel) {
      try {
        await this.channel.close();
        this.channel = null;
      } catch (error) {
        console.log(error)
        if (error instanceof Error && error.message !== 'Channel closed') {
          throw error;
        }
      }
    }
    // Не закрываем connectionManager здесь
  }
}
