# RPC Patterns Example

Different communication patterns: request-reply, fire-and-forget, and timeout handling.

## What You'll Learn

- Request-Reply pattern (synchronous RPC)
- Fire-and-Forget pattern (async events)
- Timeout handling with `RMQTimeoutError`
- Error propagation through RPC
- Choosing the right pattern for your use case

## Communication Patterns

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Pattern 1: Request-Reply (RPC)                                               │
│                                                                              │
│   Client                         Server                                      │
│     │                              │                                         │
│     │──── user.create { ... } ────►│                                         │
│     │                              │ process                                 │
│     │◄─── { userId: 123 } ─────────│                                         │
│     │                              │                                         │
│   await response                   │                                         │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Pattern 2: Fire-and-Forget                                                   │
│                                                                              │
│   Client                         Server                                      │
│     │                              │                                         │
│     │──── log.event { ... } ──────►│                                         │
│     │                              │ process                                 │
│     │ (continues immediately)      │                                         │
│     │                              │                                         │
│   no await / .catch(() => {})     │                                         │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Pattern 3: Timeout                                                           │
│                                                                              │
│   Client                         Server                                      │
│     │                              │                                         │
│     │──── slow.process ───────────►│                                         │
│     │      timeout: 1s             │ processing...                           │
│     │                              │ (takes 3s)                              │
│     │◄─── RMQTimeoutError ─────────│                                         │
│     │      (after 1s)              │                                         │
│     │                              │ ...still processing                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Pattern Comparison

| Pattern | Use Case | Client Code | Server Handler |
|---------|----------|-------------|----------------|
| Request-Reply | Need response | `await client.send(...)` | Must call `reply()` |
| Fire-and-Forget | Events, logs | `client.send(...).catch(() => {})` | No `reply()` needed |
| Timeout | Bounded wait | `{ timeout: 5000 }` | Same as RPC |

## Pattern 1: Request-Reply (RPC)

The default pattern - send a message and wait for response.

```typescript
// Client
const response = await client.send(
  'user.create',
  { name: 'Alice', email: 'alice@example.com' },
  { timeout: 5000 }  // Wait up to 5 seconds
);
console.log(response);  // { userId: 123, success: true }

// Server
server.on('user.create', async (ctx, reply) => {
  const user = await createUser(ctx.content);
  reply({ userId: user.id, success: true });  // Must call reply!
});
```

### When to Use

- CRUD operations
- Queries that need results
- Operations where you need confirmation
- Synchronous workflows

## Pattern 2: Fire-and-Forget

Send a message without waiting for response. Ideal for events and logs.

```typescript
// Client - don't await, just send
client.send('analytics.track', {
  event: 'page_view',
  page: '/dashboard',
  userId: 123,
}, { timeout: 5000 }).catch(() => {});  // Ignore errors

console.log('Event sent, continuing...');  // Runs immediately

// Server - no reply needed
server.on('analytics.track', async (ctx) => {
  await saveAnalytics(ctx.content);
  // No reply() call - that's fine for fire-and-forget
});
```

### When to Use

- Analytics events
- Logging
- Notifications
- Background jobs
- Any operation where you don't need confirmation

### Important Notes

- Always add `.catch(() => {})` to prevent unhandled rejection
- The message is still delivered reliably (RabbitMQ guarantees)
- Server handler can still throw errors - they just won't reach the client

## Pattern 3: Timeout Handling

Control how long to wait for a response.

```typescript
import { RMQTimeoutError } from 'bunny-route';

try {
  const result = await client.send(
    'slow.report.generate',
    { reportType: 'annual' },
    { timeout: 10000 }  // 10 seconds
  );
  console.log('Report ready:', result);
} catch (error) {
  if (error instanceof RMQTimeoutError) {
    console.log('Report is taking too long, will process in background');
    // Maybe store request for later retrieval
  } else {
    throw error;  // Re-throw other errors
  }
}
```

### Timeout Strategies

| Strategy | Timeout | Use Case |
|----------|---------|----------|
| Fast-fail | 1-2s | User-facing APIs |
| Standard | 5-10s | Normal operations |
| Patient | 30-60s | Reports, batch processing |
| Very patient | 5-10min | Large exports, migrations |

### What Happens on Timeout

1. Client rejects the promise with `RMQTimeoutError`
2. **Server continues processing** - the message was already delivered
3. Response is lost if server finishes after timeout

```
Timeline:
0s ─── Client sends message
1s ─── Client timeout (RMQTimeoutError)
       Client moves on...
3s ─── Server finishes, sends response
       Response is ignored (no listener)
```

## Error Handling

### Server Errors with Middleware

```typescript
// Error handling middleware (register first)
server.use(async (ctx, next, reply) => {
  try {
    await next();
  } catch (error) {
    console.error(`Error in ${ctx.routingKey}:`, error);
    reply({ error: error.message, code: 500 });
  }
});

// Handler can throw
server.on('risky.operation', async (ctx, reply) => {
  if (!ctx.content.valid) {
    throw new Error('Invalid input');
  }
  reply({ success: true });
});

// Client receives error as normal response
const result = await client.send('risky.operation', { valid: false });
console.log(result);  // { error: 'Invalid input', code: 500 }
```

### Without Error Middleware

If no error middleware catches exceptions:
- Handler throws
- Message is nacked
- Goes to retry queue (if configured)
- Eventually to DLQ
- Client times out (never receives response)

## Choosing Timeout Values

```typescript
// Quick operations - fast timeout
await client.send('cache.get', { key: 'user:123' }, { timeout: 1000 });

// Database operations - moderate timeout
await client.send('user.create', userData, { timeout: 5000 });

// External API calls - longer timeout
await client.send('payment.process', paymentData, { timeout: 30000 });

// Report generation - very long timeout
await client.send('report.generate', params, { timeout: 300000 });
```

## Running the Example

```bash
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/05-rpc-patterns/index.ts
```

## Expected Output

```
Server ready

=== Pattern 1: Request-Reply (RPC) ===

Echo response: { echo: { message: 'Hello, World!' }, timestamp: 1234567890 }

=== Pattern 2: Fire-and-Forget ===

Event sent (fire-and-forget)
[server] Logged event: { event: 'user.login', userId: 123 }

=== Pattern 3: Timeout Handling ===

Sending request with 1s timeout to slow handler (takes 3s)...
[server] Starting slow process...
Caught timeout error: RPC timeout after 1000ms for routing key: slow.process
[server] Slow process done

=== Pattern 4: Patient Request ===

Sending request with 5s timeout to slow handler...
[server] Starting slow process...
[server] Slow process done
Response in 3005ms: { result: 'completed', data: { data: 'important' } }

=== Pattern 5: Error Propagation ===

Sending risky operation that will fail...

Done
```

## Best Practices

### 1. Always Set Timeouts

```typescript
// Bad - no timeout, waits forever
await client.send('some.route', data);

// Good - explicit timeout
await client.send('some.route', data, { timeout: 5000 });
```

### 2. Handle Timeouts Gracefully

```typescript
try {
  return await client.send('route', data, { timeout: 5000 });
} catch (error) {
  if (error instanceof RMQTimeoutError) {
    // Log, return default, or retry
    logger.warn('Request timed out, using fallback');
    return defaultValue;
  }
  throw error;
}
```

### 3. Match Timeout to Operation

```typescript
// Configure timeouts per operation type
const TIMEOUTS = {
  read: 2000,
  write: 5000,
  heavyProcess: 30000,
};

await client.send('user.get', { id }, { timeout: TIMEOUTS.read });
await client.send('report.generate', params, { timeout: TIMEOUTS.heavyProcess });
```

### 4. Fire-and-Forget for Events

```typescript
// Don't wait for analytics
client.send('analytics.track', event, { timeout: 5000 }).catch(() => {});

// Don't wait for notifications
client.send('notification.send', data, { timeout: 5000 }).catch(() => {});
```

## Next Steps

- [06-retry-dlq](../06-retry-dlq) - Automatic retries and dead letter queues
- [02-middleware](../02-middleware) - Error handling middleware
