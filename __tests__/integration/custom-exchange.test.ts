import { describe, it, expect, afterEach } from 'vitest';
import { RMQServer, RMQClient, RMQConnectionManager } from '../../src';
import { getRabbitMQUri } from '../setup/rabbitmq';

describe('Custom Exchange Integration', () => {
  const rabbitmqUri = getRabbitMQUri();

  afterEach(() => {
    RMQConnectionManager.resetInstance();
  });

  it('should handle messages using custom exchange', async () => {
    const exchange = 'custom-exchange';

    const server = new RMQServer({
      uri: rabbitmqUri,
      appName: 'test-app',
      exchange,
      reconnect: { maxAttempts: 3 },
    });

    const client = new RMQClient({
      uri: rabbitmqUri,
      appName: 'test-app',
      exchange,
    });

    let receivedMessage: any = null;

    server.on('test-route', async (context, reply) => {
      receivedMessage = context.content;
    });

    await server.listen({ prefetch: 1 });
    await client.connect();

    client.send('test-route', { test: 'message' }, {
      timeout: null,
    });

    // Wait for message to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(receivedMessage).toEqual({ test: 'message' });

    await client.close();
    await server.close();
  });
});
