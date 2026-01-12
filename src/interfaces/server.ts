// ./src/interfaces/server.ts

import type { MiddlewareFunction } from '../core/MiddlewareManager';
import type {
  HandlerFunction,
  RetryOptions,
  RMQOptions,
  ShutdownOptions,
  ShutdownResult,
} from './common';
import type { ReconnectOptions } from './connection';

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
  shutdown(options?: ShutdownOptions): Promise<ShutdownResult>;
  close(): Promise<void>;
}
