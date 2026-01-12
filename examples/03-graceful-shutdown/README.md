# Graceful Shutdown Example

Properly shut down your services without losing messages or interrupting in-flight operations.

## What You'll Learn

- Using `server.shutdown()` and `client.shutdown()`
- Waiting for in-flight handlers to complete
- Timeout and force shutdown options
- Kubernetes/Docker SIGTERM handling
- The `setupGracefulShutdown()` helper

## Why Graceful Shutdown?

```
Without graceful shutdown:
┌─────────┐     Processing...     ┌─────────┐
│ Handler │ ─────────────────────►│ SIGTERM │ → Message lost!
└─────────┘                       └─────────┘

With graceful shutdown:
┌─────────┐     Processing...     ┌─────────┐     Done!     ┌──────────┐
│ Handler │ ─────────────────────►│ SIGTERM │ ────────────►│ Shutdown │
└─────────┘                       └─────────┘              └──────────┘
```

## Files

| File | Description |
|------|-------------|
| `simple.ts` | Basic shutdown with timeout |
| `kubernetes.ts` | Production-ready SIGTERM handling |

## Server Shutdown API

```typescript
const result = await server.shutdown(options);
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `30000` | Max ms to wait for handlers |
| `force` | `boolean` | `false` | Don't wait, close immediately |

### Result

```typescript
interface ShutdownResult {
  success: boolean;    // True if all handlers completed
  pendingCount: number;  // Handlers still running at shutdown
  timedOut: boolean;   // True if timeout was reached
}
```

## Basic Usage

```typescript
// Wait up to 30 seconds for handlers to complete
const result = await server.shutdown({ timeout: 30000 });

if (result.success) {
  console.log('Clean shutdown');
} else {
  console.log(`${result.pendingCount} handlers still running`);
}
```

## Force Shutdown

```typescript
// Don't wait - close immediately
await server.shutdown({ force: true });

// Equivalent to old close() method
await server.close();
```

## Client Shutdown

```typescript
const result = await client.shutdown();
// Rejects all pending RPC requests with 'Client shutdown: request cancelled'
```

## Kubernetes / Docker

Use `setupGracefulShutdown()` for automatic SIGTERM/SIGINT handling:

```typescript
import { RMQServer, RMQClient, setupGracefulShutdown } from 'bunny-route';

const server = new RMQServer({ ... });
const client = new RMQClient({ ... });

await server.listen();
await client.connect();

// Handles SIGTERM and SIGINT automatically
setupGracefulShutdown({
  server,
  clients: [client],
  timeout: 30000,
  onShutdown: async () => {
    // Custom cleanup: close DB connections, flush logs, etc.
    await database.close();
    await logger.flush();
  },
});
```

### What `setupGracefulShutdown` Does

1. Registers `SIGTERM` and `SIGINT` handlers
2. Stops accepting new messages
3. Waits for in-flight handlers (up to timeout)
4. Shuts down clients (rejects pending requests)
5. Calls your `onShutdown` callback
6. Exits process

## Manual Signal Handling

```typescript
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM');

  // 1. Stop accepting new messages
  const serverResult = await server.shutdown({ timeout: 30000 });

  // 2. Reject pending client requests
  const clientResult = await client.shutdown();

  // 3. Custom cleanup
  await database.close();

  // 4. Exit
  process.exit(serverResult.success ? 0 : 1);
});
```

## Programmatic Shutdown

For testing or orchestration:

```typescript
import { performGracefulShutdown } from 'bunny-route';

const result = await performGracefulShutdown({
  server,
  clients: [client1, client2],
  timeout: 10000,
  onShutdown: async () => { ... },
});

console.log('Server:', result.server);
console.log('Clients:', result.clients);
console.log('Total pending:', result.totalPending);
```

## Running the Examples

### Simple Shutdown

```bash
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/03-graceful-shutdown/simple.ts
```

### Kubernetes Pattern

```bash
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/03-graceful-shutdown/kubernetes.ts

# Then press Ctrl+C to trigger graceful shutdown
```

## Expected Output (simple.ts)

```
Server is ready

Sending slow task...
[handler] Starting slow task...

Initiating graceful shutdown...
(This will wait up to 5 seconds for handlers to complete)

[handler] Slow task completed!
Shutdown result: { success: true, pendingCount: 0, timedOut: false }
```

## Timeout Behavior

```typescript
// If handlers take longer than timeout:
const result = await server.shutdown({ timeout: 1000 });
// result = { success: false, pendingCount: 1, timedOut: true }

// Handlers are NOT forcefully killed - they continue running
// but the channel is closed, so acks won't be sent
// Message will be redelivered on next server start
```

## Best Practices

1. **Set appropriate timeout** - Match your slowest expected handler
2. **Log shutdown events** - For debugging production issues
3. **Monitor pending counts** - Alert if frequently > 0
4. **Test shutdown paths** - Include in integration tests
5. **Handle in-flight requests** - Design handlers to be idempotent

## Next Steps

- [04-reconnection](../04-reconnection) - Handle connection failures
- [06-retry-dlq](../06-retry-dlq) - Message retry and dead letters
