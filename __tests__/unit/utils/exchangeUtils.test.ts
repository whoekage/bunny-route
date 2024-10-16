import { isReservedExchange, validateExchange, assertExchange } from '../../../src/utils/exchangeUtils';

describe('Exchange Utilities', () => {
  describe('isReservedExchange', () => {
    it('should return true for reserved exchanges', () => {
      expect(isReservedExchange('')).toBe(true);
      expect(isReservedExchange('amq.direct')).toBe(true);
      expect(isReservedExchange('amq.fanout')).toBe(true);
      expect(isReservedExchange('amq.topic')).toBe(true);
      expect(isReservedExchange('amq.headers')).toBe(true);
      expect(isReservedExchange('amq.match')).toBe(true);
    });

    it('should return false for non-reserved exchanges', () => {
      expect(isReservedExchange('my-exchange')).toBe(false);
      expect(isReservedExchange('custom.exchange')).toBe(false);
    });
  });

  describe('validateExchange', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should warn when using default exchange', () => {
      validateExchange('');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Using default exchange.');
    });

    it('should warn when using reserved exchange', () => {
      validateExchange('amq.direct');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Using reserved exchange "amq.direct".');
    });

    it('should not warn for custom exchanges', () => {
      validateExchange('my-custom-exchange');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('assertExchange', () => {
    let channelMock: { assertExchange: jest.Mock };
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      channelMock = { assertExchange: jest.fn() };
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('should assert exchange for non-reserved exchanges', async () => {
      await assertExchange(channelMock as any, 'my-exchange');
      expect(channelMock.assertExchange).toHaveBeenCalledWith('my-exchange', 'direct', { durable: true });
    });

    it('should not assert exchange for reserved exchanges', async () => {
      await assertExchange(channelMock as any, 'amq.direct');
      expect(channelMock.assertExchange).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Skipping assertion for reserved exchange "amq.direct".');
    });
  });
});