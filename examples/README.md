# Bunny Route Examples

This directory contains examples demonstrating various features of bunny-route.

## Prerequisites

1. RabbitMQ running locally (or use Docker):
   ```bash
   docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
   ```

2. Copy environment file:
   ```bash
   cp .env.example .env
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Running Examples

Each example can be run with `ts-node` or `tsx`:

```bash
# Using tsx (recommended)
npx tsx examples/01-basic/server.ts

# Using ts-node
npx ts-node examples/01-basic/server.ts
```

## Examples Overview

| Example | Description |
|---------|-------------|
| [01-basic](./01-basic) | Simple server and client setup |
| [02-middleware](./02-middleware) | Logging, authentication, error handling middleware |
| [03-graceful-shutdown](./03-graceful-shutdown) | Graceful shutdown patterns for production |
| [04-reconnection](./04-reconnection) | Automatic reconnection and connection events |
| [05-rpc-patterns](./05-rpc-patterns) | Request-reply, fire-and-forget, timeouts |

## Example Structure

Each example folder contains:
- `server.ts` - Server-side code (message consumer)
- `client.ts` - Client-side code (message publisher)
- Or `index.ts` - Combined example

## Tips

- Start the server first, then run the client
- Use separate terminal windows for server and client
- Check RabbitMQ Management UI at http://localhost:15672 (guest/guest)
