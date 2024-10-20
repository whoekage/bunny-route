// examples/server.ts
const { RMQServer } = require('../dist');

const app = new RMQServer({
  uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
  appName: 'my-service',
  retryOptions: {
    maxRetries: 3,
    retryTTL: 5000,
    enabled: true,
  },
});

// Middleware for logging incoming messages
app.use(async (context, next, reply) => {
  console.log(`[${new Date().toISOString()}] Received message:`, context.routingKey, context.content);
  await next();
});


// Middleware for error handling
app.use(async (context, next, reply) => {
  try {
    await next();
  } catch (error) {
    console.error('Error in handler:', error);
    reply({ error: error.message });
  }
});

// Handler registration
app.on('create.user', async (context, reply) => {
  // User creation logic
  const userId = Math.floor(Math.random() * 1000);
  reply({ status: 'success', userId });
});


// Handler registration
app.on('update.user', async (context, reply) => {
  // User update logic
  reply({ status: 'success', message: 'User updated' });
});

app.on('delete.user', async (context, reply) => {
  // User deletion logic
  if (context.content.id) {
    reply({ status: 'success', message: 'User deleted' });
  } else {
    throw new Error('User ID is required');
  }
});

// Starting the server
app.listen().catch((error) => {
  console.error('Error starting the server:', error);
});
