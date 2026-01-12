/**
 * Kubernetes-style Graceful Shutdown
 *
 * Demonstrates:
 * - setupGracefulShutdown() for automatic SIGTERM/SIGINT handling
 * - Proper cleanup in containerized environments
 *
 * This pattern is essential for Kubernetes deployments where
 * pods receive SIGTERM before being killed.
 *
 * Run: npx tsx examples/03-graceful-shutdown/kubernetes.ts
 * Then press Ctrl+C to trigger graceful shutdown
 */

import { RMQClient, RMQServer, setupGracefulShutdown } from '../../src';

const RABBITMQ_URI = process.env.RABBITMQ_URI || 'amqp://guest:guest@localhost:5672';

async function main() {
  console.log('Starting service (press Ctrl+C to shutdown gracefully)\n');

  const server = new RMQServer({
    uri: RABBITMQ_URI,
    appName: 'k8s-example',
  });

  const client = new RMQClient({
    uri: RABBITMQ_URI,
    appName: 'k8s-example',
  });

  // Handler that simulates work
  server.on('process.job', async (ctx, reply) => {
    const jobId = ctx.content.id;
    console.log(`[job ${jobId}] Processing started...`);

    // Simulate 5 second job
    for (let i = 1; i <= 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log(`[job ${jobId}] Progress: ${i * 20}%`);
    }

    console.log(`[job ${jobId}] Completed!`);
    reply({ success: true, jobId });
  });

  await server.listen({ prefetch: 5 });
  await client.connect();

  // Setup automatic graceful shutdown
  // This will:
  // 1. Stop accepting new messages
  // 2. Wait for in-flight handlers to complete (up to 30s)
  // 3. Clean up resources
  // 4. Exit process
  setupGracefulShutdown({
    server,
    clients: [client],
    timeout: 30000,
    onShutdown: async () => {
      console.log('[cleanup] Running custom cleanup...');
      // Add your cleanup logic here:
      // - Close database connections
      // - Flush logs
      // - etc.
    },
  });

  console.log('Service is running. Handlers will process jobs.\n');
  console.log('To test graceful shutdown:');
  console.log('1. In another terminal, send some jobs');
  console.log('2. Press Ctrl+C while jobs are processing');
  console.log('3. Watch how the service waits for jobs to complete\n');

  // Simulate incoming jobs every 3 seconds
  let jobCounter = 0;
  const interval = setInterval(() => {
    jobCounter++;
    console.log(`\nSending job #${jobCounter}...`);
    client.send('process.job', { id: jobCounter }, { timeout: 30000 }).catch(() => {
      // Job might be cancelled during shutdown
    });
  }, 3000);

  // Stop sending after 30 seconds (for demo purposes)
  setTimeout(() => {
    clearInterval(interval);
    console.log('\n[demo] Stopped sending new jobs. Press Ctrl+C to shutdown.');
  }, 30000);
}

main().catch(console.error);
