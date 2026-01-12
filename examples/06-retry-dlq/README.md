# Retry & Dead Letter Queue (DLQ) Example

This example demonstrates bunny-route's automatic retry mechanism and Dead Letter Queue handling.

## Concept

When message processing fails, bunny-route can automatically retry the operation. After exhausting all retry attempts, the message is moved to a Dead Letter Queue (DLQ) for manual inspection or automated recovery.

```
┌─────────────┐     success      ┌─────────────┐
│   Client    │ ───────────────► │   Handler   │ ──► Done
└─────────────┘                  └─────────────┘
                                        │
                                      error
                                        ▼
                              ┌─────────────────┐
                              │  Retry Logic    │
                              │ count < max?    │
                              └─────────────────┘
                                 │          │
                                yes         no
                                 ▼          ▼
                          ┌──────────┐  ┌──────────┐
                          │  Retry   │  │   DLQ    │
                          │  Queue   │  │  Queue   │
                          └──────────┘  └──────────┘
                                 │
                            wait TTL
                                 │
                                 ▼
                          Back to Handler
```

## Queue Structure

bunny-route automatically creates three queues:

| Queue | Name | Purpose |
|-------|------|---------|
| Main | `{appName}` | Primary message processing |
| Retry | `{appName}.retry` | Holds messages waiting for retry |
| DLQ | `{appName}.dlq` | Failed messages after max retries |

## Configuration

### Global Retry Options (Server-level)

```typescript
const server = new RMQServer({
  uri: 'amqp://localhost',
  appName: 'my-service',
  retryOptions: {
    enabled: true,      // Enable retry mechanism
    maxRetries: 3,      // Retry up to 3 times
    retryTTL: 5000,     // Wait 5 seconds between retries
  },
});
```

### Per-Handler Retry Options

Override global settings for specific handlers:

```typescript
// Critical operation - more retries, longer wait
server.on('payment.process', handler, {
  maxRetries: 5,
  retryTTL: 10000,
  retryEnabled: true,
});

// Non-critical - fewer retries
server.on('analytics.track', handler, {
  maxRetries: 1,
  retryTTL: 1000,
  retryEnabled: true,
});

// No retries - fail immediately to DLQ
server.on('validation.check', handler, {
  retryEnabled: false,
});
```

## Retry Headers

bunny-route uses headers to track retry state:

| Header | Description |
|--------|-------------|
| `x-retry-count` | Current retry attempt (0, 1, 2, ...) |
| `x-original-routing-key` | Original routing key before retry |

Access in your handler:

```typescript
server.on('order.process', async (ctx, reply) => {
  const retryCount = ctx.headers['x-retry-count'] || 0;
  console.log(`Processing order, attempt ${retryCount + 1}`);

  // Your logic here
});
```

## When to Use Retries

**Good candidates for retry:**
- Network timeouts
- Database connection issues
- External API temporary failures
- Rate limiting (with appropriate TTL)

**NOT suitable for retry:**
- Validation errors (will fail every time)
- Business logic rejections
- Missing required data
- Authorization failures

```typescript
server.on('order.process', async (ctx, reply) => {
  // DON'T retry validation errors
  if (!ctx.content.orderId) {
    reply({ error: 'Missing orderId' });  // Reply with error, don't throw
    return;
  }

  // DO retry transient failures
  try {
    await externalPaymentAPI.charge(ctx.content);
    reply({ success: true });
  } catch (error) {
    if (error.code === 'NETWORK_ERROR') {
      throw error;  // Will trigger retry
    }
    // Permanent failure - don't retry
    reply({ error: error.message });
  }
});
```

## DLQ Processing

Messages in DLQ need manual intervention. Options:

### 1. RabbitMQ Management UI
Navigate to `http://localhost:15672` → Queues → `{appName}.dlq`

### 2. Automated DLQ Consumer
See `dlq-processor.ts` in this example.

### 3. Reprocessing Strategy

```typescript
// Move message back to main queue for reprocessing
async function reprocessMessage(channel, dlqMsg) {
  const originalRoutingKey = dlqMsg.properties.headers['x-original-routing-key'];

  // Reset retry count
  const headers = { ...dlqMsg.properties.headers };
  delete headers['x-retry-count'];

  channel.publish(exchange, originalRoutingKey, dlqMsg.content, { headers });
  channel.ack(dlqMsg);
}
```

## Files in This Example

| File | Description |
|------|-------------|
| `server.ts` | Server with retry configuration |
| `client.ts` | Sends messages (some designed to fail) |
| `dlq-processor.ts` | Monitors and processes DLQ |

## Running the Example

```bash
# Terminal 1: Start the server
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/06-retry-dlq/server.ts

# Terminal 2: Start DLQ processor (optional)
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/06-retry-dlq/dlq-processor.ts

# Terminal 3: Send test messages
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/06-retry-dlq/client.ts
```

## Expected Output

```
[server] Processing order #123, attempt 1
[server] ERROR: Simulated failure for order #123
[server] Processing order #123, attempt 2  (after 5s)
[server] ERROR: Simulated failure for order #123
[server] Processing order #123, attempt 3  (after 5s)
[server] ERROR: Simulated failure for order #123
[server] Message sent to DLQ: order.process

[dlq-processor] Received failed message:
  - Routing Key: order.process
  - Retry Count: 3
  - Content: { orderId: 123, simulateFail: true }
```
