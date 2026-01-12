/**
 * Basic Client Example
 *
 * Demonstrates:
 * - Creating an RMQClient instance
 * - Sending messages with RPC (request-reply)
 * - Handling responses
 *
 * Run: npx tsx examples/01-basic/client.ts
 */

import { RMQClient } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';
const APP_NAME = process.env.APP_NAME || 'my-service';

async function main() {
  // Create client instance
  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: APP_NAME,
  });

  // Connect to RabbitMQ
  await client.connect();
  console.log('Client connected');

  try {
    // Create a user (RPC call - waits for response)
    console.log('\n--- Creating user ---');
    const createResult = await client.send(
      'user.create',
      { name: 'Alice', email: 'alice@example.com' },
      { timeout: 5000 },
    );
    console.log('Create result:', createResult);

    // Get user details
    console.log('\n--- Getting user ---');
    const getResult = await client.send(
      'user.get',
      { id: createResult.user.id },
      { timeout: 5000 },
    );
    console.log('Get result:', getResult);

    // Delete user
    console.log('\n--- Deleting user ---');
    const deleteResult = await client.send(
      'user.delete',
      { id: createResult.user.id },
      { timeout: 5000 },
    );
    console.log('Delete result:', deleteResult);
  } finally {
    // Always close the connection
    await client.close();
    console.log('\nClient disconnected');
  }
}

main().catch(console.error);
