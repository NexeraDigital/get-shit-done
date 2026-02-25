# Phase 11: Use Microsoft dev-tunnels to create public URLs for remote dashboard access - Research

**Researched:** 2026-02-25
**Domain:** Tunneling service integration with Node.js/TypeScript server
**Confidence:** MEDIUM-HIGH

## Summary

Microsoft dev-tunnels is a secure tunneling service (currently in public preview) that allows developers to expose local web services to the internet with authentication and access controls. The service provides three npm packages for TypeScript/Node.js integration: `@microsoft/dev-tunnels-management` (tunnel lifecycle), `@microsoft/dev-tunnels-contracts` (data structures), and `@microsoft/dev-tunnels-connections` (host/client connections). The SDK supports programmatic tunnel creation, hosting, and connection management with built-in reconnection capabilities at the SSH protocol level.

For this phase, the autopilot server (Express-based, runs on port derived from git hash) needs to integrate dev-tunnels to automatically expose the dashboard. The tunnel must support anonymous access (URL-as-secret model), persist URLs across reconnections within a session, handle connection drops gracefully, and integrate with the existing ShutdownManager for cleanup.

**Primary recommendation:** Use the three-package SDK stack (@microsoft/dev-tunnels-management, @microsoft/dev-tunnels-contracts, @microsoft/dev-tunnels-connections) with Azure AD token authentication, implement tunnel lifecycle tied to server startup/shutdown via ShutdownManager, store tunnel URL in autopilot state.json for cross-tool access, and leverage built-in SSH-level reconnection with custom retry logic for notification on reconnect.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tunnel lifecycle:**
- Tunnel starts automatically with the server (always-on by default)
- `--no-tunnel` flag disables tunnel creation for local-only sessions
- Tunnel tears down automatically when the server process stops (registered with ShutdownManager)
- On connection drop: auto-reconnect in background AND notify the user when tunnel reconnects with new URL
- Dev-tunnel capability bundled as an npm dependency (not requiring external CLI installation)

**Access control:**
- Anonymous access — anyone with the tunnel URL can view and interact with the dashboard
- Full read/write access, no guardrails — URL itself is the secret (dev tool context)
- No authentication layer (GitHub, Entra, etc.)

**URL management:**
- Persistent URL per autopilot instance (same URL across reconnects within a session, new URL for fresh instances)
- URL displayed in three places: console output on startup, notification adapters, and the dashboard UI itself
- Every notification (questions, progress, errors) includes the tunnel URL — not just a one-time startup message
- Tunnel URL saved to autopilot-state.json so status commands and dashboard API can read it

**CLI integration:**
- Always-on by default, `--no-tunnel` to opt out
- Graceful degradation: if tunnel fails to connect, server starts locally with a warning — dashboard works on localhost
- Tunnel URL persisted in state file for cross-tool access (e.g., `/gsd:autopilot status`)

### Claude's Discretion

- Choice of npm package for dev-tunnels integration (@dev-tunnels/api or equivalent)
- Reconnection retry strategy (backoff timing, max retries)
- Dashboard UI placement for the public URL display
- Tunnel naming/ID strategy for per-instance persistence

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @microsoft/dev-tunnels-management | 1.3.6 | Tunnel lifecycle operations (create, delete, getTunnel) | Official SDK for management API, handles tunnel CRUD operations |
| @microsoft/dev-tunnels-contracts | 1.2.1 | Type definitions and data structures (Tunnel, TunnelAccessScopes, etc.) | Official contract types shared across SDK packages |
| @microsoft/dev-tunnels-connections | 1.3.6 | Tunnel hosting and connection management (TunnelRelayTunnelHost) | Official SDK for hosting tunnels, includes reconnection support |

**Note:** All three packages are part of the official Microsoft dev-tunnels SDK and must be used together. They are actively maintained (latest versions within last 2-4 months).

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none required) | - | SDK is self-contained for core functionality | - |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dev-tunnels SDK | devtunnel CLI (child process) | CLI requires separate installation, harder to manage lifecycle, no programmatic control over reconnection |
| Dev-tunnels | localtunnel (npm) | Less secure (no authentication options), less reliable, no Microsoft support |
| Dev-tunnels | ngrok SDK | Commercial service with usage limits, requires account setup, not free-tier friendly |

**Installation:**
```bash
npm install @microsoft/dev-tunnels-management @microsoft/dev-tunnels-contracts @microsoft/dev-tunnels-connections
```

## Architecture Patterns

### Recommended Project Structure
```
autopilot/src/
├── server/
│   ├── index.ts              # ResponseServer (existing)
│   ├── tunnel/               # NEW: Dev-tunnels integration
│   │   ├── index.ts          # TunnelManager export
│   │   ├── manager.ts        # TunnelManager class
│   │   ├── auth.ts           # Azure AD token provider
│   │   ├── reconnect.ts      # Reconnection strategy
│   │   └── types.ts          # Tunnel-specific types
│   └── standalone.ts
├── state/
│   └── index.ts              # StateStore (extend with tunnelUrl field)
└── cli/
    └── index.ts              # Add --no-tunnel flag
```

### Pattern 1: TunnelManager Lifecycle Integration

**What:** TunnelManager as a singleton service that wraps dev-tunnels SDK, integrated into server startup/shutdown

**When to use:** For managing tunnel lifecycle alongside server lifecycle

**Example:**
```typescript
// Source: Derived from official sample at github.com/microsoft/dev-tunnels/blob/main/samples/ts/host/index.ts
import { TunnelManagementHttpClient, ManagementApiVersions } from '@microsoft/dev-tunnels-management';
import { Tunnel, TunnelAccessControlEntryType, TunnelAccessScopes } from '@microsoft/dev-tunnels-contracts';
import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';

export class TunnelManager {
  private host: TunnelRelayTunnelHost | null = null;
  private tunnel: Tunnel | null = null;

  async start(port: number): Promise<string> {
    // Create tunnel with anonymous access
    const managementClient = new TunnelManagementHttpClient(
      ManagementApiVersions.V20230927Preview,
      () => Promise.resolve(`Bearer ${this.getToken()}`)
    );

    const newTunnel: Tunnel = {
      ports: [{ portNumber: port, protocol: 'https' }],
      accessControl: {
        entries: [{
          type: TunnelAccessControlEntryType.Anonymous,
          scopes: [TunnelAccessScopes.Connect]
        }]
      }
    };

    this.tunnel = await managementClient.createTunnel(newTunnel);

    // Host the tunnel
    this.host = new TunnelRelayTunnelHost(managementClient);
    await this.host.connect(this.tunnel);

    // Return public URL
    return this.tunnel.endpoints?.[0]?.portUris?.[port] || '';
  }

  async stop(): Promise<void> {
    if (this.host) {
      await this.host.dispose();
    }
    if (this.tunnel && this.managementClient) {
      await this.managementClient.deleteTunnel(this.tunnel);
    }
  }
}
```

### Pattern 2: Reconnection Event Handling

**What:** Monitor TunnelRelayTunnelHost events for connection drops and trigger notifications

**When to use:** For handling transient network failures and notifying users of reconnection

**Example:**
```typescript
// Source: Derived from github.com/microsoft/dev-tunnels/blob/main/ts/src/connections/tunnelRelayTunnelHost.ts
class TunnelManager {
  private setupReconnectionHandlers(host: TunnelRelayTunnelHost) {
    host.onClientSessionReconnecting = (event) => {
      this.logger.info('Tunnel reconnecting...');
    };

    host.onClientSessionClosed = (event) => {
      // Check if closure was unexpected
      if (event.reason !== 'Normal' && event.reason !== 'ByApplication') {
        this.handleConnectionDrop(event);
      }
    };

    host.onClientAuthenticated = (event) => {
      // Reconnection successful
      this.handleReconnectionSuccess();
    };
  }

  private async handleReconnectionSuccess() {
    const newUrl = this.tunnel?.endpoints?.[0]?.portUris?.[this.port] || '';
    await this.notificationManager.send({
      type: 'info',
      message: `Tunnel reconnected: ${newUrl}`
    });
  }
}
```

### Pattern 3: Graceful Degradation on Tunnel Failure

**What:** Start server on localhost if tunnel creation fails, log warning but don't block startup

**When to use:** Ensuring dashboard remains accessible even if tunnel service is unavailable

**Example:**
```typescript
// In cli/index.ts or server initialization
async function startServerWithTunnel(port: number, enableTunnel: boolean) {
  const server = new ResponseServer(/* ... */);
  await server.start(port);

  let tunnelUrl: string | null = null;

  if (enableTunnel) {
    try {
      const tunnelManager = new TunnelManager(/* ... */);
      tunnelUrl = await tunnelManager.start(port);
      logger.success(`Dashboard available at: ${tunnelUrl}`);

      // Register shutdown
      shutdownManager.register('tunnel', () => tunnelManager.stop());
    } catch (error) {
      logger.warn(`Tunnel creation failed: ${error.message}`);
      logger.info('Dashboard available at: http://localhost:${port}');
    }
  } else {
    logger.info(`Dashboard available at: http://localhost:${port}`);
  }

  // Save tunnel URL to state
  await stateStore.update({ tunnelUrl });

  return { server, tunnelUrl };
}
```

### Anti-Patterns to Avoid

- **Don't spawn devtunnel CLI as child process:** No programmatic control over reconnection, requires external installation, harder to integrate with shutdown lifecycle
- **Don't create new tunnel on every reconnect:** Wastes resources, changes URL unnecessarily, violates "persistent URL per session" requirement
- **Don't block server startup on tunnel creation:** If tunnel service is down, dashboard should still work locally
- **Don't store sensitive tokens in state file:** Use environment variables or secure token providers

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tunnel protocol implementation | Custom WebSocket relay + TLS termination | @microsoft/dev-tunnels-connections | SDK handles SSH-over-WebSocket, protocol extensions, keep-alive, reconnection logic |
| Authentication token management | Custom token refresh logic | TunnelManagementHttpClient with token callback | Built-in token provider pattern with automatic header injection |
| Connection state tracking | Custom reconnection state machine | TunnelRelayTunnelHost events (onClientSessionReconnecting, onClosed, etc.) | SDK provides battle-tested state transitions and event callbacks |
| Tunnel URL persistence | Custom tunnel ID persistence and lookup | Create tunnel with specific tunnelId, reuse in getTunnel() | SDK supports persistent tunnel IDs that survive host restarts |

**Key insight:** Dev-tunnels protocol is complex (SSH channels over WebSockets, relay coordination, anti-phishing page handling). The SDK handles edge cases (connection drops, relay failures, rate limits) that would take months to implement correctly from scratch.

## Common Pitfalls

### Pitfall 1: Authentication Token Expiration

**What goes wrong:** Azure AD tokens expire after some time (typically 24 hours), causing tunnel operations to fail with 401 errors

**Why it happens:** Token provider callback is called once at client initialization, not refreshed automatically

**How to avoid:**
- Store token expiration time alongside token
- Implement token refresh logic before expiration
- Recreate TunnelManagementHttpClient with new token when needed

**Warning signs:** `401 Unauthorized` errors during long-running tunnel sessions, "token expired" in SDK error messages

### Pitfall 2: Race Condition on Shutdown

**What goes wrong:** Server closes before tunnel cleanup completes, leaving orphaned tunnel in cloud service

**Why it happens:** ShutdownManager runs cleanup handlers in parallel or server process exits before async dispose completes

**How to avoid:**
- Register tunnel cleanup with ShutdownManager using LIFO order (tunnel first, server last)
- Ensure TunnelManager.stop() awaits both host.dispose() and deleteTunnel()
- Use process.on('beforeExit') as safety net for cleanup

**Warning signs:** Tunnel URLs from previous runs still active, hitting 10-tunnel-per-user limit, stale tunnels visible in Azure portal

### Pitfall 3: Port Mismatch Between Server and Tunnel

**What goes wrong:** Tunnel forwards to wrong port, dashboard unreachable via public URL

**Why it happens:** Server port derived from git hash, but tunnel created with hardcoded port or wrong variable

**How to avoid:**
- Pass actual server port to TunnelManager.start()
- Verify port in tunnel.ports matches server.address().port after server starts
- Log both local and tunnel URLs for debugging

**Warning signs:** Tunnel URL returns "connection refused" or "service unavailable", localhost works but tunnel doesn't

### Pitfall 4: Anonymous Access Not Configured

**What goes wrong:** Public URL requires Microsoft/GitHub login, defeating "URL-as-secret" model

**Why it happens:** Forgot to set TunnelAccessControlEntryType.Anonymous in access control entries

**How to avoid:**
- Always include anonymous ACE with Connect scope in tunnel creation
- Verify tunnel.accessControl.entries contains anonymous entry
- Test tunnel URL in incognito browser window (no cached auth)

**Warning signs:** Browser redirects to Microsoft login page, "Authorization required" error when accessing tunnel URL

### Pitfall 5: Reconnection Loop Without Backoff

**What goes wrong:** Connection drops trigger immediate reconnection attempts in tight loop, exhausting rate limits

**Why it happens:** SDK's built-in reconnection doesn't include exponential backoff for application-level retry

**How to avoid:**
- Implement retry strategy with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Limit max retry attempts (e.g., 10 attempts)
- Log retry attempts for debugging

**Warning signs:** High CPU usage during connection issues, SDK error logs flooding console, hitting rate limits (1500 requests/min per port)

## Code Examples

Verified patterns from official sources:

### Create and Host Tunnel with Anonymous Access
```typescript
// Source: github.com/microsoft/dev-tunnels/blob/main/samples/ts/host/index.ts
import { TunnelManagementHttpClient, ManagementApiVersions, ProductHeaderValue } from '@microsoft/dev-tunnels-management';
import { Tunnel, TunnelAccessControlEntryType, TunnelAccessScopes } from '@microsoft/dev-tunnels-contracts';
import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';

const userAgent = new ProductHeaderValue('autopilot-dashboard', '1.0.0');

const managementClient = new TunnelManagementHttpClient(
  userAgent,
  ManagementApiVersions.V20230927Preview,
  () => Promise.resolve(`Bearer ${process.env.AAD_TOKEN}`)
);

const newTunnel: Tunnel = {
  ports: [{ portNumber: 3847, protocol: 'https' }],
  accessControl: {
    entries: [{
      type: TunnelAccessControlEntryType.Anonymous,
      scopes: [TunnelAccessScopes.Connect]
    }]
  }
};

const tunnel = await managementClient.createTunnel(newTunnel, { options: ['RequestOptions'] });

const host = new TunnelRelayTunnelHost(managementClient);
await host.connect(tunnel);

const tunnelUrl = tunnel.endpoints?.[0]?.portUris?.[3847];
console.log(`Public URL: ${tunnelUrl}`);
```

### Handle Reconnection Events
```typescript
// Source: github.com/microsoft/dev-tunnels/blob/main/ts/src/connections/tunnelRelayTunnelHost.ts
import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';

const host = new TunnelRelayTunnelHost(managementClient);

// Set up reconnection monitoring
host.onClientSessionReconnecting = (event) => {
  logger.info('Tunnel connection lost, reconnecting...');
};

host.onClientAuthenticated = (event) => {
  logger.success('Tunnel reconnected successfully');
  notifyUser('Tunnel reconnected: ' + getCurrentTunnelUrl());
};

host.onClientSessionClosed = (event) => {
  if (event.reason !== 'Normal' && event.reason !== 'ByApplication') {
    logger.error(`Tunnel closed unexpectedly: ${event.reason}`);
  }
};

await host.connect(tunnel);
```

### Graceful Cleanup on Shutdown
```typescript
// Source: Derived from SDK patterns and project's ShutdownManager pattern
import { ShutdownManager } from '../orchestrator/shutdown.js';

class TunnelManager {
  async stop(): Promise<void> {
    try {
      if (this.host) {
        await this.host.dispose();
        this.host = null;
      }

      if (this.tunnel && this.managementClient) {
        await this.managementClient.deleteTunnel(this.tunnel);
        this.tunnel = null;
      }
    } catch (error) {
      // Log but don't throw - shutdown should continue
      logger.error(`Tunnel cleanup failed: ${error.message}`);
    }
  }
}

// In CLI initialization
const shutdownManager = new ShutdownManager();
const tunnelManager = new TunnelManager();

// Register tunnel cleanup BEFORE server (LIFO = tunnel closes first)
shutdownManager.register('tunnel', async () => {
  await tunnelManager.stop();
});

shutdownManager.register('server', async () => {
  await responseServer.stop();
});
```

### Persistent Tunnel URL Across Reconnects
```typescript
// Create tunnel with specific ID for persistence
const tunnelId = `autopilot-${branchName}-${portHash}`;

const tunnel: Tunnel = {
  tunnelId: tunnelId,  // Specify ID for reuse
  ports: [{ portNumber: port, protocol: 'https' }],
  accessControl: { entries: [{ type: TunnelAccessControlEntryType.Anonymous, scopes: [TunnelAccessScopes.Connect] }] }
};

try {
  // Try to retrieve existing tunnel first
  this.tunnel = await managementClient.getTunnel(tunnelId);
} catch {
  // Create new if doesn't exist
  this.tunnel = await managementClient.createTunnel(tunnel);
}

// URL will be the same across host restarts within 30-day expiration window
const persistentUrl = this.tunnel.endpoints?.[0]?.portUris?.[port];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ngrok CLI child process | Dev-tunnels SDK programmatic integration | 2023 (SDK release) | Better lifecycle control, no external dependencies |
| Manual token refresh | Token callback provider pattern | SDK v1.0+ | Automatic token injection, cleaner auth |
| Custom reconnection logic | SSH-level session reconnection built into SDK | SDK v1.2+ (TypeScript) | More reliable reconnection, less custom code |
| Temporary tunnels on each host | Persistent tunnels with custom IDs | API 2023-09-27 | Stable URLs across reconnects |

**Deprecated/outdated:**
- devtunnel CLI for programmatic scenarios: SDK provides better control and doesn't require external installation
- Creating new tunnel on every reconnect: Use persistent tunnel IDs for stable URLs within a session

## Open Questions

1. **Azure AD Token Acquisition**
   - What we know: SDK requires Azure AD token via callback, samples use AAD_TOKEN environment variable
   - What's unclear: Best practice for token acquisition in dev tool context (interactive login vs. service principal)
   - Recommendation: Start with environment variable (AAD_TOKEN), document how to obtain token via `az account get-access-token --resource https://tunnels.api.visualstudio.com`. Consider interactive device code flow in future if env var is too complex for users.

2. **Tunnel Expiration Handling**
   - What we know: Tunnels expire after 30 days of inactivity (default), can be customized with --expiration flag (CLI)
   - What's unclear: How to detect expiration programmatically, whether SDK throws specific error on expired tunnel
   - Recommendation: Implement getTunnel() check before hosting, catch and recreate on not-found error. Log expiration as warning, not error.

3. **Rate Limit Error Handling**
   - What we know: Dev-tunnels has limits (1500 HTTP requests/min per port, 10 tunnels per user)
   - What's unclear: What error codes/messages SDK returns when hitting rate limits
   - Recommendation: Implement catch-all error handler, log SDK errors verbatim, document common error patterns in verification phase.

## Sources

### Primary (HIGH confidence)
- Microsoft Learn: [What are dev tunnels?](https://learn.microsoft.com/azure/developer/dev-tunnels/overview)
- Microsoft Learn: [Create and host a dev tunnel](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started)
- Microsoft Learn: [Dev tunnels security](https://learn.microsoft.com/azure/developer/dev-tunnels/security)
- Microsoft Learn: [Dev tunnels FAQ](https://learn.microsoft.com/azure/developer/dev-tunnels/faq)
- Microsoft Learn: [Azure subscription limits - Dev tunnels](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits#dev-tunnels-limits)
- GitHub: [microsoft/dev-tunnels repository](https://github.com/microsoft/dev-tunnels)
- GitHub: [Host sample (TypeScript)](https://github.com/microsoft/dev-tunnels/blob/main/samples/ts/host/index.ts)
- GitHub: [Client sample (TypeScript)](https://github.com/microsoft/dev-tunnels/blob/main/samples/ts/client/index.ts)
- GitHub: [TunnelRelayTunnelHost source](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/connections/tunnelRelayTunnelHost.ts)

### Secondary (MEDIUM confidence)
- npm: [@microsoft/dev-tunnels-management](https://www.npmjs.com/package/@microsoft/dev-tunnels-management) - version 1.3.6, 41K weekly downloads
- npm: [@microsoft/dev-tunnels-contracts](https://www.npmjs.com/package/@microsoft/dev-tunnels-contracts) - version 1.2.1
- npm: [@microsoft/dev-tunnels-connections](https://www.npmjs.com/package/@microsoft/dev-tunnels-connections) - version 1.3.6
- WebSearch: Multiple sources confirming persistent tunnel capability with named tunnel IDs

### Tertiary (LOW confidence)
- General Node.js graceful shutdown patterns (not dev-tunnels specific) - applicable but needs validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK packages verified, versions confirmed, usage patterns documented
- Architecture: MEDIUM-HIGH - Patterns derived from official samples, need validation with project's ShutdownManager integration
- Pitfalls: MEDIUM - Based on SDK source review and general tunneling knowledge, need real-world testing to confirm

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days - dev-tunnels is in preview, SDK stable but evolving)

**Key assumptions:**
- Azure AD token acquisition is out of scope for this phase (assumed to be provided via environment variable)
- Existing autopilot architecture (ShutdownManager, StateStore, NotificationManager) remains unchanged
- Dashboard server (ResponseServer) already running on derived port before tunnel integration
