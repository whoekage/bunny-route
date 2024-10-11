# Bunny Route

Bunny Route is a high-performance, Express-inspired RabbitMQ client for Node.js, designed to streamline and standardize RabbitMQ integration out of the box.

## Features

- Express-like architecture for familiar and intuitive usage
- Simplified RabbitMQ setup and configuration
- Efficient message routing and handling
- Automatic connection management and recovery
- Support for basic AMQP 0-9-1 messaging patterns

## Installation

```bash
npm install bunny-route
```

## Quick Start

```javascript
import { BunnyApp } from 'bunny-route';

const app = new BunnyApp({
  uri: 'amqp://localhost',
  appName: 'my-app'
});

// Define a route
app.on('user.created', async (data, ctx) => {
  console.log('New user created:', data);
  // Process the message
});

// Start the application
app.listen().then(() => {
  console.log('Bunny Route is now listening for messages');
});
```

## Documentation

For more detailed documentation, please refer to the comments in the source code. Full documentation is coming soon.

## Contributing

We welcome contributions! Please open an issue or submit a pull request on our GitHub repository.

## License

Bunny Route is [MIT licensed](LICENSE).