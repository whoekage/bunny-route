// src/interfaces/client.ts

import type { RMQOptions, ShutdownOptions, ShutdownResult } from './common';

export interface RMQClientOptions extends RMQOptions {
  exchange?: string;
}

export interface SendOptions {
  timeout?: number | null;
  persistent?: boolean;
  nestCompatible?: boolean;
  headers?: Record<string, unknown>;
}

export interface RMQClient {
  connect(): Promise<void>;
  send<T>(routingKey: string, message: any, options?: SendOptions): Promise<T>;
  shutdown(options?: ShutdownOptions): Promise<ShutdownResult>;
  close(): Promise<void>;
}
