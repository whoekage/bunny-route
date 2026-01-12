// src/utils/gracefulShutdown.ts

import type { RMQClient } from '../client/RMQClient';
import { RMQConnectionManager } from '../core/RMQConnectionManager';
import type { ShutdownResult } from '../interfaces/common';
import type { RMQServer } from '../server/RMQServer';

export interface GracefulShutdownOptions {
  /** RMQServer instance to shutdown */
  server?: RMQServer;
  /** RMQClient instances to shutdown */
  clients?: RMQClient[];
  /** Timeout in milliseconds for graceful shutdown (default: 30000) */
  timeout?: number;
  /** Custom cleanup function called after server and clients are shutdown */
  onShutdown?: () => void | Promise<void>;
  /** Whether to exit the process after shutdown (default: true) */
  exitProcess?: boolean;
  /** Exit code to use when exiting (default: 0) */
  exitCode?: number;
}

export interface GracefulShutdownResult {
  /** Result from shutting down server (null if no server) */
  server: ShutdownResult | null;
  /** Results from shutting down clients */
  clients: ShutdownResult[];
  /** Total number of pending operations */
  totalPending: number;
  /** Whether shutdown timed out */
  timedOut: boolean;
}

/**
 * Setup graceful shutdown handlers for SIGTERM and SIGINT signals.
 * This is useful for Kubernetes deployments where the pod receives SIGTERM
 * before being terminated.
 *
 * @example
 * ```typescript
 * const server = new RMQServer({ uri: '...', appName: 'my-app' });
 * const client = new RMQClient({ uri: '...', appName: 'my-app' });
 *
 * setupGracefulShutdown({
 *   server,
 *   clients: [client],
 *   timeout: 30000,
 *   onShutdown: async () => {
 *     await db.disconnect();
 *   }
 * });
 * ```
 */
export function setupGracefulShutdown(options: GracefulShutdownOptions): void {
  const { exitProcess = true, exitCode = 0 } = options;

  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      console.log(`[bunny-route] Already shutting down, ignoring ${signal}`);
      return;
    }

    isShuttingDown = true;
    console.log(`[bunny-route] Received ${signal}, shutting down gracefully...`);

    try {
      const result = await performGracefulShutdown(options);

      if (result.timedOut) {
        console.warn(
          `[bunny-route] Shutdown completed with ${result.totalPending} pending operations`,
        );
      } else {
        console.log('[bunny-route] Shutdown completed successfully');
      }

      if (exitProcess) {
        process.exit(exitCode);
      }
    } catch (error) {
      console.error('[bunny-route] Error during shutdown:', error);
      if (exitProcess) {
        process.exit(1);
      }
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Perform graceful shutdown of server and clients.
 * Can be called manually without setting up signal handlers.
 *
 * @example
 * ```typescript
 * const result = await performGracefulShutdown({
 *   server,
 *   clients: [client],
 *   timeout: 30000,
 * });
 * console.log(`Pending: ${result.totalPending}`);
 * ```
 */
export async function performGracefulShutdown(
  options: GracefulShutdownOptions,
): Promise<GracefulShutdownResult> {
  const timeout = options.timeout ?? 30000;

  // Shutdown server first (stop receiving new messages)
  let serverResult: ShutdownResult | null = null;
  if (options.server) {
    serverResult = await options.server.shutdown({ timeout });
  }

  // Then shutdown clients
  const clients = options.clients ?? [];
  const clientResults = await Promise.all(clients.map((c) => c.shutdown({ force: true })));

  // Run custom cleanup
  if (options.onShutdown) {
    await options.onShutdown();
  }

  // Close connection manager
  try {
    RMQConnectionManager.resetInstance();
  } catch {
    // Ignore errors when closing connection manager
  }

  const totalPending =
    (serverResult?.pendingCount ?? 0) + clientResults.reduce((sum, r) => sum + r.pendingCount, 0);

  const timedOut = serverResult?.timedOut ?? false;

  return {
    server: serverResult,
    clients: clientResults,
    totalPending,
    timedOut,
  };
}
