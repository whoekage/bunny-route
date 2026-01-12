/**
 * Dead Letter Queue (DLQ) Processor
 *
 * This is a separate process that monitors the DLQ and handles failed messages.
 *
 * In production, you might:
 * - Send alerts to Slack/PagerDuty
 * - Store in database for manual review
 * - Attempt to fix and reprocess
 * - Move to archive after handling
 *
 * Run: npx tsx examples/06-retry-dlq/dlq-processor.ts
 */

import * as amqp from 'amqplib';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';
const APP_NAME = 'retry-demo';
const DLQ_NAME = `${APP_NAME}.dlq`;
const EXCHANGE_NAME = APP_NAME;

interface DLQMessage {
  routingKey: string;
  retryCount: number;
  originalRoutingKey: string;
  content: unknown;
  timestamp: Date;
  error?: string;
}

async function main() {
  console.log('='.repeat(60));
  console.log('DLQ Processor Starting...');
  console.log('='.repeat(60));
  console.log(`\nMonitoring queue: ${DLQ_NAME}`);
  console.log('Waiting for failed messages...\n');

  // Connect directly to RabbitMQ (not using bunny-route for DLQ)
  const connection = await amqp.connect(RABBITMQ_URI);
  const channel = await connection.createChannel();

  // Ensure DLQ exists (it should be created by the server)
  await channel.assertQueue(DLQ_NAME, { durable: true });

  // Process one message at a time
  channel.prefetch(1);

  // ============================================================
  // DLQ Consumer
  // ============================================================
  await channel.consume(DLQ_NAME, async (msg) => {
    if (!msg) return;

    const dlqMessage = parseDLQMessage(msg);

    console.log('=' .repeat(50));
    console.log('FAILED MESSAGE RECEIVED');
    console.log('=' .repeat(50));
    console.log(`  Routing Key: ${dlqMessage.originalRoutingKey}`);
    console.log(`  Retry Count: ${dlqMessage.retryCount}`);
    console.log(`  Timestamp:   ${dlqMessage.timestamp.toISOString()}`);
    console.log(`  Content:     ${JSON.stringify(dlqMessage.content, null, 2)}`);
    console.log('');

    // ============================================================
    // Handle different failure types
    // ============================================================
    const action = await handleFailedMessage(dlqMessage, channel);

    switch (action) {
      case 'reprocess':
        console.log('  ACTION: Reprocessing message...');
        await reprocessMessage(channel, msg, dlqMessage);
        break;

      case 'archive':
        console.log('  ACTION: Archiving message (would save to DB)');
        // In production: save to database, S3, etc.
        break;

      case 'alert':
        console.log('  ACTION: Sending alert (would notify team)');
        // In production: send to Slack, PagerDuty, etc.
        break;

      case 'discard':
        console.log('  ACTION: Discarding message');
        break;
    }

    // Acknowledge the message (remove from DLQ)
    channel.ack(msg);
    console.log('  STATUS: Message handled and removed from DLQ');
    console.log('');
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down DLQ processor...');
    await channel.close();
    await connection.close();
    process.exit(0);
  });
}

// ============================================================
// Parse DLQ Message
// ============================================================
function parseDLQMessage(msg: amqp.ConsumeMessage): DLQMessage {
  const headers = msg.properties.headers || {};

  let content: unknown;
  try {
    content = JSON.parse(msg.content.toString());
  } catch {
    content = msg.content.toString();
  }

  return {
    routingKey: msg.fields.routingKey,
    retryCount: headers['x-retry-count'] || 0,
    originalRoutingKey: headers['x-original-routing-key'] || msg.fields.routingKey,
    content,
    timestamp: new Date(),
  };
}

// ============================================================
// Determine action based on message type
// ============================================================
type Action = 'reprocess' | 'archive' | 'alert' | 'discard';

async function handleFailedMessage(msg: DLQMessage, _channel: amqp.Channel): Promise<Action> {
  // Validation errors - just archive, don't retry
  if (msg.originalRoutingKey === 'user.validate') {
    console.log('  ANALYSIS: Validation error - will archive');
    return 'archive';
  }

  // Payment failures - alert the team
  if (msg.originalRoutingKey === 'payment.charge') {
    console.log('  ANALYSIS: Payment failure - sending alert');
    return 'alert';
  }

  // Order processing - try to reprocess once more
  if (msg.originalRoutingKey === 'order.process') {
    // Only reprocess if we haven't already tried too many times
    if (msg.retryCount < 5) {
      console.log('  ANALYSIS: Order failure - will attempt reprocess');
      return 'reprocess';
    } else {
      console.log('  ANALYSIS: Order failed too many times - archiving');
      return 'archive';
    }
  }

  // Default: archive
  return 'archive';
}

// ============================================================
// Reprocess message (move back to main queue)
// ============================================================
async function reprocessMessage(
  channel: amqp.Channel,
  originalMsg: amqp.ConsumeMessage,
  dlqMessage: DLQMessage
): Promise<void> {
  // Create new headers without retry count (fresh start)
  // Or increment a "dlq-reprocess-count" to track DLQ reprocessing
  const headers = { ...originalMsg.properties.headers };
  delete headers['x-retry-count'];
  headers['x-dlq-reprocess-count'] = (headers['x-dlq-reprocess-count'] || 0) + 1;
  headers['x-dlq-reprocess-time'] = new Date().toISOString();

  // Republish to the exchange with original routing key
  channel.publish(
    EXCHANGE_NAME,
    dlqMessage.originalRoutingKey,
    originalMsg.content,
    {
      headers,
      persistent: true,
    }
  );

  console.log(`  REPROCESS: Sent back to ${dlqMessage.originalRoutingKey}`);
}

main().catch(console.error);
