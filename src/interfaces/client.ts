// src/interfaces/client.ts

import { RMQOptions } from './common';

export interface RMQClientOptions extends RMQOptions {}

export interface SendOptions {
  timeout?: number;
  persistent?: boolean;
}

export interface RMQClient {
  connect(): Promise<void>;
  send<T>(routingKey: string, message: any, options?: SendOptions): Promise<T>;
  close(): Promise<void>;
}