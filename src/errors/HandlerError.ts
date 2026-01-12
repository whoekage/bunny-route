// ./src/errors/HanlderError.ts
import { RMQBaseError } from './BaseError';

export class RMQHandlerError extends RMQBaseError {
  constructor(message: string = 'Error occurred while handling the message') {
    super(message);
  }
}

export class RMQPublishError extends RMQBaseError {
  constructor(message: string = 'Failed to publish the message') {
    super(message);
  }
}
