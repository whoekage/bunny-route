/**
 * Retry & DLQ Client Example
 *
 * Sends test messages to demonstrate:
 * - Successful processing
 * - Retries with eventual success
 * - Retries exhausted → DLQ
 * - No retry → immediate DLQ
 * - Smart error handling
 *
 * Run: npx tsx examples/06-retry-dlq/client.ts
 */

import { RMQClient } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: 'retry-demo',
  });

  await client.connect();

  console.log('='.repeat(60));
  console.log('Retry & DLQ Demo Client');
  console.log('='.repeat(60));

  // ============================================================
  // Test 1: Successful order processing
  // ============================================================
  console.log('\n[Test 1] Sending successful order...');
  try {
    const result = await client.send(
      'order.process',
      { orderId: 1001, simulateFail: false },
      { timeout: 5000 }
    );
    console.log('[Test 1] Result:', result);
  } catch (error) {
    console.log('[Test 1] Error:', (error as Error).message);
  }

  // ============================================================
  // Test 2: Order that fails all retries → DLQ
  // ============================================================
  console.log('\n[Test 2] Sending order that will fail (watch server for retries)...');
  console.log('[Test 2] This will retry 3 times with 5s delays, then go to DLQ');

  // Fire-and-forget since we won't get a response (it will fail)
  client.send(
    'order.process',
    { orderId: 1002, simulateFail: true },
    { timeout: 30000 }
  ).catch(() => {
    console.log('[Test 2] Request timed out (message is being retried or in DLQ)');
  });

  // ============================================================
  // Test 3: Payment with custom retry settings (succeeds on 3rd try)
  // ============================================================
  console.log('\n[Test 3] Sending payment (will succeed after 2 retries)...');

  // This has longer timeout because payment has 10s retry TTL
  try {
    const result = await client.send(
      'payment.charge',
      { amount: 99.99, customerId: 'CUST-123' },
      { timeout: 60000 }
    );
    console.log('[Test 3] Result:', result);
  } catch (error) {
    console.log('[Test 3] Error:', (error as Error).message);
  }

  // ============================================================
  // Test 4: Validation with no retries → immediate DLQ
  // ============================================================
  console.log('\n[Test 4] Sending invalid email (no retries, straight to DLQ)...');

  client.send(
    'user.validate',
    { email: 'invalid-email' },
    { timeout: 5000 }
  ).catch(() => {
    console.log('[Test 4] Failed immediately (check DLQ)');
  });

  // ============================================================
  // Test 5: Valid email
  // ============================================================
  await new Promise(r => setTimeout(r, 1000));
  console.log('\n[Test 5] Sending valid email...');
  try {
    const result = await client.send(
      'user.validate',
      { email: 'user@example.com' },
      { timeout: 5000 }
    );
    console.log('[Test 5] Result:', result);
  } catch (error) {
    console.log('[Test 5] Error:', (error as Error).message);
  }

  // ============================================================
  // Test 6: Inventory - business error (no retry, just error response)
  // ============================================================
  console.log('\n[Test 6] Sending out-of-stock request (business error, no retry)...');
  try {
    const result = await client.send(
      'inventory.reserve',
      { productId: 'SKU-999', quantity: 10, errorType: 'out_of_stock' },
      { timeout: 5000 }
    );
    console.log('[Test 6] Result:', result);
  } catch (error) {
    console.log('[Test 6] Error:', (error as Error).message);
  }

  // ============================================================
  // Test 7: Inventory - network error (will retry)
  // ============================================================
  console.log('\n[Test 7] Sending network error request (will retry)...');

  client.send(
    'inventory.reserve',
    { productId: 'SKU-100', quantity: 5, errorType: 'network' },
    { timeout: 30000 }
  ).catch(() => {
    console.log('[Test 7] Timed out (message retrying or in DLQ)');
  });

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Tests sent! Watch the server output for retry behavior.');
  console.log('');
  console.log('Expected behavior:');
  console.log('  Test 1: Immediate success');
  console.log('  Test 2: 3 retries (5s each) → DLQ');
  console.log('  Test 3: 2 retries (10s each) → Success on 3rd');
  console.log('  Test 4: No retries → Immediate DLQ');
  console.log('  Test 5: Immediate success');
  console.log('  Test 6: Immediate response (business error)');
  console.log('  Test 7: 3 retries (5s each) → DLQ');
  console.log('='.repeat(60));

  // Wait for async messages to be processed
  console.log('\nWaiting 60s for retries to complete...');
  console.log('(Check server output and DLQ processor)\n');

  await new Promise(r => setTimeout(r, 60000));

  await client.close();
  console.log('Client closed.');
}

main().catch(console.error);
