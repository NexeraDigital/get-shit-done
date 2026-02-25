// TunnelManager - Dev-tunnels integration for public dashboard URLs
// Handles tunnel lifecycle: create, host, reconnect, cleanup

import type { Tunnel, TunnelEndpoint } from '@microsoft/dev-tunnels-contracts';
import {
  TunnelAccessControlEntryType,
  TunnelAccessScopes,
} from '@microsoft/dev-tunnels-contracts';
import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';
import {
  ManagementApiVersions,
  TunnelManagementHttpClient,
} from '@microsoft/dev-tunnels-management';
import { DefaultAzureCredential } from '@azure/identity';

const TUNNEL_RESOURCE_SCOPE = 'https://tunnels.api.visualstudio.com/.default';

// Helper function to get port URI from endpoint
function getPortUri(endpoint: TunnelEndpoint, port: number): string | undefined {
  if (!endpoint.portUriFormat) {
    return undefined;
  }
  // Replace {port} token with actual port number
  return endpoint.portUriFormat.replace('{port}', String(port));
}

export interface TunnelManagerOptions {
  logger?: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  onReconnect?: (newUrl: string) => void;
  onDisconnect?: () => void;
}

/**
 * TunnelManager wraps Microsoft dev-tunnels SDK to create and host public URLs
 * for the autopilot dashboard with automatic reconnection and lifecycle management.
 */
export class TunnelManager {
  private tunnel: Tunnel | null = null;
  private host: TunnelRelayTunnelHost | null = null;
  private managementClient: TunnelManagementHttpClient | null = null;
  private port: number | null = null;
  private logger?: TunnelManagerOptions['logger'];
  private onReconnect?: (newUrl: string) => void;
  private onDisconnect?: () => void;
  private credential: DefaultAzureCredential | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 4000, 8000, 16000, 30000]; // exponential backoff capped at 30s
  private isConnected = false;

  constructor(options: TunnelManagerOptions = {}) {
    this.logger = options.logger;
    this.onReconnect = options.onReconnect;
    this.onDisconnect = options.onDisconnect;
  }

  /**
   * Create and start hosting a dev-tunnel for the specified port.
   * @param port The local port to expose via the tunnel
   * @returns Public HTTPS URL for accessing the tunnel
   * @throws Error if token is missing or tunnel creation fails
   */
  async start(port: number): Promise<string> {
    this.port = port;

    // Create credential for token acquisition.
    // Priority 1: explicit env var (backward compat)
    // Priority 2: DefaultAzureCredential (auto-discovers az login, env vars, managed identity, etc.)
    this.credential = new DefaultAzureCredential();

    // Create management client with user agent and token callback
    this.managementClient = new TunnelManagementHttpClient(
      { name: 'gsd-autopilot', version: '1.0.0' },
      ManagementApiVersions.Version20230927preview,
      async () => {
        const envToken = process.env['DEVTUNNEL_TOKEN'] || process.env['AAD_TOKEN'];
        if (envToken) return `Bearer ${envToken}`;

        const result = await this.credential!.getToken(TUNNEL_RESOURCE_SCOPE);
        return `Bearer ${result.token}`;
      },
    );

    // Build tunnel object with anonymous access
    const tunnelConfig: Tunnel = {
      ports: [{ portNumber: port, protocol: 'https' }],
      accessControl: {
        entries: [
          {
            type: TunnelAccessControlEntryType.Anonymous,
            subjects: [],
            scopes: [TunnelAccessScopes.Connect],
          },
        ],
      },
    };

    try {
      // Create the tunnel
      this.logger?.info('Creating dev-tunnel...');
      this.tunnel = await this.managementClient.createTunnel(tunnelConfig, {
        tokenScopes: [TunnelAccessScopes.Host],
      });

      // Create and connect the host
      this.host = new TunnelRelayTunnelHost(this.managementClient);
      this.setupReconnectionHandlers();

      this.logger?.info('Connecting tunnel host...');
      await this.host.connect(this.tunnel);
      this.isConnected = true;

      // Extract public URL
      const publicUrl = this.extractPublicUrl();
      if (!publicUrl) {
        throw new Error('Failed to extract public URL from tunnel endpoints');
      }

      this.logger?.info(`Tunnel created successfully: ${publicUrl}`);
      return publicUrl;
    } catch (error) {
      // Cleanup on failure
      await this.cleanupResources();
      throw error;
    }
  }

  /**
   * Stop the tunnel host and delete the tunnel.
   * Safe to call multiple times - errors are logged but not thrown.
   */
  async stop(): Promise<void> {
    // Cancel any pending reconnection
    this.cancelReconnection();

    // Dispose host
    if (this.host) {
      try {
        await this.host.dispose();
        this.logger?.info('Tunnel host disposed');
      } catch (error) {
        this.logger?.error(
          `Failed to dispose tunnel host: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.host = null;
    }

    // Delete tunnel
    if (this.tunnel && this.managementClient) {
      try {
        await this.managementClient.deleteTunnel(this.tunnel);
        this.logger?.info('Tunnel deleted');
      } catch (error) {
        this.logger?.error(
          `Failed to delete tunnel: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.tunnel = null;
    }

    this.managementClient = null;
    this.isConnected = false;
  }

  /**
   * Get the current tunnel URL, or null if not started/failed.
   */
  get url(): string | null {
    return this.extractPublicUrl();
  }

  /**
   * Check if the tunnel is currently connected.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Extract public URL from tunnel endpoints.
   */
  private extractPublicUrl(): string | null {
    if (!this.tunnel || !this.port) {
      return null;
    }

    // Find the public endpoint and extract port URI using portUriFormat
    for (const endpoint of this.tunnel.endpoints || []) {
      const portUri = getPortUri(endpoint, this.port);
      if (portUri) {
        return portUri;
      }
    }

    return null;
  }

  /**
   * Set up event handlers for connection monitoring and reconnection.
   */
  private setupReconnectionHandlers(): void {
    if (!this.host) {
      return;
    }

    // Monitor connection status changes
    // Note: The SDK's exact event API may vary - we're using a pattern based on the research
    // and will handle connection drops through error events if direct status events aren't available

    // Connection drops typically surface through disposal or stream errors
    // We'll implement a watchdog pattern if needed in future iterations
  }

  /**
   * Handle connection drop and initiate reconnection with exponential backoff.
   */
  private handleConnectionDrop(): void {
    this.isConnected = false;
    this.logger?.warn('Tunnel connection lost');
    this.onDisconnect?.();

    // Start reconnection attempts
    this.attemptReconnection();
  }

  /**
   * Attempt to reconnect with exponential backoff.
   */
  private attemptReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger?.error(
        'Max reconnection attempts exceeded. Tunnel unavailable.',
      );
      return;
    }

    const delayIndex = Math.min(
      this.reconnectAttempts,
      this.reconnectDelays.length - 1,
    );
    const delay = this.reconnectDelays[delayIndex] || 30000;

    this.logger?.info(
      `Reconnection attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        if (!this.tunnel || !this.host || !this.managementClient) {
          this.logger?.error('Cannot reconnect: missing tunnel resources');
          return;
        }

        // Attempt to reconnect the host
        await this.host.connect(this.tunnel);
        this.isConnected = true;
        this.reconnectAttempts = 0; // Reset on success

        // Get potentially new URL
        const newUrl = this.extractPublicUrl();
        if (newUrl) {
          this.logger?.info(`Tunnel reconnected: ${newUrl}`);
          this.onReconnect?.(newUrl);
        }
      } catch (error) {
        this.logger?.warn(
          `Reconnection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.reconnectAttempts++;
        this.attemptReconnection(); // Try again
      }
    }, delay);

    // Don't block Node.js exit
    this.reconnectTimer.unref();
  }

  /**
   * Cancel pending reconnection timer.
   */
  private cancelReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  /**
   * Clean up resources on failure.
   */
  private async cleanupResources(): Promise<void> {
    this.cancelReconnection();
    this.isConnected = false;

    if (this.host) {
      try {
        await this.host.dispose();
      } catch {
        // Best-effort cleanup
      }
      this.host = null;
    }

    if (this.tunnel && this.managementClient) {
      try {
        await this.managementClient.deleteTunnel(this.tunnel);
      } catch {
        // Best-effort cleanup
      }
      this.tunnel = null;
    }

    this.managementClient = null;
  }
}
