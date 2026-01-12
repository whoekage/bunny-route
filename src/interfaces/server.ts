// ./src/interfaces/server.ts
import { RMQOptions, HandlerFunction, RetryOptions, HandlerContext, ReplyFunction } from './common';
import { ReconnectOptions } from './connection';
import { MiddlewareFunction } from '../core/MiddlewareManager';

export interface RMQServerOptions extends RMQOptions {
  retryOptions?: Partial<RetryOptions>;
  exchange?: string;
  /** Heartbeat interval in seconds. Default: 10 */
  heartbeat?: number;
  /** Reconnection options */
  reconnect?: Partial<ReconnectOptions>;
}

export interface HandlerOptions {
  maxRetries?: number;
  retryTTL?: number;
  retryEnabled?: boolean;
}

export interface ListenOptions {
  prefetch?: number;
}

export interface RMQServer {
  on(routingKey: string, handler: HandlerFunction, options?: HandlerOptions): void;
  use(middleware: MiddlewareFunction): void;
  listen(options?: ListenOptions): Promise<void>;
  close(): Promise<void>;
}
