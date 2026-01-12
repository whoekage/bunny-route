// src/core/RMQConnectionManager.ts
import amqp, { Connection, Channel } from 'amqplib';
import { EventEmitter } from 'events';
import {
  ConnectionManager,
} from '../interfaces/common';
import {
  ConnectionManagerOptions,
  ConnectionState,
  ReconnectOptions,
  ChannelSetupFn,
  RegisteredChannel,
  DEFAULT_RECONNECT_OPTIONS,
  DEFAULT_HEARTBEAT,
  AMQP_NON_RECOVERABLE_ERRORS,
} from '../interfaces/connection';

export class RMQConnectionManager extends EventEmitter implements ConnectionManager {
  private static instance: RMQConnectionManager | null = null;

  private uri: string;
  private heartbeat: number;
  private reconnectOptions: Required<ReconnectOptions>;

  private connection: Connection | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempt: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;

  // Registered channels with their setup functions for reconnection
  private registeredChannels: Set<RegisteredChannel> = new Set();

  private constructor(options: ConnectionManagerOptions) {
    super();
    this.uri = options.uri;
    this.heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT;
    this.reconnectOptions = {
      ...DEFAULT_RECONNECT_OPTIONS,
      ...options.reconnect,
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(
    uri: string,
    options?: Omit<ConnectionManagerOptions, 'uri'>
  ): RMQConnectionManager {
    if (!this.instance) {
      this.instance = new RMQConnectionManager({ uri, ...options });
    }
    return this.instance;
  }

  /**
   * Reset singleton instance - useful for testing
   */
  public static resetInstance(): void {
    if (this.instance) {
      this.instance.close().catch(() => {});
      this.instance = null;
    }
  }

  /**
   * Get current connection state
   */
  public getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * Get or create connection
   */
  public async getConnection(): Promise<Connection> {
    if (this.connection && this.state === 'connected') {
      return this.connection;
    }

    if (this.state === 'connecting' || this.state === 'reconnecting') {
      // Wait for connection to be established
      return new Promise((resolve, reject) => {
        const onConnected = () => {
          this.off('error', onError);
          resolve(this.connection!);
        };
        const onError = (err: Error) => {
          this.off('connected', onConnected);
          this.off('reconnected', onConnected);
          reject(err);
        };
        this.once('connected', onConnected);
        this.once('reconnected', onConnected);
        this.once('error', onError);
      });
    }

    return this.connect();
  }

  /**
   * Connect to RabbitMQ with timeout
   */
  private async connectWithTimeout(): Promise<Connection> {
    const timeoutMs = this.reconnectOptions.connectionTimeoutMs;
    let timedOut = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      amqp
        .connect(this.uri, { heartbeat: this.heartbeat })
        .then((connection) => {
          clearTimeout(timeout);
          if (timedOut) {
            // Connection established after timeout - close it to prevent leak
            console.warn('[RMQConnectionManager] Connection established after timeout, closing to prevent leak');
            connection.close().catch(() => {});
            return;
          }
          resolve(connection);
        })
        .catch((error) => {
          clearTimeout(timeout);
          if (!timedOut) {
            reject(error);
          }
          // If timed out, ignore the error - we already rejected
        });
    });
  }

  /**
   * Connect to RabbitMQ
   */
  private async connect(): Promise<Connection> {
    this.state = 'connecting';

    try {
      this.connection = await this.connectWithTimeout();

      this.setupConnectionListeners();
      this.state = 'connected';
      this.reconnectAttempt = 0;
      this.emit('connected');

      return this.connection;
    } catch (error) {
      this.state = 'disconnected';

      if (this.isNonRecoverableError(error)) {
        this.emit('error', error);
        throw error;
      }

      // Try to reconnect
      if (this.reconnectOptions.enabled) {
        this.scheduleReconnect();
        return new Promise((resolve, reject) => {
          this.once('reconnected', () => resolve(this.connection!));
          this.once('error', reject);
        });
      }

      throw error;
    }
  }

  /**
   * Setup connection event listeners
   */
  private setupConnectionListeners(): void {
    if (!this.connection) return;

    this.connection.on('error', (error) => {
      console.error('[RMQConnectionManager] Connection error:', error.message);
      // Error event is followed by close event, so we handle reconnection there
    });

    this.connection.on('close', (error) => {
      if (this.isClosing) {
        // Intentional close, don't reconnect
        this.state = 'disconnected';
        return;
      }

      console.warn('[RMQConnectionManager] Connection closed', error?.message);
      this.connection = null;
      this.state = 'disconnected';
      this.emit('disconnected', error);

      // Clear all registered channels (they're now invalid)
      for (const registered of this.registeredChannels) {
        registered.channel = null as any;
      }

      if (this.reconnectOptions.enabled && !this.isNonRecoverableError(error)) {
        this.scheduleReconnect();
      } else if (error) {
        this.emit('error', error);
      }
    });

    this.connection.on('blocked', (reason) => {
      console.warn('[RMQConnectionManager] Connection blocked:', reason);
    });

    this.connection.on('unblocked', () => {
      console.info('[RMQConnectionManager] Connection unblocked');
    });
  }

  /**
   * Schedule reconnection with exponential backoff and full jitter
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempt >= this.reconnectOptions.maxAttempts) {
      const error = new Error(
        `Max reconnection attempts (${this.reconnectOptions.maxAttempts}) reached`
      );
      this.emit('error', error);
      return;
    }

    // Full jitter: random value between 0 and calculated delay
    const baseDelay = Math.min(
      this.reconnectOptions.maxDelayMs,
      this.reconnectOptions.initialDelayMs *
        Math.pow(this.reconnectOptions.backoffMultiplier, this.reconnectAttempt)
    );
    const delay = Math.random() * baseDelay;

    this.reconnectAttempt++;
    this.state = 'reconnecting';
    this.emit('reconnecting', this.reconnectAttempt, Math.round(delay));

    console.info(
      `[RMQConnectionManager] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error) {
        // Will be handled in connect() -> scheduleReconnect()
      }
    }, delay);
  }

  /**
   * Perform reconnection
   */
  private async reconnect(): Promise<void> {
    try {
      this.connection = await this.connectWithTimeout();

      this.setupConnectionListeners();
      this.state = 'connected';
      this.reconnectAttempt = 0;

      // Re-setup all registered channels
      await this.recreateChannels();

      this.emit('reconnected');
      console.info('[RMQConnectionManager] Reconnected successfully');
    } catch (error) {
      console.error('[RMQConnectionManager] Reconnection failed:', (error as Error).message);

      if (this.isNonRecoverableError(error)) {
        this.state = 'disconnected';
        this.emit('error', error as Error);
        return;
      }

      // Schedule next attempt
      this.scheduleReconnect();
    }
  }

  /**
   * Recreate all registered channels after reconnection
   */
  private async recreateChannels(): Promise<void> {
    for (const registered of this.registeredChannels) {
      try {
        const channel = await this.connection!.createChannel();
        registered.channel = channel;

        // Setup channel error handlers
        this.setupChannelListeners(channel, registered);

        // Call setup function if provided
        if (registered.setup) {
          await registered.setup(channel);
        }
      } catch (error) {
        console.error('[RMQConnectionManager] Failed to recreate channel:', (error as Error).message);
      }
    }
  }

  /**
   * Create a channel with optional setup function
   * The setup function will be called on initial creation and after each reconnect
   */
  public async createChannel(setup?: ChannelSetupFn): Promise<Channel> {
    const connection = await this.getConnection();
    const channel = await connection.createChannel();

    const registered: RegisteredChannel = { channel, setup };
    this.registeredChannels.add(registered);

    // Setup channel error handlers
    this.setupChannelListeners(channel, registered);

    // Call setup function if provided
    if (setup) {
      await setup(channel);
    }

    return channel;
  }

  /**
   * Setup channel event listeners
   */
  private setupChannelListeners(channel: Channel, registered: RegisteredChannel): void {
    channel.on('error', (error) => {
      console.error('[RMQConnectionManager] Channel error:', error.message);
    });

    channel.on('close', () => {
      // Channel closed, but connection might still be alive
      // This can happen if channel-level error occurred
      if (this.state === 'connected' && !this.isClosing) {
        console.warn('[RMQConnectionManager] Channel closed unexpectedly, recreating...');
        this.recreateSingleChannel(registered).catch((err) => {
          console.error('[RMQConnectionManager] Failed to recreate channel:', err.message);
        });
      }
    });
  }

  /**
   * Recreate a single channel
   */
  private async recreateSingleChannel(registered: RegisteredChannel): Promise<void> {
    if (!this.connection || this.state !== 'connected') {
      return;
    }

    try {
      const channel = await this.connection.createChannel();
      registered.channel = channel;

      this.setupChannelListeners(channel, registered);

      if (registered.setup) {
        await registered.setup(channel);
      }
    } catch (error) {
      console.error('[RMQConnectionManager] Failed to recreate channel:', (error as Error).message);
    }
  }

  /**
   * Remove channel from registry
   */
  public unregisterChannel(channel: Channel): void {
    for (const registered of this.registeredChannels) {
      if (registered.channel === channel) {
        this.registeredChannels.delete(registered);
        break;
      }
    }
  }

  /**
   * Check if error is non-recoverable
   */
  private isNonRecoverableError(error: any): boolean {
    if (!error) return false;

    // Check AMQP error codes
    const code = error.code || error.replyCode;
    if (code && AMQP_NON_RECOVERABLE_ERRORS.includes(code)) {
      return true;
    }

    // Check for authentication errors
    if (error.message?.includes('ACCESS_REFUSED') ||
        error.message?.includes('authentication')) {
      return true;
    }

    return false;
  }

  /**
   * Close connection and cleanup
   */
  public async close(): Promise<void> {
    this.isClosing = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close all channels
    for (const registered of this.registeredChannels) {
      try {
        if (registered.channel) {
          await registered.channel.close();
        }
      } catch (error) {
        // Ignore errors when closing channels
      }
    }
    this.registeredChannels.clear();

    // Close connection
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        // Ignore errors when closing connection
      }
      this.connection = null;
    }

    this.state = 'disconnected';
    this.isClosing = false;
  }
}
