import { HandlerFunction } from '../interfaces/common';
import { HandlerOptions } from '../interfaces/server';

export interface RegisteredHandler {
  handler: HandlerFunction;
  options: HandlerOptions;
}

export class HandlerRegistry {
  private handlers: Map<string, RegisteredHandler> = new Map();

  public register(routingKey: string, handler: HandlerFunction, options: HandlerOptions = {}): void {
    this.handlers.set(routingKey, { handler, options });
  }

  public getHandler(routingKey: string): RegisteredHandler | undefined {
    return this.handlers.get(routingKey);
  }

  public getRoutingKeys(): string[] {
    return Array.from(this.handlers.keys());
  }
}