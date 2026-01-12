import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';

const RABBITMQ_USER = 'test';
const RABBITMQ_PASS = 'test';
const STATE_FILE = join(__dirname, '.rabbitmq-state.json');

let container: StartedRabbitMQContainer;

export async function setup() {
  console.log('\n🐰 Starting RabbitMQ container...');

  container = await new RabbitMQContainer('rabbitmq:3-management')
    .withEnvironment({
      RABBITMQ_DEFAULT_USER: RABBITMQ_USER,
      RABBITMQ_DEFAULT_PASS: RABBITMQ_PASS,
    })
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5672);
  const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${host}:${port}`;

  // Write state to file for tests to read
  writeFileSync(STATE_FILE, JSON.stringify({ uri, containerId: container.getId() }));

  console.log(`✅ RabbitMQ started at ${uri}\n`);

  // Return teardown function (runs in same context)
  return async () => {
    console.log('\n🛑 Stopping RabbitMQ container...');
    await container.stop();
    console.log('✅ RabbitMQ stopped\n');
  };
}

export default setup;
