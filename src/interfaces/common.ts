// ./src/interfaces/common.ts
import { Connection, Channel, Options } from 'amqplib';

export interface RMQOptions {
  uri: string;
  appName: string;
}

export interface RetryOptions {
  maxRetries: number;
  retryTTL: number;
  enabled: boolean;
}

export interface HandlerContext {
  content: any;
  routingKey: string;
  headers: { [key: string]: any };
}

export type ReplyFunction = (response: any) => void;

export type HandlerFunction = (context: HandlerContext, reply: ReplyFunction) => Promise<void>;

export interface ConnectionManager {
  getConnection(): Promise<Connection>;
  createChannel(): Promise<Channel>;
  close(): Promise<void>;
}

export interface QueueOptions extends Options.AssertQueue {}

export interface ExchangeOptions extends Options.AssertExchange {}