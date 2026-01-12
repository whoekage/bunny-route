// ./src/interfaces/common.ts
import type { Channel, Connection, Options } from 'amqplib';

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

export interface ShutdownOptions {
  /** Timeout in milliseconds to wait for in-flight operations (default: 30000 for server, 5000 for client) */
  timeout?: number;
  /** If true, don't wait for in-flight handlers (default: false) */
  force?: boolean;
}

export interface ShutdownResult {
  /** True if all in-flight operations completed before timeout */
  success: boolean;
  /** Number of operations that were still pending at shutdown */
  pendingCount: number;
  /** True if shutdown timed out waiting for operations */
  timedOut: boolean;
}
