// src/interfaces/client.ts

import { RMQOptions } from './common';

export interface RMQClientOptions extends RMQOptions {
  exchange?: string;
}

export interface SendOptions {
  timeout?: number | null;
  persistent?: boolean;
  nestCompatible?: boolean;
}

export interface RMQClient {
  connect(): Promise<void>;
  send<T>(routingKey: string, message: any, options?: SendOptions): Promise<T>;
  close(): Promise<void>;
}