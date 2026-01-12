# Basic Server & Client Example

The simplest way to get started with bunny-route.

## What You'll Learn

- Creating an `RMQServer` to receive messages
- Creating an `RMQClient` to send messages
- Registering message handlers with routing keys
- Request-Reply pattern (RPC)

## Architecture

```
┌─────────────┐    user.create    ┌─────────────┐
│   Client    │ ─────────────────►│   Server    │
│             │◄───────────────── │             │
└─────────────┘    { user: ... }  └─────────────┘
```

## Files

| File | Description |
|------|-------------|
| `server.ts` | Message consumer with handlers |
| `client.ts` | Message publisher with RPC calls |

## Server Setup

```typescript
import { RMQServer } from 'bunny-route';

const server = new RMQServer({
  uri: 'amqp://guest:guest@localhost:5672',
  appName: 'my-service',  // Used as exchange and queue name
});

// Register a handler for 'user.create' routing key
server.on('user.create', async (ctx, reply) => {
  console.log('Received:', ctx.content);  // Message body
  console.log('Headers:', ctx.headers);    // AMQP headers
  console.log('Route:', ctx.routingKey);   // 'user.create'

  // Send response back to client
  reply({ success: true, userId: 123 });
});

// Start listening
await server.listen({ prefetch: 10 });
```

## Client Setup

```typescript
import { RMQClient } from 'bunny-route';

const client = new RMQClient({
  uri: 'amqp://guest:guest@localhost:5672',
  appName: 'my-service',  // Must match server's appName
});

await client.connect();

// Send message and wait for response (RPC)
const response = await client.send(
  'user.create',                    // Routing key
  { name: 'Alice', email: '...' },  // Message body
  { timeout: 5000 }                 // Wait up to 5 seconds
);

console.log(response);  // { success: true, userId: 123 }

await client.close();
```

## Key Concepts

### Routing Key
A string that identifies the message type. Use dot-notation for hierarchy:
- `user.create`
- `user.update`
- `order.payment.process`

### Handler Context (`ctx`)
```typescript
interface HandlerContext {
  content: any;              // Parsed message body (JSON)
  routingKey: string;        // The routing key
  headers: Record<string, any>;  // AMQP message headers
}
```

### Reply Function
Call `reply(data)` to send a response back to the client. If you don't call `reply()`, the client will timeout.

### Prefetch
Controls how many messages a server processes concurrently:
```typescript
await server.listen({ prefetch: 10 });  // Process 10 messages at a time
```

## Running the Example

```bash
# Terminal 1: Start server
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/01-basic/server.ts

# Terminal 2: Run client
RABBITMQ_URI=amqp://guest:guest@localhost:5672 npx tsx examples/01-basic/client.ts
```

## Expected Output

**Server:**
```
Server 'my-service' is ready and listening for messages
Creating user: { name: 'Alice', email: 'alice@example.com' }
Getting user: 7386
Deleting user: 7386
```

**Client:**
```
Client connected

--- Creating user ---
Create result: { success: true, user: { id: 7386, name: 'Alice', ... } }

--- Getting user ---
Get result: { success: true, user: { id: 7386, name: 'John Doe', ... } }

--- Deleting user ---
Delete result: { success: true, message: 'User 7386 deleted' }

Client disconnected
```

## Next Steps

- [02-middleware](../02-middleware) - Add logging, auth, error handling
- [05-rpc-patterns](../05-rpc-patterns) - Timeouts, fire-and-forget
