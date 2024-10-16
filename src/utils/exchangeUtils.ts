// src/utils/exchangeUtils.ts

const RESERVED_EXCHANGES = ['', 'amq.direct', 'amq.fanout', 'amq.topic', 'amq.headers', 'amq.match'];

export function isReservedExchange(exchange: string): boolean {
  return RESERVED_EXCHANGES.includes(exchange);
}

export function validateExchange(exchange: string): void {
  if (exchange === '') {
    console.warn("Using default exchange.");
  } else if (isReservedExchange(exchange)) {
    console.warn(`Using reserved exchange "${exchange}".`);
  }
}

export async function assertExchange(channel: any, exchange: string, type: string = 'direct', options: any = { durable: true }): Promise<void> {
  if (!isReservedExchange(exchange)) {
    await channel.assertExchange(exchange, type, options);
  } else {
    console.log(`Skipping assertion for reserved exchange "${exchange}".`);
  }
}