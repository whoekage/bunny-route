import { afterEach, describe, expect, it } from 'vitest';
import { RMQClient, RMQConnectionManager, RMQServer, performGracefulShutdown } from '../../src';
import { getRabbitMQUri } from '../setup/rabbitmq';

describe('Graceful Shutdown', () => {
  const rabbitmqUri = getRabbitMQUri();

  afterEach(() => {
    RMQConnectionManager.resetInstance();
  });

  describe('RMQServer.shutdown()', () => {
    it('should wait for in-flight handlers to complete', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'shutdown-test-1',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'shutdown-test-1',
      });

      let handlerStarted = false;
      let handlerCompleted = false;

      server.on('slow-handler', async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        handlerCompleted = true;
      });

      await server.listen({ prefetch: 1 });
      await client.connect();

      // Send message without waiting for response (catch to prevent unhandled rejection on close)
      client.send('slow-handler', { test: 'data' }, { timeout: null }).catch(() => {});

      // Wait for handler to start
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handlerStarted).toBe(true);
      expect(handlerCompleted).toBe(false);

      // Shutdown should wait for handler to complete
      const result = await server.shutdown({ timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(handlerCompleted).toBe(true);

      await client.close();
    });

    it('should timeout if handlers take too long', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'shutdown-test-2',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'shutdown-test-2',
      });

      let handlerStarted = false;

      server.on('very-slow-handler', async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      });

      await server.listen({ prefetch: 1 });
      await client.connect();

      client.send('very-slow-handler', { test: 'data' }, { timeout: null }).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handlerStarted).toBe(true);

      // Shutdown with short timeout
      const result = await server.shutdown({ timeout: 300 });

      expect(result.success).toBe(false);
      expect(result.pendingCount).toBe(1);
      expect(result.timedOut).toBe(true);

      await client.close();
    });

    it('should close immediately with force option', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'shutdown-test-3',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'shutdown-test-3',
      });

      let handlerStarted = false;

      server.on('slow-handler', async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      });

      await server.listen({ prefetch: 1 });
      await client.connect();

      client.send('slow-handler', { test: 'data' }, { timeout: null }).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handlerStarted).toBe(true);

      const startTime = Date.now();
      const result = await server.shutdown({ force: true });
      const elapsed = Date.now() - startTime;

      // Should be fast (not waiting for 5s handler)
      expect(elapsed).toBeLessThan(200);
      expect(result.pendingCount).toBe(1);

      await client.close();
    });

    it('should return success when no handlers are running', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'shutdown-test-4',
      });

      server.on('test-route', async () => {});

      await server.listen({ prefetch: 1 });

      const result = await server.shutdown({ timeout: 1000 });

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(0);
      expect(result.timedOut).toBe(false);
    });
  });

  describe('RMQClient.shutdown()', () => {
    it('should reject pending RPC requests on shutdown', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'client-shutdown-test-1',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'client-shutdown-test-1',
      });

      // Handler that never replies
      server.on('no-reply', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      });

      await server.listen({ prefetch: 1 });
      await client.connect();

      // Catch rejection immediately to prevent unhandled rejection
      let rejectionError: Error | null = null;
      const requestPromise = client
        .send('no-reply', { test: 'data' }, { timeout: 10000 })
        .catch((err) => {
          rejectionError = err;
        });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await client.shutdown();

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(1);

      // Wait for promise to settle
      await requestPromise;
      expect(rejectionError?.message).toBe('Client shutdown: request cancelled');

      await server.close();
    });

    it('should report pending count correctly', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'client-shutdown-test-2',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'client-shutdown-test-2',
      });

      server.on('no-reply', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      });

      await server.listen({ prefetch: 3 });
      await client.connect();

      // Catch rejections immediately to prevent unhandled rejection
      const errors: (Error | null)[] = [null, null, null];
      const promises = [
        client.send('no-reply', { id: 1 }, { timeout: 10000 }).catch((err) => {
          errors[0] = err;
        }),
        client.send('no-reply', { id: 2 }, { timeout: 10000 }).catch((err) => {
          errors[1] = err;
        }),
        client.send('no-reply', { id: 3 }, { timeout: 10000 }).catch((err) => {
          errors[2] = err;
        }),
      ];

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await client.shutdown();

      expect(result.pendingCount).toBe(3);

      // Wait for all promises to settle
      await Promise.all(promises);

      for (const err of errors) {
        expect(err?.message).toBe('Client shutdown: request cancelled');
      }

      await server.close();
    });
  });

  describe('performGracefulShutdown()', () => {
    it('should shutdown server and clients', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'graceful-test',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'graceful-test',
      });

      server.on('test', async () => {});

      await server.listen();
      await client.connect();

      const result = await performGracefulShutdown({
        server,
        clients: [client],
        timeout: 5000,
      });

      expect(result.server).not.toBeNull();
      expect(result.server?.success).toBe(true);
      expect(result.clients.length).toBe(1);
      expect(result.totalPending).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('should call onShutdown callback', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'callback-test',
      });

      server.on('test', async () => {});
      await server.listen();

      let callbackCalled = false;

      await performGracefulShutdown({
        server,
        onShutdown: async () => {
          callbackCalled = true;
        },
      });

      expect(callbackCalled).toBe(true);
    });
  });
});
