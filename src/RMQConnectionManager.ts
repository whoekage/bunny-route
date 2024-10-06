// /src/RMQConnectionManager.ts
import amqp, { Connection, Channel } from 'amqplib';

export class RMQConnectionManager {
  private static instance: RMQConnectionManager;
  private connection!: Connection;
  private channels: Channel[] = [];
  private uri: string;

  private constructor(uri: string) {
    this.uri = uri;
  }

  public static getInstance(uri: string): RMQConnectionManager {
    if (!RMQConnectionManager.instance) {
      RMQConnectionManager.instance = new RMQConnectionManager(uri);
    }
    return RMQConnectionManager.instance;
  }

  public async getConnection(): Promise<Connection> {
    if (!this.connection) {
      this.connection = await amqp.connect(this.uri);
    }
    return this.connection;
  }

  public async createChannel(): Promise<Channel> {
    const connection = await this.getConnection();
    const channel = await connection.createChannel();
    this.channels.push(channel);
    return channel;
  }

  public async close(): Promise<void> {
    for (const channel of this.channels) {
      await channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }
}