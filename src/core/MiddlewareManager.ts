import type { HandlerContext, HandlerFunction, ReplyFunction } from '../interfaces';

export type MiddlewareFunction = (
  context: HandlerContext,
  next: () => Promise<void>,
  reply: ReplyFunction,
) => Promise<void>;

export class MiddlewareManager {
  private middlewares: MiddlewareFunction[] = [];

  public use(middleware: MiddlewareFunction): void {
    this.middlewares.push(middleware);
  }

  public compose(handler: HandlerFunction): MiddlewareFunction {
    return async (context: HandlerContext, _next: () => Promise<void>, reply: ReplyFunction) => {
      let index = -1;

      const run = async () => {
        index++;
        if (index < this.middlewares.length) {
          await this.middlewares[index](context, run, reply);
        } else {
          await handler(context, reply);
        }
      };

      await run();
    };
  }
}
