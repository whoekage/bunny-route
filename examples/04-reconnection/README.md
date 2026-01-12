# Automatic Reconnection Example

Handle network failures gracefully with automatic reconnection and connection event monitoring.

## What You'll Learn

- Configuring reconnection behavior
- Subscribing to connection events
- Exponential backoff strategy
- Channel recovery after reconnect
- Connection state monitoring

## Reconnection Flow

```
Connected ──► Disconnected ──► Reconnecting ──► Connected
                   │                 │              │
                   │                 ▼              │
                   │         [Attempt 1: 1s]       │
                   │         [Attempt 2: 2s]       │
                   │         [Attempt 3: 4s]       │
                   │              ...              │
                   │         [Max attempts]        │
                   │                 │              │
                   ▼                 ▼              │
              Event: error    Event: reconnected ◄─┘
```

## Configuration

```typescript
const server = new RMQServer({
  uri: 'amqp://localhost',
  appName: 'my-service',

  // Heartbeat - detect dead connections faster
  heartbeat: 10,  // seconds

  // Reconnection options
  reconnect: {
    enabled: true,          // Enable auto-reconnect
    maxAttempts: 10,        // Give up after 10 attempts
    initialDelayMs: 1000,   // First retry after 1s
    maxDelayMs: 30000,      // Cap delay at 30s
  },
});
```

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Auto-reconnect on disconnect |
| `maxAttempts` | `10` | Max reconnection attempts |
| `initialDelayMs` | `1000` | Initial delay (1 second) |
| `maxDelayMs` | `30000` | Maximum delay (30 seconds) |

## Connection Events

Subscribe to events via `server.connection`:

```typescript
// Connection established (initial or reconnect)
server.connection.on('connected', () => {
  console.log('Connected to RabbitMQ');
});

// Connection lost
server.connection.on('disconnected', (error) => {
  console.log('Disconnected:', error?.message);
});

// Attempting to reconnect
server.connection.on('reconnecting', (attempt, delayMs) => {
  console.log(`Reconnecting... attempt ${attempt}, next in ${delayMs}ms`);
});

// Successfully reconnected
server.connection.on('reconnected', () => {
  console.log('Reconnected! Channels restored.');
});

// Failed to reconnect (max attempts reached)
server.connection.on('error', (error) => {
  console.error('Connection failed:', error);
  process.exit(1);  // Or implement fallback logic
});
```

## Exponential Backoff

Delays increase exponentially with jitter:

```
Attempt 1: ~1000ms  (initialDelayMs)
Attempt 2: ~2000ms
Attempt 3: ~4000ms
Attempt 4: ~8000ms
...
Attempt N: min(initialDelayMs * 2^N, maxDelayMs) + jitter
```

## Connection State Helpers

```typescript
// Check if currently connected
if (server.isConnected()) {
  // Safe to assume operations will work
}

// Get connection state string
const state = server.getConnectionState();
// 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
```

## What Happens on Reconnect

1. **Channels are recreated** - All channel setup is re-executed
2. **Consumers are restored** - Message handlers resume automatically
3. **Queues/exchanges are re-declared** - Idempotent declarations
4. **Pending publishes** - May be lost if not using confirms

## Handling Disconnection in Code

```typescript
server.on('order.process', async (ctx, reply) => {
  try {
    // Your business logic
    await processOrder(ctx.content);
    reply({ success: true });
  } catch (error) {
    // Check if it's a connection issue
    if (!server.isConnected()) {
      // Don't ack - message will be redelivered after reconnect
      throw error;
    }
    // Handle other errors
    reply({ error: error.message });
  }
});
```

## Testing Reconnection

```bash
# Terminal 1: Start the example
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/04-reconnection/index.ts

# Terminal 2: Stop RabbitMQ
docker stop rabbitmq

# Watch reconnection attempts in Terminal 1...

# Terminal 2: Start RabbitMQ again
docker start rabbitmq

# Watch successful reconnection in Terminal 1
```

## Expected Output

```
Reconnection Example

Stop RabbitMQ to see reconnection in action:
  docker stop rabbitmq

[server] Connected to RabbitMQ
[client] Connected

Sending ping every 5 seconds...

Connection state helpers:
  server.isConnected(): true
  server.getConnectionState(): connected

[ping] Response in 9ms: { pong: true, timestamp: 1234567890 }
[ping] Response in 5ms: { pong: true, timestamp: 1234567895 }

# After stopping RabbitMQ:
[server] Disconnected: Connection closed: 320 (CONNECTION-FORCED)
[RMQConnectionManager] Reconnecting in 1000ms (attempt 1)
[ping] Failed: Channel closed
[RMQConnectionManager] Reconnecting in 2000ms (attempt 2)
...

# After starting RabbitMQ:
[RMQConnectionManager] Reconnected successfully
[server] Reconnected! Channels restored.
[ping] Response in 12ms: { pong: true, timestamp: 1234567920 }
```

## Production Considerations

### 1. Alert on Max Attempts

```typescript
server.connection.on('error', (error) => {
  alertOps('RabbitMQ connection failed permanently', error);
  // Consider: restart container, failover, etc.
});
```

### 2. Health Check Endpoint

```typescript
app.get('/health', (req, res) => {
  if (server.isConnected()) {
    res.status(200).json({ status: 'healthy' });
  } else {
    res.status(503).json({ status: 'unhealthy', reason: 'RabbitMQ disconnected' });
  }
});
```

### 3. Kubernetes Liveness Probe

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
```

## Next Steps

- [03-graceful-shutdown](../03-graceful-shutdown) - Proper shutdown handling
- [06-retry-dlq](../06-retry-dlq) - Message retry on handler failure
