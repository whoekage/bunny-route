/**
 * Isolated test for resource leak bug in RMQConnectionManager.
 * Requires mocking amqplib to simulate slow connection that completes after timeout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock control - must be defined before vi.mock
const mockState = vi.hoisted(() => ({
  connectDelay: 0,
  connectionCloseSpy: null as ReturnType<typeof vi.fn> | null,
}));

// Mock amqplib - hoisted to top of file
vi.mock('amqplib', () => {
  const mockConnect = vi.fn(async () => {
    if (mockState.connectDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, mockState.connectDelay));
      return {
        close: mockState.connectionCloseSpy,
        on: vi.fn(),
        once: vi.fn(),
        createChannel: vi.fn(),
        removeListener: vi.fn(),
      };
    }
    throw new Error('Mock not activated - set mockState.connectDelay > 0');
  });

  return {
    default: { connect: mockConnect },
    connect: mockConnect,
  };
});

// Import AFTER mock
import { RMQConnectionManager } from '../../../src/core/RMQConnectionManager';

describe('RMQConnectionManager Resource Leak', () => {
  afterEach(() => {
    RMQConnectionManager.resetInstance();
    mockState.connectDelay = 0;
    mockState.connectionCloseSpy = null;
  });

  it('G5: should close connection established after timeout to prevent leak', async () => {
    // When timeout fires BEFORE amqp.connect() completes,
    // if the connection later succeeds, it must be closed automatically.

    // Activate mock: connection takes 500ms to establish
    mockState.connectDelay = 500;
    mockState.connectionCloseSpy = vi.fn();

    const testUri = 'amqp://test:test@fake-host-for-leak-test:5672';
    const manager = RMQConnectionManager.getInstance(testUri, {
      reconnect: {
        enabled: false,
        connectionTimeoutMs: 100, // Timeout before connection completes (100ms < 500ms)
      },
    });

    // This should timeout after 100ms
    await expect(manager.getConnection()).rejects.toThrow('Connection timeout');

    // Wait for the "leaked" connection to be established (500ms)
    await new Promise((resolve) => setTimeout(resolve, 600));

    // FIXED: The connection should now be closed automatically
    console.log(
      `Connection close called: ${mockState.connectionCloseSpy?.mock.calls.length} times`,
    );

    // Connection that was established after timeout should be closed
    expect(mockState.connectionCloseSpy).toHaveBeenCalled();
  }, 10000);
});
