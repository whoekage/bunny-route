// tests/unit/client/RMQClient.test.ts
import { RMQClient } from '../../../src/client/RMQClient';
import { RMQConnectionManager } from '../../../src/core/RMQConnectionManager';
import * as exchangeUtils from '../../../src/utils/exchangeUtils';

jest.mock('../../../src/core/RMQConnectionManager');
jest.mock('../../../src/utils/exchangeUtils');

describe('RMQClient', () => {
  let client: RMQClient;
  let mockConnectionManager: jest.Mocked<RMQConnectionManager>;
  let mockChannel: any;

  beforeEach(() => {
    mockChannel = {
      assertQueue: jest.fn().mockResolvedValue({ queue: 'mock-queue' }),
      consume: jest.fn(),
      publish: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockConnectionManager = {
      getInstance: jest.fn().mockReturnThis(),
      createChannel: jest.fn().mockImplementation(async (setup?: (channel: any) => Promise<void>) => {
        // Call setup callback if provided (like real implementation)
        if (setup) {
          await setup(mockChannel);
        }
        return mockChannel;
      }),
      on: jest.fn().mockReturnThis(),
      off: jest.fn().mockReturnThis(),
      emit: jest.fn().mockReturnThis(),
      getState: jest.fn().mockReturnValue('connected'),
      isConnected: jest.fn().mockReturnValue(true),
      unregisterChannel: jest.fn(),
    } as any;

    (RMQConnectionManager.getInstance as jest.Mock).mockReturnValue(mockConnectionManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should validate custom exchange in constructor', () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
      exchange: 'custom-exchange'
    });
    expect(exchangeUtils.validateExchange).toHaveBeenCalledWith('custom-exchange');
  });

  it('should validate default exchange in constructor', () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
      exchange: ''
    });
    expect(exchangeUtils.validateExchange).toHaveBeenCalledWith('');
  });

  it('should validate reserved exchange in constructor', () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
      exchange: 'amq.direct'
    });
    expect(exchangeUtils.validateExchange).toHaveBeenCalledWith('amq.direct');
  });

  it('should assert custom exchange during connect', async () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
      exchange: 'custom-exchange'
    });
    await client.connect();
    expect(exchangeUtils.assertExchange).toHaveBeenCalledWith(expect.objectContaining({
      assertQueue: expect.any(Function),
      consume: expect.any(Function),
      publish: expect.any(Function),
    }), 'custom-exchange');
  });

  it('should not assert reserved exchange during connect', async () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
      exchange: 'amq.direct'
    });
    await client.connect();
    expect(exchangeUtils.assertExchange).toHaveBeenCalledWith(expect.objectContaining({
      assertQueue: expect.any(Function),
      consume: expect.any(Function),
      publish: expect.any(Function),
    }), 'amq.direct');
  });

  it('should setup connection listeners on construction', () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
    });
    expect(mockConnectionManager.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    expect(mockConnectionManager.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
    expect(mockConnectionManager.on).toHaveBeenCalledWith('reconnected', expect.any(Function));
    expect(mockConnectionManager.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should unregister channel on close', async () => {
    client = new RMQClient({
      uri: 'amqp://localhost',
      appName: 'test-app',
    });
    await client.connect();
    await client.close();
    expect(mockConnectionManager.unregisterChannel).toHaveBeenCalledWith(mockChannel);
  });
});
