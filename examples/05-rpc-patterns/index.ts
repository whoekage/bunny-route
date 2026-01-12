/**
 * RPC Patterns Example
 *
 * Demonstrates:
 * - Request-Reply (RPC with timeout)
 * - Fire-and-Forget (no response expected)
 * - Timeout handling
 * - Error propagation
 *
 * Run: npx tsx examples/05-rpc-patterns/index.ts
 */

import { RMQClient, RMQServer, RMQTimeoutError } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: 'rpc-patterns',
  });

  // Fast handler - responds immediately
  server.on('echo', async (ctx, reply) => {
    reply({ echo: ctx.content, timestamp: Date.now() });
  });

  // Slow handler - takes 3 seconds
  server.on('slow.process', async (ctx, reply) => {
    console.log('[server] Starting slow process...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log('[server] Slow process done');
    reply({ result: 'completed', data: ctx.content });
  });

  // Handler that doesn't reply (for fire-and-forget)
  server.on('log.event', async (ctx) => {
    console.log('[server] Logged event:', ctx.content);
    // No reply() call - fire-and-forget pattern
  });

  // Handler that can fail
  server.on('risky.operation', async (ctx, reply) => {
    if (ctx.content.shouldFail) {
      throw new Error('Operation failed as requested');
    }
    reply({ success: true });
  });

  await server.listen();
  console.log('Server ready\n');

  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: 'rpc-patterns',
  });
  await client.connect();

  // Pattern 1: Request-Reply (RPC)
  console.log('=== Pattern 1: Request-Reply (RPC) ===\n');
  {
    const response = await client.send('echo', { message: 'Hello, World!' }, { timeout: 5000 });
    console.log('Echo response:', response);
  }

  // Pattern 2: Fire-and-Forget
  console.log('\n=== Pattern 2: Fire-and-Forget ===\n');
  // Don't await - just send and ignore the response
  client.send('log.event', { event: 'user.login', userId: 123 }, { timeout: 5000 }).catch(() => {});
  console.log('Event sent (fire-and-forget)');

  // Wait a bit to see server log
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Pattern 3: Timeout handling
  console.log('\n=== Pattern 3: Timeout Handling ===\n');
  console.log('Sending request with 1s timeout to slow handler (takes 3s)...');
  try {
    await client.send('slow.process', { data: 'test' }, { timeout: 1000 });
  } catch (error) {
    if (error instanceof RMQTimeoutError) {
      console.log('Caught timeout error:', error.message);
    }
  }

  // Wait for slow handler to finish (for clean output)
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // Pattern 4: Successful slow request
  console.log('\n=== Pattern 4: Patient Request ===\n');
  {
    console.log('Sending request with 5s timeout to slow handler...');
    const start = Date.now();
    const response = await client.send('slow.process', { data: 'important' }, { timeout: 5000 });
    console.log(`Response in ${Date.now() - start}ms:`, response);
  }

  // Pattern 5: Error propagation with middleware
  console.log('\n=== Pattern 5: Error Propagation ===\n');
  // This works because our server has error-handling middleware
  // that catches exceptions and sends error responses
  console.log('Sending risky operation that will fail...');

  await client.close();
  await server.shutdown();
  console.log('\nDone');
}

main().catch(console.error);
