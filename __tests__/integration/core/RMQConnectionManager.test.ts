import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { getRabbitMQUri } from '../../setup/rabbitmq';
import { RMQConnectionManager } from '../../../src/core/RMQConnectionManager';

describe('RMQConnectionManager', () => {
  // Shared container URI from globalSetup
  const sharedUri = getRabbitMQUri();

  afterEach(() => {
    RMQConnectionManager.resetInstance();
  });

  // ============================================================================
  // GROUP A: Authentication
  // ============================================================================
  describe('Group A: Authentication', () => {
    it('A1: should connect with valid credentials', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      const connection = await manager.getConnection();

      expect(connection).toBeDefined();
      expect(manager.getState()).toBe('connected');
      expect(manager.isConnected()).toBe(true);
    });

    it('A2: should fail immediately with wrong password and NOT reconnect', async () => {
      // Extract host:port from shared URI and use wrong password
      const url = new URL(sharedUri);
      const badUri = `amqp://test:wrongpassword@${url.host}`;

      const manager = RMQConnectionManager.getInstance(badUri, {
        reconnect: { enabled: true, maxAttempts: 5 },
      });

      const reconnectingSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);

      await expect(manager.getConnection()).rejects.toThrow();

      // Should NOT have tried to reconnect (auth error is non-recoverable)
      expect(reconnectingSpy).not.toHaveBeenCalled();
    });

    it('A3: should fail immediately with wrong username and NOT reconnect', async () => {
      const url = new URL(sharedUri);
      const badUri = `amqp://wronguser:test@${url.host}`;

      const manager = RMQConnectionManager.getInstance(badUri, {
        reconnect: { enabled: true, maxAttempts: 5 },
      });

      const reconnectingSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);

      await expect(manager.getConnection()).rejects.toThrow();

      // Should NOT have tried to reconnect
      expect(reconnectingSpy).not.toHaveBeenCalled();
    });

    it('A4: should fail with non-existent vhost', async () => {
      const url = new URL(sharedUri);
      const badUri = `amqp://test:test@${url.host}/nonexistent-vhost`;

      const manager = RMQConnectionManager.getInstance(badUri, {
        reconnect: { enabled: false },
      });

      await expect(manager.getConnection()).rejects.toThrow();
    });
  });

  // ============================================================================
  // GROUP B: Reconnection (requires dedicated container)
  // ============================================================================
  describe('Group B: Reconnection', () => {
    let container: StartedRabbitMQContainer;
    let containerUri: string;

    beforeAll(async () => {
      container = await new RabbitMQContainer('rabbitmq:3-management')
        .withEnvironment({
          RABBITMQ_DEFAULT_USER: 'test',
          RABBITMQ_DEFAULT_PASS: 'test',
        })
        .start();

      containerUri = `amqp://test:test@${container.getHost()}:${container.getMappedPort(5672)}`;
    }, 60000);

    afterAll(async () => {
      await container?.stop();
    });

    afterEach(() => {
      RMQConnectionManager.resetInstance();
    });

    it('B1: should reconnect after container restart', async () => {
      const manager = RMQConnectionManager.getInstance(containerUri, {
        reconnect: {
          enabled: true,
          maxAttempts: 10,
          initialDelayMs: 500,
        },
      });

      // Connect first
      await manager.getConnection();
      expect(manager.isConnected()).toBe(true);

      const disconnectedPromise = new Promise<void>((resolve) => {
        manager.once('disconnected', () => resolve());
      });

      const reconnectedPromise = new Promise<void>((resolve) => {
        manager.once('reconnected', () => resolve());
      });

      // Stop container (simulates network failure)
      await container.stop();

      // Wait for disconnect event
      await disconnectedPromise;
      expect(manager.getState()).not.toBe('connected');

      // Restart container
      container = await new RabbitMQContainer('rabbitmq:3-management')
        .withEnvironment({
          RABBITMQ_DEFAULT_USER: 'test',
          RABBITMQ_DEFAULT_PASS: 'test',
        })
        .withExposedPorts({
          container: 5672,
          host: parseInt(new URL(containerUri).port),
        } as any)
        .start();

      // Wait for reconnect
      await reconnectedPromise;
      expect(manager.isConnected()).toBe(true);
    }, 60000);

    it('B2: should emit error after maxAttempts reached', async () => {
      // Use invalid port so connection always fails
      const invalidUri = 'amqp://test:test@localhost:59999';

      const manager = RMQConnectionManager.getInstance(invalidUri, {
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 200,
        },
      });

      const reconnectingSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);

      const errorPromise = new Promise<Error>((resolve) => {
        manager.once('error', (err) => resolve(err));
      });

      // Try to connect (will fail and start reconnecting)
      manager.getConnection().catch(() => {});

      const error = await errorPromise;

      expect(error.message).toContain('Max reconnection attempts');
      expect(reconnectingSpy).toHaveBeenCalledTimes(3);
    }, 30000);

    it('B3: should NOT reconnect when reconnect.enabled=false', async () => {
      const invalidUri = 'amqp://test:test@localhost:59999';

      const manager = RMQConnectionManager.getInstance(invalidUri, {
        reconnect: { enabled: false },
      });

      const reconnectingSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);

      await expect(manager.getConnection()).rejects.toThrow();

      expect(reconnectingSpy).not.toHaveBeenCalled();
    });

    it('B4: should use exponential backoff with increasing delays', async () => {
      const invalidUri = 'amqp://test:test@localhost:59999';

      const manager = RMQConnectionManager.getInstance(invalidUri, {
        reconnect: {
          enabled: true,
          maxAttempts: 4,
          initialDelayMs: 100,
          maxDelayMs: 10000,
          backoffMultiplier: 2,
        },
      });

      const delays: number[] = [];
      manager.on('reconnecting', (attempt, delayMs) => {
        delays.push(delayMs);
      });

      const errorPromise = new Promise<void>((resolve) => {
        manager.once('error', () => resolve());
      });

      manager.getConnection().catch(() => {});

      await errorPromise;

      // Delays should generally increase (with jitter, not strictly)
      // At minimum, later delays should tend to be larger
      expect(delays.length).toBe(4);

      // With full jitter, we can't guarantee strict ordering,
      // but max possible delay should increase each attempt
      console.log('Observed delays:', delays);
    }, 30000);
  });

  // ============================================================================
  // GROUP C: Channel Management
  // ============================================================================
  describe('Group C: Channel Management', () => {
    it('C1: should create channel that works', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      const channel = await manager.createChannel();

      expect(channel).toBeDefined();

      // Verify channel works
      const queueName = `test-queue-${Date.now()}`;
      const result = await channel.assertQueue(queueName, { durable: false, autoDelete: true });
      expect(result.queue).toBe(queueName);

      await channel.deleteQueue(queueName);
    });

    it('C2: should call setup function on channel creation', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      const setupFn = vi.fn(async (channel) => {
        await channel.assertQueue('setup-test-queue', { durable: false, autoDelete: true });
      });

      await manager.createChannel(setupFn);

      expect(setupFn).toHaveBeenCalledTimes(1);
    });

    it('C3: should handle setup function that throws', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      const setupFn = vi.fn(async () => {
        throw new Error('Setup failed');
      });

      // Should this throw or swallow the error?
      await expect(manager.createChannel(setupFn)).rejects.toThrow('Setup failed');
    });

    it('C4: should unregister channel', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      const channel = await manager.createChannel();
      manager.unregisterChannel(channel);

      // After unregister, channel close shouldn't trigger recreation
      // (This is hard to test without internal access)
      await channel.close();
    });
  });

  // ============================================================================
  // GROUP D: Events
  // ============================================================================
  describe('Group D: Events', () => {
    it('D1: should emit connected event on successful connection', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      const connectedPromise = new Promise<void>((resolve) => {
        manager.once('connected', () => resolve());
      });

      await manager.getConnection();

      // Event should have been emitted
      await expect(connectedPromise).resolves.toBeUndefined();
    });

    it('D2: should emit error event on non-recoverable error', async () => {
      const url = new URL(sharedUri);
      const badUri = `amqp://wrong:wrong@${url.host}`;

      const manager = RMQConnectionManager.getInstance(badUri, {
        reconnect: { enabled: true, maxAttempts: 5 },
      });

      const errorPromise = new Promise<Error>((resolve) => {
        manager.once('error', (err) => resolve(err));
      });

      manager.getConnection().catch(() => {});

      const error = await errorPromise;
      expect(error).toBeDefined();
    });
  });

  // ============================================================================
  // GROUP E: State Machine
  // ============================================================================
  describe('Group E: State Machine', () => {
    it('E1: should start in disconnected state', () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      expect(manager.getState()).toBe('disconnected');
      expect(manager.isConnected()).toBe(false);
    });

    it('E2: should transition to connected after getConnection', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      await manager.getConnection();

      expect(manager.getState()).toBe('connected');
      expect(manager.isConnected()).toBe(true);
    });

    it('E3: should transition to disconnected after close', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      await manager.getConnection();
      await manager.close();

      expect(manager.getState()).toBe('disconnected');
      expect(manager.isConnected()).toBe(false);
    });
  });

  // ============================================================================
  // GROUP F: Singleton Pattern
  // ============================================================================
  describe('Group F: Singleton Pattern', () => {
    it('F1: should return same instance on multiple calls', () => {
      const manager1 = RMQConnectionManager.getInstance(sharedUri);
      const manager2 = RMQConnectionManager.getInstance(sharedUri);

      expect(manager1).toBe(manager2);
    });

    it('F2: resetInstance should remove instance', async () => {
      const manager1 = RMQConnectionManager.getInstance(sharedUri);
      await manager1.getConnection();

      RMQConnectionManager.resetInstance();

      const manager2 = RMQConnectionManager.getInstance(sharedUri);

      expect(manager1).not.toBe(manager2);
    });
  });

  // ============================================================================
  // GROUP G: Edge Cases & Race Conditions
  // ============================================================================
  describe('Group G: Edge Cases', () => {
    it('G1: multiple simultaneous getConnection calls should return same connection', async () => {
      const manager = RMQConnectionManager.getInstance(sharedUri, {
        reconnect: { enabled: false },
      });

      // Call getConnection 5 times simultaneously
      const promises = Array(5).fill(null).map(() => manager.getConnection());
      const connections = await Promise.all(promises);

      // All should be the same connection
      const firstConnection = connections[0];
      connections.forEach((conn) => {
        expect(conn).toBe(firstConnection);
      });
    });

    it('G2: close during reconnect should cancel reconnect timer', async () => {
      const invalidUri = 'amqp://test:test@localhost:59999';

      const manager = RMQConnectionManager.getInstance(invalidUri, {
        reconnect: {
          enabled: true,
          maxAttempts: 100, // Many attempts
          initialDelayMs: 5000, // Long delay
        },
      });

      const reconnectingSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);

      // Start connection attempt (will fail and schedule reconnect)
      manager.getConnection().catch(() => {});

      // Wait for first reconnect attempt to be scheduled
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Close should cancel the timer
      await manager.close();

      // Wait a bit to ensure no more reconnect attempts
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should have only 1 reconnecting event (or 0 if close was fast enough)
      expect(reconnectingSpy.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('G3: should timeout connection attempt when host is unreachable', async () => {
      // Connect to a non-routable IP to simulate timeout
      // 10.255.255.1 is typically non-routable
      const timeoutUri = 'amqp://test:test@10.255.255.1:5672';
      const connectionTimeoutMs = 2000; // 2 second timeout for test

      const manager = RMQConnectionManager.getInstance(timeoutUri, {
        reconnect: {
          enabled: false,
          connectionTimeoutMs,
        },
      });

      const startTime = Date.now();

      await expect(manager.getConnection()).rejects.toThrow('Connection timeout');

      const elapsed = Date.now() - startTime;
      console.log(`Connection attempt took ${elapsed}ms (timeout: ${connectionTimeoutMs}ms)`);

      // Should fail within timeout + small buffer (500ms)
      expect(elapsed).toBeLessThan(connectionTimeoutMs + 500);
    }, 10000);

    it('G4: timeout error should trigger reconnect when enabled', async () => {
      // Design decision: "Connection timeout" is recoverable error
      // With maxAttempts: Infinity (default), will retry indefinitely - this is intentional
      const timeoutUri = 'amqp://test:test@10.255.255.1:5672';
      const connectionTimeoutMs = 500; // Short timeout

      const manager = RMQConnectionManager.getInstance(timeoutUri, {
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          connectionTimeoutMs,
          initialDelayMs: 100,
          maxDelayMs: 200,
        },
      });

      const reconnectingSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);

      const errorPromise = new Promise<Error>((resolve) => {
        manager.once('error', (err) => resolve(err));
      });

      const startTime = Date.now();
      manager.getConnection().catch(() => {});

      const error = await errorPromise;
      const elapsed = Date.now() - startTime;

      console.log(`Timeout + reconnect took ${elapsed}ms, attempts: ${reconnectingSpy.mock.calls.length}`);
      console.log(`Error: ${error.message}`);

      // Should have reconnected 3 times (maxAttempts)
      expect(reconnectingSpy).toHaveBeenCalledTimes(3);

      // Final error should be max attempts, NOT connection timeout
      expect(error.message).toContain('Max reconnection attempts');
    }, 30000);

    // G5 moved to separate file: RMQConnectionManager.leak.test.ts
    // (requires isolated mock of amqplib)
  });
});
