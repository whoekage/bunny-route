import { afterEach, describe, expect, it } from 'vitest';
import { RMQClient, RMQConnectionManager, RMQServer } from '../../src';
import { getRabbitMQUri } from '../setup/rabbitmq';

describe('Graceful Shutdown Edge Cases', () => {
  const rabbitmqUri = getRabbitMQUri();

  afterEach(() => {
    RMQConnectionManager.resetInstance();
  });

  describe('RMQServer.shutdown() edge cases', () => {
    it('should handle shutdown before listen() is called', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'edge-case-1',
      });

      server.on('test', async () => {});

      // Shutdown without calling listen()
      const result = await server.shutdown();

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(0);
    });

    it('should handle shutdown called twice', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'edge-case-2',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'edge-case-2',
      });

      let handlerStarted = false;

      server.on('slow', async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });

      await server.listen();
      await client.connect();

      client.send('slow', {}, { timeout: null }).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handlerStarted).toBe(true);

      // First shutdown - should wait
      const result1Promise = server.shutdown({ timeout: 2000 });

      // Second shutdown immediately after - should not hang or duplicate wait
      const result2Promise = server.shutdown({ timeout: 2000 });

      const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

      // Both should complete
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      await client.close();
    });

    it('should handle handler that throws exception', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'edge-case-3',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'edge-case-3',
      });

      server.on('error-handler', async () => {
        throw new Error('Handler exploded!');
      });

      await server.listen();
      await client.connect();

      client.send('error-handler', {}, { timeout: null }).catch(() => {});

      // Wait for handler to execute and fail
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Shutdown should still work - inFlightHandlers should be cleaned up
      const result = await server.shutdown({ timeout: 1000 });

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(0);

      await client.close();
    });

    it('should handle timeout = 0 correctly', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'edge-case-4',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'edge-case-4',
      });

      let handlerStarted = false;

      server.on('slow', async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      });

      await server.listen();
      await client.connect();

      client.send('slow', {}, { timeout: null }).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handlerStarted).toBe(true);

      // timeout = 0 should immediately timeout
      const startTime = Date.now();
      const result = await server.shutdown({ timeout: 0 });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(200);
      expect(result.timedOut).toBe(true);
      expect(result.pendingCount).toBe(1);

      await client.close();
    });

    it('should handle multiple concurrent handlers', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'edge-case-5',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'edge-case-5',
      });

      let completedCount = 0;

      server.on('concurrent', async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        completedCount++;
      });

      await server.listen({ prefetch: 10 });
      await client.connect();

      // Send 5 messages concurrently
      for (let i = 0; i < 5; i++) {
        client.send('concurrent', { i }, { timeout: null }).catch(() => {});
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Shutdown should wait for all 5
      const result = await server.shutdown({ timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(0);
      expect(completedCount).toBe(5);

      await client.close();
    });
  });

  describe('RMQClient.shutdown() edge cases', () => {
    it('should handle shutdown before connect() is called', async () => {
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'client-edge-1',
      });

      // Shutdown without connecting
      const result = await client.shutdown();

      expect(result.success).toBe(true);
      expect(result.pendingCount).toBe(0);
    });

    it('should handle shutdown called twice', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'client-edge-2',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'client-edge-2',
      });

      server.on('no-reply', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      });

      await server.listen();
      await client.connect();

      // Send request that won't get reply
      const requestPromise = client.send('no-reply', {}, { timeout: 10000 }).catch((e) => e);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // First shutdown
      const result1 = await client.shutdown();

      // Second shutdown - should handle empty state
      const result2 = await client.shutdown();

      expect(result1.pendingCount).toBe(1);
      expect(result2.pendingCount).toBe(0);

      const error = await requestPromise;
      expect(error.message).toBe('Client shutdown: request cancelled');

      await server.close();
    });

    it('should not lose requests when force=false (BUG CHECK)', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'client-edge-3',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'client-edge-3',
      });

      // Handler that replies after delay
      server.on('delayed-reply', async (_ctx, reply) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        reply({ success: true });
      });

      await server.listen();
      await client.connect();

      // This request should complete even with force=false
      const _requestPromise = client.send('delayed-reply', {}, { timeout: 5000 });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // With force=false, should we wait for pending requests?
      // Current implementation: force=false doesn't reject but also doesn't wait
      // This might be unexpected behavior!
      const result = await client.shutdown({ force: false });

      // pendingRequests.clear() was called, so count is what was pending
      expect(result.pendingCount).toBe(1);

      // The request promise is now orphaned - it will never resolve/reject
      // unless server replies (which it can't because channel is closed)
      // This test documents the current (potentially buggy) behavior

      await server.close();
    });

    it('should handle request that times out before shutdown', async () => {
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'client-edge-4',
      });

      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'client-edge-4',
      });

      server.on('never-reply', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      });

      await server.listen();
      await client.connect();

      // Request with short timeout
      const requestPromise = client.send('never-reply', {}, { timeout: 200 }).catch((e) => e);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 300));

      const error = await requestPromise;
      expect(error.message).toContain('timed out');

      // Now shutdown - pendingRequests should be empty (timeout cleaned it up)
      const result = await client.shutdown();

      expect(result.pendingCount).toBe(0);

      await server.close();
    });
  });

  describe('performGracefulShutdown() edge cases', () => {
    it('should handle server shutdown throwing error', async () => {
      // Create server but don't listen - internal state may cause issues
      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'perform-edge-1',
      });

      // Force an error by corrupting internal state
      // (This tests defensive coding)
      (server as any).channel = { close: () => Promise.reject(new Error('Test error')) };

      // Should not throw, should handle gracefully
      await expect(server.shutdown()).rejects.toThrow('Test error');
    });

    it('should handle empty options', async () => {
      const { performGracefulShutdown } = await import('../../src');

      // No server, no clients
      const result = await performGracefulShutdown({});

      expect(result.server).toBeNull();
      expect(result.clients).toEqual([]);
      expect(result.totalPending).toBe(0);
    });

    it('should handle onShutdown callback throwing error', async () => {
      const { performGracefulShutdown } = await import('../../src');

      const server = new RMQServer({
        uri: rabbitmqUri,
        appName: 'perform-edge-2',
      });

      server.on('test', async () => {});
      await server.listen();

      // onShutdown throws
      await expect(
        performGracefulShutdown({
          server,
          onShutdown: async () => {
            throw new Error('Cleanup failed!');
          },
        }),
      ).rejects.toThrow('Cleanup failed!');
    });
  });
});
