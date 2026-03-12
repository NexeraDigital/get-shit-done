# Technology Stack

**Analysis Date:** 2026-03-11

## Languages

**Primary:**
- TypeScript ~5.9.0 - Main implementation language for autopilot package, dashboard, server components, CLI, and orchestration logic
- JavaScript (Node.js CommonJS) - Legacy GSD core runtime and test infrastructure (`get-shit-done/bin/lib/*.cjs`)

**Secondary:**
- Shell (Bash) - Installation scripts and development tooling
- HTML/CSS/JSX - Dashboard UI components

## Runtime

**Environment:**
- Node.js >= 16.7.0 (root package.json)
- Node.js >= 20.0.0 (autopilot package.json)

**Package Manager:**
- npm (npm 8+)
- Lockfile: `package-lock.json` present at root and `autopilot/` level

## Frameworks

**Core:**
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` ^0.2.42) - Query interface for LLM-powered command execution and tool invocation
- Express.js (^5.2.1) - Web server for dashboard and API routes
- React (^19.1.0) - Dashboard UI framework and components

**Build/Dev:**
- TypeScript Compiler (tsc ~5.8.0, ~5.9.0) - Transpilation and type checking
- Vite (^7.0.0) - Dashboard bundler and dev server
- ESBuild (^0.24.0) - Hook compilation for GSD core
- Vitest (^4.0.0) - Unit test framework for autopilot
- c8 (^11.0.0) - Code coverage reporting

**Routing/Navigation:**
- React Router (^7.13.0) - Dashboard client-side routing

**State Management:**
- Zustand (^5.0.11) - Lightweight dashboard state store

**CLI:**
- Commander.js (^14.0.3) - Command-line argument parsing and help generation
- Inquirer.js (`@inquirer/prompts` ^8.2.1) - Interactive terminal prompts (setup wizard)
- Ora (^9.3.0) - Terminal spinners for activity indication
- Ansis (^4.2.0) - Terminal color/styling
- Pino (^10.3.0) - Structured JSON logging
- Pino-Pretty (^13.0.0) - Pretty-printed log output for development

**Markdown/Content:**
- React-Markdown (^10.1.0) - Render markdown content in dashboard

**Utilities:**
- Zod (^4.0.0) - Schema validation and runtime type checking
- write-file-atomic (^7.0.0) - Atomic file writing for IPC and state persistence
- web-push (^3.6.7) - Web Push Protocol implementation for browser push notifications
- node-notifier (^10.0.1) - Optional system notifications (macOS/Windows/Linux)

**Microsoft Dev Tunnels (Tunnel Infrastructure):**
- `@microsoft/dev-tunnels-contracts` (^1.3.6) - Tunnel type definitions and access control enums
- `@microsoft/dev-tunnels-connections` (^1.3.6) - TunnelRelayTunnelHost for tunnel hosting
- `@microsoft/dev-tunnels-management` (^1.3.6) - TunnelManagementHttpClient for tunnel lifecycle

**Utilities/Helpers:**
- uuid (^8.3.2) - UUID generation for session IDs and question identifiers

## Configuration

**Environment:**
- Configuration via:
  1. CLI flags (highest precedence)
  2. Environment variables with `GSD_AUTOPILOT_` prefix (snake_case converted to camelCase)
  3. Config file `.gsd-autopilot.json` in project root
  4. Derived defaults (e.g., port from git repo identity)
  5. Schema defaults defined in Zod

**Build:**
- `tsconfig.json` at root and `autopilot/tsconfig.json` - TypeScript compiler configuration
  - Target: ES2022, Module: NodeNext
  - Strict mode enabled, declaration files generated
- `autopilot/vitest.config.ts` - Test runner configuration

**Configuration Files:**
- `.npmrc` - NPM registry and authentication settings (autopilot-specific)
- No `.env` files in repository (environment config via named vars only)

## Platform Requirements

**Development:**
- Node.js 20.0.0+ with npm
- Git repository (for port derivation from commit hash)
- System with TTY support for interactive wizard
- Optional: system notification support (node-notifier for macOS/Windows/Linux)

**Production:**
- Node.js 20.0.0+ runtime
- Internet access for Claude Agent SDK API calls
- For dashboard: modern browser with Web Push API support (Firefox, Chrome, Edge, Safari)
- For tunnels: authenticated access to Microsoft Dev Tunnels service OR fallback to local-only mode
- Optional: Teams/Slack workspace for webhook integrations

## Key Dependencies

**Critical:**
- `@anthropic-ai/claude-agent-sdk` (^0.2.42) - Core AI integration; failure blocks all command execution
- `@microsoft/dev-tunnels-*` (^1.3.6) - Public tunnel support; graceful degradation to local-only if unavailable
- Express (^5.2.1) - Dashboard server; required for real-time updates and WebSocket/SSE
- web-push (^3.6.7) - Browser push notifications; optional but enables browser alerts

**Infrastructure:**
- Pino (^10.3.0) - Structured logging for debugging and observability
- write-file-atomic (^7.0.0) - Ensures IPC file consistency (critical for multi-process safety)
- Zod (^4.0.0) - Config validation; prevents invalid configurations from reaching runtime

---

*Stack analysis: 2026-03-11*
