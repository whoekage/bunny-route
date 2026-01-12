/**
 * Simple Graceful Shutdown Example
 *
 * Demonstrates:
 * - server.shutdown() waiting for in-flight handlers
 * - client.shutdown() rejecting pending requests
 * - Timeout handling
 *
 * Run: npx tsx examples/03-graceful-shutdown/simple.ts
 */

import { RMQClient, RMQServer } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: 'shutdown-example',
  });

  // Simulate a slow handler (e.g., database operation)
  server.on('slow.task', async (_ctx, reply) => {
    console.log('[handler] Starting slow task...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log('[handler] Slow task completed!');
    reply({ success: true });
  });

  server.on('fast.task', async (_ctx, reply) => {
    reply({ success: true, message: 'Fast!' });
  });

  await server.listen();
  console.log('Server is ready\n');

  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: 'shutdown-example',
  });
  await client.connect();

  // Send a slow task (fire-and-forget to not block)
  console.log('Sending slow task...');
  client.send('slow.task', {}, { timeout: 10000 }).catch(() => {});

  // Wait a bit for the handler to start
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Now shutdown - should wait for the slow handler
  console.log('\nInitiating graceful shutdown...');
  console.log('(This will wait up to 5 seconds for handlers to complete)\n');

  const result = await server.shutdown({ timeout: 5000 });

  console.log('Shutdown result:', {
    success: result.success,
    pendingCount: result.pendingCount,
    timedOut: result.timedOut,
  });

  await client.close();
}

main().catch(console.error);
