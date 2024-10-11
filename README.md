# Bunny Route

Bunny Route is a high-performance, Express-inspired RabbitMQ client for Node.js, designed to streamline and standardize RabbitMQ integration out of the box.

## Features

- Express-like architecture for familiar and intuitive usage
- Simplified RabbitMQ setup with automatic queue and exchange creation
- Automatic connection management and recovery
- Built-in retry mechanism for failed message processing
- Support for direct messaging patterns
- RPC (Remote Procedure Call) support for request-response scenarios
- Dead-letter queue support for unprocessable messages
- Support for both CommonJS and ES modules

## Installation

```bash
npm install bunny-route
```

## Usage Examples

### Server (Consumer) Example

#### CommonJS

```javascript
const { RMQServer } = require('bunny-route');

const server = new RMQServer({
  uri: 'amqp://localhost',
  appName: 'my-service', // This will be used as the exchange and queue name prefix
  retryOptions: {
    maxRetries: 3,
    retryTTL: 5000,
    enabled: true
  }
});

// Define a route with custom handler options
server.on('user.created', async (data, ctx) => {
  console.log('New user created:', data);
  // Process the message
  if (someCondition) {
    throw new Error('Processing failed');  // This will trigger a retry
  }
}, {
  maxRetries: 5,  // Override default maxRetries for this specific handler
  retryTTL: 10000  // Override default retryTTL for this specific handler
});

// Start the server
server.listen({ prefetch: 10 })  // Set prefetch to control concurrency
  .then(() => {
    console.log('Bunny Route server is now listening for messages');
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
  });
```

#### ES Modules

```javascript
import { RMQServer } from 'bunny-route';

const server = new RMQServer({
  uri: 'amqp://localhost',
  appName: 'my-service',
  retryOptions: {
    maxRetries: 3,
    retryTTL: 5000,
    enabled: true
  }
});

// Rest of the code remains the same as in CommonJS example
```

### Client (Publisher) Example

#### CommonJS

```javascript
const { RMQClient } = require('bunny-route');

const client = new RMQClient({
  uri: 'amqp://localhost',
  appName: 'my-service' // This should match the server's appName for proper routing
});

async function publishMessages() {
  await client.connect();

  // Publish a message
  await client.send('user.created', { id: 123, name: 'John Doe' });

  // RPC call (send and wait for response)
  try {
    const response = await client.send('order.placed', { orderId: 789, total: 199.99 }, {
      timeout: 5000 // Wait for 5 seconds for a response
    });
    console.log('Order processing result:', response);
  } catch (error) {
    console.error('RPC call failed:', error);
  }

  await client.close();
}

publishMessages().catch(console.error);
```

#### ES Modules

```javascript
import { RMQClient } from 'bunny-route';

const client = new RMQClient({
  uri: 'amqp://localhost',
  appName: 'my-service'
});

// Rest of the code remains the same as in CommonJS example
```

## Key Concepts

- **appName**: This is used as a prefix for both the exchange and queue names. It helps in organizing and identifying your service's messaging components.
- **Exchange**: A direct exchange is created using the pattern `${appName}`.
- **Queues**: The main queue is named `${appName}`, with additional queues for retries and dead-letters.
- **Routing**: Messages are routed based on the routing keys you define in your `on` handlers.

## RPC Mechanism

Bunny Route supports RPC-style communication:
- The server can return values from its handlers, which will be sent back to the client for RPC calls.
- The client can make RPC calls using the `send` method with a timeout option, which will wait for a response.

## Error Handling and Retries

- Failed message processing triggers automatic retries based on the configured `retryOptions`.
- Messages exceeding the maximum retry count are sent to a dead-letter queue (`${appName}.dlq`).
- Connection errors are automatically handled with reconnection attempts.

## Documentation

For more detailed documentation, please refer to the [Wiki](https://github.com/whoekage/bunny-route/wiki).

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for more details.

## License

Bunny Route is [MIT licensed](LICENSE).