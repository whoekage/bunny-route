import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = join(__dirname, '.rabbitmq-state.json');

interface RabbitMQState {
  uri: string;
  containerId: string;
}

function readState(): RabbitMQState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      'RabbitMQ state file not found. Make sure globalSetup has run.\n' +
        'Run tests with: npm test',
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

export function getRabbitMQUri(): string {
  return readState().uri;
}
