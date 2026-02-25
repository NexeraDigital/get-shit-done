# Phase 11: Use Microsoft dev-tunnels to create public URLs for remote dashboard access - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate Microsoft dev-tunnels into the autopilot server so the local dashboard (localhost:3847) is automatically exposed via a public URL, enabling remote access from phones, other machines, or shared links. The tunnel is managed as part of the server lifecycle.

</domain>

<decisions>
## Implementation Decisions

### Tunnel lifecycle
- Tunnel starts automatically with the server (always-on by default)
- `--no-tunnel` flag disables tunnel creation for local-only sessions
- Tunnel tears down automatically when the server process stops (registered with ShutdownManager)
- On connection drop: auto-reconnect in background AND notify the user when tunnel reconnects with new URL
- Dev-tunnel capability bundled as an npm dependency (not requiring external CLI installation)

### Access control
- Anonymous access — anyone with the tunnel URL can view and interact with the dashboard
- Full read/write access, no guardrails — URL itself is the secret (dev tool context)
- No authentication layer (GitHub, Entra, etc.)

### URL management
- Persistent URL per autopilot instance (same URL across reconnects within a session, new URL for fresh instances)
- URL displayed in three places: console output on startup, notification adapters, and the dashboard UI itself
- Every notification (questions, progress, errors) includes the tunnel URL — not just a one-time startup message
- Tunnel URL saved to autopilot-state.json so status commands and dashboard API can read it

### CLI integration
- Always-on by default, `--no-tunnel` to opt out
- Graceful degradation: if tunnel fails to connect, server starts locally with a warning — dashboard works on localhost
- Tunnel URL persisted in state file for cross-tool access (e.g., `/gsd:autopilot status`)

### Claude's Discretion
- Choice of npm package for dev-tunnels integration (@dev-tunnels/api or equivalent)
- Reconnection retry strategy (backoff timing, max retries)
- Dashboard UI placement for the public URL display
- Tunnel naming/ID strategy for per-instance persistence

</decisions>

<specifics>
## Specific Ideas

- Microsoft dev-tunnels specifically: https://github.com/microsoft/dev-tunnels
- Tunnel URL should be prominent in notifications so the user can tap/click from their phone to access the dashboard remotely
- The dashboard should show its own public URL somewhere visible for easy sharing/copying

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-use-microsoft-dev-tunnels-to-create-public-urls-for-remote-dashboard-access*
*Context gathered: 2026-02-25*
