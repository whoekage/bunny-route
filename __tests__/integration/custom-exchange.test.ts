import { RMQServer, RMQClient } from '../../src';

describe('Custom Exchange Integration', () => {
    it('should handle messages using custom exchange', async () => {
      const exchange = 'custom-exchange';
      const server = new RMQServer({
        uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
        appName: 'test-app',
        exchange,
      });
      const client = new RMQClient({
        uri: 'amqp://user:drypkZ13j0L24zcf@localhost',
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