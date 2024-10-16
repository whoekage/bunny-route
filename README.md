# 🐇 Bunny Route

Bunny Route is a high-performance, Express-inspired RabbitMQ client for Node.js, designed to streamline and standardize RabbitMQ integration out of the box.

## ✨ Features

- Express-like architecture for familiar and intuitive usage
- Simplified RabbitMQ setup with automatic queue and exchange creation
- Automatic connection management and recovery
- Built-in retry mechanism for failed message processing
- Support for direct messaging patterns
- RPC (Remote Procedure Call) support for request-response scenarios
- Dead-letter queue support for unprocessable messages
- Support for both CommonJS and ES modules
- Flexibility to use custom exchanges or default exchanges based on `appName`
- Compatibility with Nest.js microservices

## 📦 Installation

```bash
npm install bunny-route
```

## 🚀 Usage Examples

### Server (Consumer) Examples

#### Default Exchange (based on appName)

```javascript
const { RMQServer } = require('bunny-route');

const server = new RMQServer({
  uri: 'amqp://localhost',
  appName: 'my-service',
  retryOptions: {
    maxRetries: 3,
    retryTTL: 5000,
    enabled: true
  }
});

server.on('user.created', async (data, ctx) => {
  console.log('New user created:', data);
  // Process the message
});

server.listen().then(() => {
  console.log('Bunny Route server is now listening for messages');
});
```

#### Custom Exchange

```javascript
const { RMQServer } = require('bunny-route');

const server = new RMQServer({
  uri: 'amqp://localhost',
  appName: 'my-service',
  exchange: 'custom-exchange',
  retryOptions: {
    maxRetries: 3,
    retryTTL: 5000,
    enabled: true
  }
});

server.on('user.created', async (data, ctx) => {
  console.log('New user created:', data);
  // Process the message
});

server.listen().then(() => {
  console.log('Bunny Route server is now listening for messages');
});
```

#### Integration with Existing Backend

```javascript
const { RMQClient } = require('bunny-route');

const client = new RMQClient({
  uri: 'amqp://localhost',
  appName: 'my-service',
  exchange: 'existing-exchange'
});

async function publishMessage() {
  await client.connect();
  await client.send('user.created', { id: 123, name: 'John Doe' });
  await client.close();
}

publishMessage().catch(console.error);
```

### Client (Publisher) Examples

#### Default Exchange (based on appName)

```javascript
const { RMQClient } = require('bunny-route');

const client = new RMQClient({
  uri: 'amqp://localhost',
  appName: 'my-service'
});

async function publishMessage() {
  await client.connect();
  await client.send('user.created', { id: 123, name: 'John Doe' });
  await client.close();
}

publishMessage().catch(console.error);
```

#### Custom Exchange

```javascript
const { RMQClient } = require('bunny-route');

const client = new RMQClient({
  uri: 'amqp://localhost',
  appName: 'my-service',
  exchange: 'custom-exchange'
});

async function publishMessage() {
  await client.connect();
  await client.send('user.created', { id: 123, name: 'John Doe' });
  await client.close();
}

publishMessage().catch(console.error);
```

## 🔑 Key Concepts

- **appName**: Used as a prefix for queue names and as the default exchange name if `exchange` is not provided.
- **exchange**: The exchange to use for publishing and consuming messages. If not provided, the `appName` will be used as the exchange name.
- **Queues**: The main queue is named `${appName}`, with additional queues for retries and dead-letters.
- **Routing**: Messages are routed based on the routing keys defined in `on` handlers.

## 🔄 RPC Mechanism

Bunny Route supports RPC-style communication:
- The server can return values from its handlers, which will be sent back to the client for RPC calls.
- The client can make RPC calls using the `send` method with a `timeout` option, which will wait for a response.

## 🚨 Error Handling and Retries

- Failed message processing triggers automatic retries based on the configured `retryOptions`.
- Messages exceeding the maximum retry count are sent to a dead-letter queue (`${appName}.dlq`).
- Connection errors are automatically handled with reconnection attempts.


### Nest.js Compatibility

Bunny Route offers support for Nest.js microservices using RabbitMQ transport. This feature aligns with Nest.js's default RabbitMQ configuration.

> **Note:** The Nest.js approach to RabbitMQ might seem counterintuitive to those familiar with RabbitMQ best practices. 
> Instead of using exchanges and routing keys for message distribution (content-based routing), 
> Nest.js uses a single queue and relies on an internal routing mechanism based on the `pattern` field in the message. 
> While this deviates from traditional RabbitMQ usage patterns and may not fully utilize RabbitMQ's capabilities, 
> it's the standard approach in the Nest.js ecosystem that we need to accommodate for compatibility.
> 
> We will update this documentation if we discover that Nest.js supports more advanced RabbitMQ features like custom bindings.

#### Nest.js Microservice Configuration

First, let's look at how to set up a standard Nest.js microservice using RabbitMQ:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: ['amqp://localhost:5672'],
      queue: 'user-service',
      queueOptions: {
        durable: false
      },
    },
  });
  await app.listen();
}
bootstrap();
```

#### Nest.js Controller with @MessagePattern

Now, let's look at a Nest.js controller that uses `@MessagePattern` to handle incoming messages:

```typescript
// user.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

@Controller()
export class UserController {
  @MessagePattern('user.create')
  async createUser(data: { name: string, email: string }) {
    console.log('Creating user:', data);
    // Create user logic here
    return { status: 'User created successfully' };
  }

  @MessagePattern('user.get')
  async getUser(data: { id: number }) {
    console.log('Fetching user:', data);
    // Get user logic here
    return { id: data.id, name: 'John Doe', email: 'john@example.com' };
  }
}
```

#### Bunny Route Client for Nest.js

To interact with this Nest.js microservice using Bunny Route, configure the RMQClient as follows:

```javascript
const { RMQClient } = require('bunny-route');

const client = new RMQClient({
  uri: 'amqp://localhost',
  appName: 'user-service', // This MUST match the queue name in Nest.js configuration
  exchange: '' // Nest.js uses the default exchange
});

async function interactWithNestService() {
  await client.connect();

  // Create a user
  const createResponse = await client.send(
    'user-service',
    { 
      pattern: 'user.create',
      data: { name: 'John Doe', email: 'john@example.com' }
    }, 
    { nestCompatible: true }
  );
  console.log('Create User Response:', createResponse);

  // Get a user
  const getResponse = await client.send(
    'user-service',
    { 
      pattern: 'user.get',
      data: { id: 1 }
    }, 
    { nestCompatible: true }
  );
  console.log('Get User Response:', getResponse);

  await client.close();
}

interactWithNestService().catch(console.error);
```

Note: 
- The `nestCompatible` option is set to `false` by default. 
- When using `nestCompatible: true`, the `send` method expects:
  - The first parameter to be the queue name (matching the `appName` in RMQClient and the `queue` in Nest.js microservice configuration)
  - The second parameter to be an object with `pattern` (matching `@MessagePattern` in Nest.js) and `data`
- All your data should be nested within the `data` field of your message to ensure proper handling by Nest.js.
- The `pattern` in your client's `send` method should match the `@MessagePattern` decorator in your Nest.js controller.
- Nest.js uses a single queue for the entire microservice, specified in the configuration.
- The routing to specific handlers is done internally by Nest.js based on the `pattern` field.
- This implementation follows Nest.js's default RabbitMQ configuration. If you've customized your Nest.js RabbitMQ setup, you may need to adjust accordingly.

## 📚 Documentation

For more detailed documentation, please refer to the [Wiki](https://github.com/whoekage/bunny-route/wiki).

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for more details.

## 📄 License

Bunny Route is [MIT licensed](LICENSE).