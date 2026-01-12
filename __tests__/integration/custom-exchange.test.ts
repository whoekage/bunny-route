import { RMQServer, RMQClient, RMQConnectionManager } from '../../src';

describe('Custom Exchange Integration', () => {
    // Use env variable or default docker-compose credentials
    const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://user:password@localhost';

    afterEach(async () => {
      // Reset connection manager to stop any reconnection attempts
      RMQConnectionManager.resetInstance();
    });

    it('should handle messages using custom exchange', async () => {
      const exchange = 'custom-exchange';

      const server = new RMQServer({
        uri: RABBITMQ_URI,
        appName: 'test-app',
        exchange,
        reconnect: { maxAttempts: 3 }, // Limit reconnection attempts for tests
      });

      const client = new RMQClient({
        uri: RABBITMQ_URI,
        appName: 'test-app',
        exchange,
      });

      await server.listen({ prefetch: 1 });
      await client.connect();

      // Set up message handler
      server.on('test-route', async (data) => {
        console.log('Received message:', data);
        expect(data).toEqual({ test: 'message' });
      });

      // Send message
      client.send('test-route', { test: 'message' }, {
        timeout: null,
      });

      // Wait for message to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      await client.close();
      await server.close();
    }, 20000);
  });
