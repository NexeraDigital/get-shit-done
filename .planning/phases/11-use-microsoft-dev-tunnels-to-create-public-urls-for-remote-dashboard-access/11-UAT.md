---
status: testing
phase: 11-use-microsoft-dev-tunnels-to-create-public-urls-for-remote-dashboard-access
source: 11-01-SUMMARY.md, 11-02-SUMMARY.md, 11-03-SUMMARY.md
started: 2026-02-25T18:30:00Z
updated: 2026-02-25T18:30:00Z
---

## Current Test

number: 1
name: Tunnel auto-starts on launch
expected: |
  When running `gsd-autopilot` (or standalone server) with a valid DEVTUNNEL_TOKEN or AAD_TOKEN env var set, a dev-tunnel is created automatically. The console output shows the public HTTPS tunnel URL (something like https://{id}.devtunnels.ms). The dashboard is accessible via that URL from any device/network.
awaiting: user response

## Tests

### 1. Tunnel auto-starts on launch
expected: When running gsd-autopilot with a valid DEVTUNNEL_TOKEN/AAD_TOKEN env var, a dev-tunnel is created automatically and the console shows the public HTTPS tunnel URL. The dashboard is accessible via that URL from any device.
result: [pending]

### 2. --no-tunnel flag disables tunnel
expected: Running gsd-autopilot with --no-tunnel flag skips tunnel creation entirely. No tunnel URL is shown, dashboard only accessible via localhost.
result: [pending]

### 3. Tunnel URL banner in dashboard
expected: Opening the dashboard in a browser shows a purple banner at the top of the Overview page with a globe icon, "Remote access enabled" heading, and the tunnel URL as a clickable link that opens in a new tab.
result: [pending]

### 4. Copy-to-clipboard button
expected: Clicking the "Copy URL" button on the tunnel banner copies the tunnel URL to clipboard. The button text changes to "Copied!" for about 2 seconds, then reverts back.
result: [pending]

### 5. Tunnel URL in console notifications
expected: When autopilot sends console notifications (questions, errors, progress, completion), each notification includes a "Dashboard:" line showing the tunnel URL (or localhost if tunnel is disabled/unavailable).
result: [pending]

### 6. Graceful degradation on tunnel failure
expected: If tunnel creation fails (e.g., no token, network issue), the server still starts and the dashboard works locally. A warning is logged but the process doesn't crash. The tunnel banner is hidden in the dashboard, and notifications fall back to showing the localhost URL.
result: [pending]

### 7. Tunnel URL persists in state
expected: After tunnel starts, checking autopilot-state.json shows a tunnelUrl field containing the public HTTPS URL. This value is available for other tools to read.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0

## Gaps

[none yet]
