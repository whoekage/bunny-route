// src/interfaces/connection.ts
import { Channel } from 'amqplib';

/**
 * Reconnection strategy options
 * Based on AWS exponential backoff best practices with full jitter
 */
export interface ReconnectOptions {
  /** Enable automatic reconnection. Default: true */
  enabled: boolean;
  /** Maximum reconnection attempts. Default: Infinity */
  maxAttempts: number;
  /** Initial delay in milliseconds. Default: 1000 */
  initialDelayMs: number;
  /** Maximum delay in milliseconds. Default: 30000 */
  maxDelayMs: number;
  /** Backoff multiplier. Default: 2 */
  backoffMultiplier: number;
  /** Connection attempt timeout in milliseconds. Default: 10000 */
  connectionTimeoutMs: number;
}

/**
 * Connection manager options
 */
export interface ConnectionManagerOptions {
  /** RabbitMQ connection URI */
  uri: string;
  /** Heartbeat interval in seconds. Default: 10 */
  heartbeat?: number;
  /** Reconnection options */
  reconnect?: Partial<ReconnectOptions>;
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Channel setup function - called on initial connection and after each reconnect
 * Used for re-declaring topology (exchanges, queues, bindings, consumers)
 */
export type ChannelSetupFn = (channel: Channel) => Promise<void>;

/**
 * Registered channel with its setup function for reconnection
 */
export interface RegisteredChannel {
  channel: Channel;
  setup?: ChannelSetupFn;
}

/**
 * Connection event map for type-safe event emitter
 */
export interface ConnectionEventMap {
  /** Emitted when connection is established */
  connected: [];
  /** Emitted when connection is lost */
  disconnected: [error?: Error];
  /** Emitted on each reconnection attempt */
  reconnecting: [attempt: number, delayMs: number];
  /** Emitted when reconnection succeeds */
  reconnected: [];
  /** Emitted on non-recoverable error */
  error: [error: Error];
}

/**
 * AMQP error codes classification
 * Based on AMQP 0-9-1 specification
 */
export const AMQP_RECOVERABLE_ERRORS = [
  313, // NoConsumers
  320, // ConnectionForced (server maintenance)
  405, // ResourceLocked
  506, // ResourceError
] as const;

export const AMQP_NON_RECOVERABLE_ERRORS = [
  402, // InvalidPath
  403, // AccessRefused (auth failure)
  404, // NotFound
  406, // PreconditionFailed
  501, // FrameError
  502, // SyntaxError
  503, // CommandInvalid
  504, // ChannelError
  505, // UnexpectedFrame
  530, // NotAllowed
  541, // InternalError
] as const;

/**
 * Default reconnection options
 * Industry standard values from AWS and RabbitMQ best practices
 */
export const DEFAULT_RECONNECT_OPTIONS: Required<ReconnectOptions> = {
  enabled: true,
  maxAttempts: Infinity,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  connectionTimeoutMs: 10000,
};

/** Default heartbeat in seconds */
export const DEFAULT_HEARTBEAT = 10;
