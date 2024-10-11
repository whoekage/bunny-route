// ./src/errors/ConnectionError.ts

import { RMQBaseError } from './BaseError';

export class RMQConnectionError extends RMQBaseError {
  constructor(message: string = "Failed to establish a connection") {
    super(message);
  }
}

export class RMQChannelError extends RMQBaseError {
  constructor(message: string = "Failed to create a channel") {
    super(message);
  }
}

export class RMQTimeoutError extends RMQBaseError {
  constructor(message: string = "Operation timed out") {
    super(message);
  }
}