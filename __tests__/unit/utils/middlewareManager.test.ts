import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { MiddlewareManager, MiddlewareFunction } from '../../../src/core/MiddlewareManager';
import { HandlerContext, ReplyFunction, HandlerFunction } from '../../../src/interfaces/common';

describe('MiddlewareManager', () => {
  let middlewareManager: MiddlewareManager;
  let context: HandlerContext;
  let reply: ReplyFunction;
  let handler: Mock<HandlerFunction>;

  beforeEach(() => {
    middlewareManager = new MiddlewareManager();
    context = { content: {}, routingKey: 'test.routing.key', headers: {} };
    reply = vi.fn();
    handler = vi.fn().mockResolvedValue(undefined);
  });

  it('should call the handler without any middleware', async () => {
    const composedMiddleware = middlewareManager.compose(handler);

    await composedMiddleware(context, async () => {}, reply);

    expect(handler).toHaveBeenCalledWith(context, reply);
  });

  it('should execute middleware and handler in sequence', async () => {
    const middleware1 = vi.fn(async (ctx, next, rep) => {
      ctx.headers['middleware1'] = true;
      await next();
    });
    const middleware2 = vi.fn(async (ctx, next, rep) => {
      ctx.headers['middleware2'] = true;
      await next();
    });

    middlewareManager.use(middleware1);
    middlewareManager.use(middleware2);

    const composedMiddleware = middlewareManager.compose(handler);

    await composedMiddleware(context, async () => {}, reply);

    expect(middleware1).toHaveBeenCalledWith(context, expect.any(Function), reply);
    expect(middleware2).toHaveBeenCalledWith(context, expect.any(Function), reply);
    expect(handler).toHaveBeenCalledWith(context, reply);
    expect(context.headers['middleware1']).toBe(true);
    expect(context.headers['middleware2']).toBe(true);
  });

  it('should skip subsequent middleware if next is not called', async () => {
    const middleware1 = vi.fn(async (ctx, next, rep) => {
      ctx.headers['middleware1'] = true;
      // Not calling next()
    });
    const middleware2 = vi.fn(async (ctx, next, rep) => {
      ctx.headers['middleware2'] = true;
      await next();
    });

    middlewareManager.use(middleware1);
    middlewareManager.use(middleware2);

    const composedMiddleware = middlewareManager.compose(handler);

    await composedMiddleware(context, async () => {}, reply);

    expect(middleware1).toHaveBeenCalled();
    expect(middleware2).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(context.headers['middleware1']).toBe(true);
    expect(context.headers['middleware2']).toBeUndefined();
  });

  it('should handle exceptions thrown in middleware', async () => {
    const errorMiddleware = vi.fn(async (ctx, next, rep) => {
      throw new Error('Middleware error');
    });
    const middleware2 = vi.fn(async (ctx, next, rep) => {
      await next();
    });

    middlewareManager.use(errorMiddleware);
    middlewareManager.use(middleware2);

    const composedMiddleware = middlewareManager.compose(handler);

    await expect(composedMiddleware(context, async () => {}, reply)).rejects.toThrow('Middleware error');

    expect(errorMiddleware).toHaveBeenCalled();
    expect(middleware2).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('should allow middleware to terminate the chain without calling next', async () => {
    const terminatingMiddleware = vi.fn(async (ctx, next, rep) => {
      ctx.headers['terminated'] = true;
      // Intentionally not calling next()
    });
    const middleware2 = vi.fn(async (ctx, next, rep) => {
      await next();
    });

    middlewareManager.use(terminatingMiddleware);
    middlewareManager.use(middleware2);

    const composedMiddleware = middlewareManager.compose(handler);

    await composedMiddleware(context, async () => {}, reply);

    expect(terminatingMiddleware).toHaveBeenCalled();
    expect(middleware2).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(context.headers['terminated']).toBe(true);
  });

  it('should allow middleware to use the reply function', async () => {
    const replyMiddleware = vi.fn(async (ctx, next, rep) => {
      rep({ message: 'Response from middleware' });
      await next();
    });

    middlewareManager.use(replyMiddleware);

    const composedMiddleware = middlewareManager.compose(handler);

    await composedMiddleware(context, async () => {}, reply);

    expect(replyMiddleware).toHaveBeenCalledWith(context, expect.any(Function), reply);
    expect(reply).toHaveBeenCalledWith({ message: 'Response from middleware' });
    expect(handler).toHaveBeenCalled();
  });
});
