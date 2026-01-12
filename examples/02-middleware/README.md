# Middleware Example

Express-style middleware for cross-cutting concerns like logging, authentication, and error handling.

## What You'll Learn

- Creating and composing middleware functions
- Middleware execution order
- Error handling middleware
- Authentication/authorization patterns
- Request timing and logging

## Middleware Flow

```
Request → [Error Handler] → [Timing] → [Logging] → [Auth] → Handler → Response
              ▲                                              │
              └──────────── catches errors ◄─────────────────┘
```

## Middleware Signature

```typescript
type MiddlewareFunction = (
  ctx: HandlerContext,        // { content, routingKey, headers }
  next: () => Promise<void>,  // Call to proceed to next middleware
  reply: ReplyFunction        // Send response (short-circuits chain)
) => Promise<void>;
```

## Middleware Patterns

### 1. Error Handling (should be first)

```typescript
server.use(async (ctx, next, reply) => {
  try {
    await next();
  } catch (error) {
    console.error(`Error in ${ctx.routingKey}:`, error);
    reply({ error: error.message, code: 500 });
  }
});
```

### 2. Request Timing

```typescript
server.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.routingKey} took ${Date.now() - start}ms`);
});
```

### 3. Logging

```typescript
server.use(async (ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${ctx.routingKey}`, ctx.content);
  await next();
});
```

### 4. Authentication

```typescript
server.use(async (ctx, next, reply) => {
  // Skip auth for public routes
  if (ctx.routingKey.startsWith('public.')) {
    return next();
  }

  const token = ctx.headers['x-auth-token'];
  if (!token) {
    return reply({ error: 'Unauthorized', code: 401 });
  }

  // Validate token and attach user to context
  const user = await validateToken(token);
  if (!user) {
    return reply({ error: 'Invalid token', code: 403 });
  }

  (ctx as any).user = user;  // Attach for handlers
  await next();
});
```

### 5. Rate Limiting

```typescript
const requestCounts = new Map<string, number>();

server.use(async (ctx, next, reply) => {
  const clientId = ctx.headers['x-client-id'] || 'anonymous';
  const count = requestCounts.get(clientId) || 0;

  if (count > 100) {
    return reply({ error: 'Rate limited', code: 429 });
  }

  requestCounts.set(clientId, count + 1);
  await next();
});
```

## Execution Order

Middleware executes in the order they are registered:

```typescript
server.use(middleware1);  // First
server.use(middleware2);  // Second
server.use(middleware3);  // Third
// Then handler
```

**Important:** Error handling middleware should be registered FIRST so it can catch errors from all subsequent middleware and handlers.

## Short-Circuiting

Call `reply()` to stop the chain and send response immediately:

```typescript
server.use(async (ctx, next, reply) => {
  if (!ctx.headers['x-api-key']) {
    reply({ error: 'API key required' });  // Stops here
    return;  // Don't call next()
  }
  await next();
});
```

## Accessing Modified Context in Handlers

```typescript
// Middleware adds user
server.use(async (ctx, next) => {
  (ctx as any).user = { id: 1, role: 'admin' };
  await next();
});

// Handler uses it
server.on('protected.data', async (ctx, reply) => {
  const user = (ctx as any).user;
  reply({ data: 'secret', accessedBy: user.id });
});
```

## Running the Example

```bash
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/02-middleware/index.ts
```

## Expected Output

```
Server with middleware is ready

--- Public route (no auth required) ---
[log] Incoming: public.health {}
[timing] public.health completed in 1ms
Response: { status: 'ok', timestamp: '...' }

--- Protected route without token ---
[log] Incoming: protected.data {}
[timing] protected.data completed in 0ms
Response: { error: 'Unauthorized', code: 401 }

--- Protected route with valid token ---
[log] Incoming: protected.data {}
[timing] protected.data completed in 0ms
Response: { data: 'secret', accessedBy: 1 }

--- Route that throws error ---
[log] Incoming: error.test {}
[error] error.test: Error: Something went wrong!
Response: { error: 'Something went wrong!', code: 500 }
```

## Client: Sending Headers

```typescript
const result = await client.send(
  'protected.data',
  { some: 'data' },
  {
    timeout: 5000,
    headers: { 'x-auth-token': 'valid-token' }  // Custom headers
  }
);
```

## Next Steps

- [03-graceful-shutdown](../03-graceful-shutdown) - Production shutdown patterns
- [06-retry-dlq](../06-retry-dlq) - Error handling with retries
