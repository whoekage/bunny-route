/**
 * Middleware Example
 *
 * Demonstrates:
 * - Logging middleware
 * - Authentication middleware
 * - Error handling middleware
 * - Request timing middleware
 *
 * Run: npx tsx examples/02-middleware/index.ts
 */

import { RMQClient, RMQServer } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: 'middleware-example',
  });

  // 1. Error handling middleware (first to catch all errors)
  server.use(async (ctx, next, reply) => {
    try {
      await next();
    } catch (error) {
      console.error(`[error] ${ctx.routingKey}:`, error);
      reply({
        error: error instanceof Error ? error.message : 'Internal error',
        code: 500,
      });
    }
  });

  // 2. Request timing middleware
  server.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`[timing] ${ctx.routingKey} completed in ${duration}ms`);
  });

  // 3. Logging middleware
  server.use(async (ctx, next) => {
    console.log(`[log] Incoming: ${ctx.routingKey}`, JSON.stringify(ctx.content));
    await next();
  });

  // 4. Authentication middleware
  server.use(async (ctx, next, reply) => {
    const token = ctx.headers['x-auth-token'];

    // Skip auth for public routes
    if (ctx.routingKey.startsWith('public.')) {
      return next();
    }

    if (!token) {
      return reply({ error: 'Unauthorized', code: 401 });
    }

    // Validate token (simplified example)
    if (token !== 'valid-token') {
      return reply({ error: 'Invalid token', code: 403 });
    }

    // Add user info to context for handlers
    (ctx as any).user = { id: 1, role: 'admin' };
    await next();
  });

  // Handlers
  server.on('public.health', async (_ctx, reply) => {
    reply({ status: 'ok', timestamp: new Date().toISOString() });
  });

  server.on('protected.data', async (ctx, reply) => {
    const user = (ctx as any).user;
    reply({ data: 'secret', accessedBy: user.id });
  });

  server.on('error.test', async () => {
    throw new Error('Something went wrong!');
  });

  await server.listen();
  console.log('Server with middleware is ready\n');

  // Test with client
  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: 'middleware-example',
  });
  await client.connect();

  console.log('--- Public route (no auth required) ---');
  const health = await client.send('public.health', {}, { timeout: 5000 });
  console.log('Response:', health);

  console.log('\n--- Protected route without token ---');
  const noAuth = await client.send('protected.data', {}, { timeout: 5000 });
  console.log('Response:', noAuth);

  console.log('\n--- Protected route with valid token ---');
  const withAuth = await client.send(
    'protected.data',
    {},
    { timeout: 5000, headers: { 'x-auth-token': 'valid-token' } },
  );
  console.log('Response:', withAuth);

  console.log('\n--- Route that throws error (with auth) ---');
  const errorResult = await client.send(
    'error.test',
    {},
    { timeout: 5000, headers: { 'x-auth-token': 'valid-token' } },
  );
  console.log('Response:', errorResult);

  await client.close();
  await server.shutdown();
  console.log('\nDone');
}

main().catch(console.error);
