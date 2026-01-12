import { afterEach, describe, expect, it } from 'vitest';
import { RMQClient, RMQConnectionManager, RMQServer } from '../../src';
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

    server.on('test-route', async (context, _reply) => {
      receivedMessage = context.content;
    });

    await server.listen({ prefetch: 1 });
    await client.connect();

    // Fire-and-forget: catch to prevent unhandled rejection on close
    client.send('test-route', { test: 'message' }, { timeout: null }).catch(() => {}); // Ignore - will be rejected on close

    // Wait for message to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(receivedMessage).toEqual({ test: 'message' });

    await client.close();
    await server.close();
  });
});
