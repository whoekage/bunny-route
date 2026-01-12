/**
 * Automatic Reconnection Example
 *
 * Demonstrates:
 * - Connection event handling (connected, disconnected, reconnecting, reconnected)
 * - Automatic reconnection with exponential backoff
 * - Channel recovery after reconnect
 *
 * Run: npx tsx examples/04-reconnection/index.ts
 *
 * To test reconnection:
 * 1. Start the example
 * 2. Stop RabbitMQ: docker stop rabbitmq
 * 3. Watch reconnection attempts
 * 4. Start RabbitMQ: docker start rabbitmq
 * 5. Watch automatic recovery
 */

import { RMQClient, RMQServer } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  console.log('Reconnection Example\n');
  console.log('Stop RabbitMQ to see reconnection in action:\n');
  console.log('  docker stop rabbitmq\n');

  // Server with reconnection options
  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: 'reconnect-example',
    // Reconnection configuration
    reconnect: {
      enabled: true,
      maxAttempts: 10,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    },
    // Heartbeat to detect connection issues faster
    heartbeat: 10,
  });

  // Subscribe to connection events
  server.connection.on('connected', () => {
    console.log('[server] Connected to RabbitMQ');
  });

  server.connection.on('disconnected', (error) => {
    console.log('[server] Disconnected:', error?.message || 'Unknown reason');
  });

  server.connection.on('reconnecting', (attempt, delay) => {
    console.log(`[server] Reconnecting... attempt ${attempt}, next retry in ${delay}ms`);
  });

  server.connection.on('reconnected', () => {
    console.log('[server] Reconnected! Channels restored automatically.');
  });

  server.connection.on('error', (error) => {
    console.error('[server] Connection error:', error.message);
  });

  // Simple handler
  server.on('ping', async (_ctx, reply) => {
    reply({ pong: true, timestamp: Date.now() });
  });

  await server.listen();

  // Client setup
  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: 'reconnect-example',
  });

  await client.connect();
  console.log('[client] Connected');

  // Periodically send pings to show connection status
  console.log('\nSending ping every 5 seconds...\n');

  setInterval(async () => {
    try {
      const start = Date.now();
      const result = await client.send('ping', {}, { timeout: 2000 });
      const latency = Date.now() - start;
      console.log(`[ping] Response in ${latency}ms:`, result);
    } catch (error) {
      console.log('[ping] Failed:', (error as Error).message);
    }
  }, 5000);

  // Connection state helpers
  console.log('Connection state helpers:');
  console.log('  server.isConnected():', server.isConnected());
  console.log('  server.getConnectionState():', server.getConnectionState());
  console.log('');
}

main().catch(console.error);
