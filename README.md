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

## 📚 Documentation

For more detailed documentation, please refer to the [Wiki](https://github.com/whoekage/bunny-route/wiki).

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for more details.

## 📄 License

Bunny Route is [MIT licensed](LICENSE).