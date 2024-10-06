// HandlerRegistry.ts
export type HandlerFunction = (context: { content: any; routingKey: string }, reply: (response: any) => void) => Promise<void>;

export interface HandlerOptions {
  maxRetries?: number;
  retryTTL?: number;
  retryEnabled?: boolean;
}

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