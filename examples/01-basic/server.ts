/**
 * Basic Server Example
 *
 * Demonstrates:
 * - Creating an RMQServer instance
 * - Registering message handlers
 * - Starting the server
 *
 * Run: npx tsx examples/01-basic/server.ts
 */

import { RMQServer } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';
const APP_NAME = process.env.APP_NAME || 'my-service';

async function main() {
  // Create server instance
  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: APP_NAME,
  });

  // Register handlers for different routing keys
  server.on('user.create', async (ctx, reply) => {
    console.log('Creating user:', ctx.content);

    const user = {
      id: Math.floor(Math.random() * 10000),
      ...ctx.content,
      createdAt: new Date().toISOString(),
    };

    reply({ success: true, user });
  });

  server.on('user.get', async (ctx, reply) => {
    console.log('Getting user:', ctx.content.id);

    // Simulate database lookup
    reply({
      success: true,
      user: { id: ctx.content.id, name: 'John Doe', email: 'john@example.com' },
    });
  });

  server.on('user.delete', async (ctx, reply) => {
    console.log('Deleting user:', ctx.content.id);
    reply({ success: true, message: `User ${ctx.content.id} deleted` });
  });

  // Start listening for messages
  await server.listen({ prefetch: 10 });
  console.log(`Server '${APP_NAME}' is ready and listening for messages`);
}

main().catch(console.error);
