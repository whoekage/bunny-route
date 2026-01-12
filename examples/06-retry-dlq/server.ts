/**
 * Retry & DLQ Server Example
 *
 * This server demonstrates:
 * - Global retry configuration
 * - Per-handler retry overrides
 * - Proper error handling for retryable vs non-retryable errors
 * - Retry count tracking via headers
 *
 * Run: npx tsx examples/06-retry-dlq/server.ts
 */

import { RMQServer } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  // ============================================================
  // Server Configuration with Global Retry Options
  // ============================================================
  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: 'retry-demo',

    // Global retry settings (apply to all handlers by default)
    retryOptions: {
      enabled: true,    // Enable automatic retries
      maxRetries: 3,    // Retry up to 3 times before DLQ
      retryTTL: 5000,   // Wait 5 seconds between retries
    },
  });

  // ============================================================
  // Handler 1: Uses global retry settings
  // ============================================================
  server.on('order.process', async (ctx, reply) => {
    const { orderId, simulateFail } = ctx.content;
    const retryCount = ctx.headers['x-retry-count'] || 0;

    console.log(`\n[order.process] Processing order #${orderId}, attempt ${retryCount + 1}`);

    // Simulate transient failure (e.g., external service down)
    if (simulateFail) {
      console.log(`[order.process] ERROR: Simulated transient failure`);
      // Throwing error triggers retry mechanism
      throw new Error('External payment service unavailable');
    }

    // Success case
    console.log(`[order.process] SUCCESS: Order #${orderId} processed`);
    reply({ success: true, orderId, processedAt: new Date().toISOString() });
  });

  // ============================================================
  // Handler 2: Custom retry settings (more retries for critical ops)
  // ============================================================
  server.on(
    'payment.charge',
    async (ctx, reply) => {
      const { amount, customerId } = ctx.content;
      const retryCount = ctx.headers['x-retry-count'] || 0;

      console.log(`\n[payment.charge] Charging $${amount} for customer ${customerId}, attempt ${retryCount + 1}`);

      // Simulate intermittent failures (succeeds on 3rd attempt)
      if (retryCount < 2) {
        console.log(`[payment.charge] RETRY: Payment gateway timeout`);
        throw new Error('Payment gateway timeout');
      }

      console.log(`[payment.charge] SUCCESS: Payment charged`);
      reply({ success: true, transactionId: `TXN-${Date.now()}` });
    },
    // Per-handler overrides: more retries, longer wait for payments
    {
      maxRetries: 5,
      retryTTL: 10000,
      retryEnabled: true,
    }
  );

  // ============================================================
  // Handler 3: No retries (validation - will always fail)
  // ============================================================
  server.on(
    'user.validate',
    async (ctx, reply) => {
      const { email } = ctx.content;

      console.log(`\n[user.validate] Validating email: ${email}`);

      // Validation errors should NOT be retried
      // They will fail every time, so go straight to DLQ
      if (!email || !email.includes('@')) {
        console.log(`[user.validate] INVALID: Bad email format`);
        throw new Error('Invalid email format');
      }

      console.log(`[user.validate] VALID: Email is correct`);
      reply({ valid: true, email });
    },
    // Disable retries - go straight to DLQ on failure
    {
      retryEnabled: false,
    }
  );

  // ============================================================
  // Handler 4: Smart error handling (retry some, reject others)
  // ============================================================
  server.on('inventory.reserve', async (ctx, reply) => {
    const { productId, quantity } = ctx.content;
    const retryCount = ctx.headers['x-retry-count'] || 0;

    console.log(`\n[inventory.reserve] Reserving ${quantity}x product ${productId}, attempt ${retryCount + 1}`);

    // Simulate different error types
    const errorType = ctx.content.errorType;

    if (errorType === 'network') {
      // Network error - SHOULD retry
      console.log(`[inventory.reserve] RETRY: Network error`);
      throw new Error('Network timeout');
    }

    if (errorType === 'out_of_stock') {
      // Business logic error - should NOT retry (reply with error instead)
      console.log(`[inventory.reserve] REJECT: Out of stock (no retry)`);
      reply({ success: false, error: 'Product out of stock' });
      return;
    }

    // Success
    console.log(`[inventory.reserve] SUCCESS: Reserved`);
    reply({ success: true, reservationId: `RES-${Date.now()}` });
  });

  // ============================================================
  // Start Server
  // ============================================================
  await server.listen({ prefetch: 5 });

  console.log('='.repeat(60));
  console.log('Retry & DLQ Demo Server Started');
  console.log('='.repeat(60));
  console.log(`
Queues created:
  - retry-demo       (main queue)
  - retry-demo.retry (retry queue, TTL: 5s)
  - retry-demo.dlq   (dead letter queue)

Handlers:
  - order.process     : Global retry settings (3 retries, 5s wait)
  - payment.charge    : Custom settings (5 retries, 10s wait)
  - user.validate     : No retries (straight to DLQ)
  - inventory.reserve : Smart error handling

Waiting for messages...
`);
}

main().catch(console.error);
