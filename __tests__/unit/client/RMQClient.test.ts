import { describe, it, expect, beforeAll, afterAll, afterEach, vi, type MockInstance } from 'vitest';
import { RMQClient } from '../../../src/client/RMQClient';
import { RMQConnectionManager } from '../../../src/core/RMQConnectionManager';
import { getRabbitMQUri } from '../../setup/rabbitmq';

describe('RMQClient', () => {
  const rabbitmqUri = getRabbitMQUri();

  afterEach(() => {
    RMQConnectionManager.resetInstance();
  });

  describe('Exchange validation', () => {
    let consoleWarnSpy: MockInstance;

    beforeAll(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterAll(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should warn when using default exchange', () => {
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'test-app',
        exchange: '',
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith('Using default exchange.');
    });

    it('should warn when using reserved exchange', () => {
      consoleWarnSpy.mockClear();
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'test-app',
        exchange: 'amq.direct',
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith('Using reserved exchange "amq.direct".');
    });

    it('should not warn for custom exchanges', () => {
      consoleWarnSpy.mockClear();
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'test-app',
        exchange: 'custom-exchange',
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Connection', () => {
    it('should connect successfully with custom exchange', async () => {
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'test-app',
        exchange: 'test-exchange',
      });

      await client.connect();

      expect(RMQConnectionManager.getInstance(rabbitmqUri).isConnected()).toBe(true);

      await client.close();
    });

    it('should connect successfully with reserved exchange', async () => {
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'test-app',
        exchange: 'amq.direct',
      });

      await client.connect();

      expect(RMQConnectionManager.getInstance(rabbitmqUri).isConnected()).toBe(true);

      await client.close();
    });

    it('should close connection properly', async () => {
      const client = new RMQClient({
        uri: rabbitmqUri,
        appName: 'test-app',
        exchange: 'test-exchange',
      });

      await client.connect();
      await client.close();

      // After closing, trying to reconnect should work
      await client.connect();
      expect(RMQConnectionManager.getInstance(rabbitmqUri).isConnected()).toBe(true);
      await client.close();
    });
  });
});
