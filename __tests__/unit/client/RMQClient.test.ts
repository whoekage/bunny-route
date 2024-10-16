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
    };

    mockConnectionManager = {
      getInstance: jest.fn().mockReturnThis(),
      createChannel: jest.fn().mockResolvedValue(mockChannel),
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

  // Add more tests for other RMQClient methods...
});