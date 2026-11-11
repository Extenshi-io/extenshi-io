#!/usr/bin/env node
/**
 * @extenshi/mcp — Model Context Protocol server for extension developers.
 *
 * Runs locally over stdio inside an MCP client (Claude Code/Desktop, Cursor)
 * and exposes the Extenshi catalog as tools: market-research reads against the
 * public BFF, plus a paid `scan_extension` that reuses the CLI scan path, and a
 * local `publish_extension`.
 *
 * The TOOLS themselves live in `tools.ts` (transport-agnostic) so the sibling
 * remote OAuth server (`@extenshi/mcp-server`) reuses the exact same registry.
 * This file is just the stdio wiring: it injects deps that resolve identity
 * from the environment (one `ek_…` key) and enables ALL capabilities.
 *
 * Auth: an `ek_…` API key is REQUIRED. Over stdio there are no request headers,
 * so the key comes from the environment (EXTENSHI_API_KEY) / `~/.extenshi`
 * config — see config.ts. The backend independently enforces the key, so this
 * is defense in depth, not the only gate.
 *
 * NB: stdout is the MCP protocol channel — never write to it (use stderr).
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { FastMCP, UserError } from 'fastmcp'
import { type Bff, makeBff } from './bff.js'
import { buildMapApp, registerBuildMapApp } from './build-map-app.js'
import { mapClient } from './build-map-store.js'
import { readBuildMapSummary } from './build-map-summary.js'
import { buildMapAgent } from './build-map-tools.js'
import { BUILD_MAP_APP_TOOLS, clientShowsApps } from './build-map-ui.js'
import { loadConfig } from './config.js'
import { instrumentMcpAnalytics } from './mcp-analytics.js'
import { reportServerStarted } from './startup.js'
import { flushTelemetry, initTelemetry } from './telemetry.js'
import {
	type Capability,
	getServerInstructions,
	MISSING_KEY_MESSAGE,
	registerTools,
	SERVER_NAME,
	type ToolDeps,
} from './tools.js'
import { checkForUpdate } from './update-check.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

initTelemetry({ surface: 'mcp', version: pkg.version })

const cfg = loadConfig()

/** Return the configured key or refuse with an actionable instruction. */
function requireKey(): string {
	if (!cfg.apiKey) throw new UserError(MISSING_KEY_MESSAGE)
	return cfg.apiKey
}

/** Build a BFF client bound to the developer's env key (verifies key presence). */
function bff(): Bff {
	return makeBff(cfg.bffUrl, requireKey())
}

const capabilities = new Set<Capability>(['read', 'docs', 'scan', 'publish'])

const server = new FastMCP({
	name: SERVER_NAME,
	// FastMCP types `version` as a semver template literal; package.json gives a plain string.
	version: pkg.version as `${number}.${number}.${number}`,
	instructions: getServerInstructions(capabilities),
})

// stdio identity is fixed (env key) — the call context is ignored. ALL four
// capabilities are enabled: the local client has a filesystem and store creds.
// How this server introduces itself to the author's build map: its release and graph revision.
const mapAs = mapClient('mcp', pkg.version)

const stdioDeps: ToolDeps = {
	cfg: { bffUrl: cfg.bffUrl, scanUrl: cfg.scanUrl, docsUrl: cfg.docsUrl },
	capabilities,
	getBff: () => bff(),
	requireApiKey: () => requireKey(),
	getApiKey: () => cfg.apiKey ?? undefined,
	// The client starts this server in the project it works on; the map of that project is the author's.
	readBuildMap: (projectDir) => readBuildMapSummary(path.resolve(process.cwd(), projectDir ?? '.'), mapAs),
	// Reports, variants for the author and the map itself, written to the same state file the CLI writes.
	buildMap: buildMapAgent(process.cwd(), mapAs),
}

registerTools(server, stdioDeps)

// The build map in the chat (MCP Apps): show_build_map draws the page, and the page calls its own three
// tools. They write the author's answers, so they answer only a client that said it shows apps, and a
// client that did not loses them once start() resolves (below): one that ignores their `visibility`
// would list them to the model. On stdio the session is set up, capabilities included, before `connect`.
let showsApps = false
registerBuildMapApp(server, buildMapApp({ version: pkg.version, writable: () => showsApps }))
server.on('connect', ({ session }) => {
	showsApps = clientShowsApps(session.clientCapabilities)
})
instrumentMcpAnalytics({ surface: 'mcp' })

// Flush buffered telemetry on shutdown. 'beforeExit' covers the natural
// stdin-closed exit; SIGTERM/SIGINT (the MCP client killing the server) bypass
// it, so handle those explicitly and then exit. During a session posthog-node's
// interval flush already drains events, so at most the last few seconds are at
// risk. Never blocks: flushTelemetry is hard-capped (~2.5s).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.once(signal, () => {
		void flushTelemetry().then(() => process.exit(0))
	})
}
process.once('beforeExit', () => {
	void flushTelemetry()
})

// Awaited, unlike the fire-and-forget calls around it. FastMCP's stdio `start()`
// is genuinely async — it awaits `session.connect(transport)` and only then
// registers the close handlers — so calling it and reporting on the next line
// would time the event to "we called start", not "the session connected". It
// resolves once connected rather than on shutdown, so awaiting it does not
// strand the lines below. A rejection stays as loud as it was before: nothing
// catches it, the process dies, and no event is emitted for a server that never
// served. Top-level await is available here (ESM, target ES2022).
await server.start({ transportType: 'stdio' })

// fastmcp changes a connected session's tools only once start() has resolved (then with tools/list_changed).
if (!showsApps) server.removeTools([...BUILD_MAP_APP_TOOLS])

// Reaching this line means a client actually EXECUTED the server and the stdio
// session connected: config parsed, tools registered, transport live. That is the
// population `mcp_installed` cannot describe — postinstall counts npm extractions,
// most of which are ecosystem scanners that never run the binary. See
// ./startup.ts for the measurement.
reportServerStarted(cfg.apiKey)

// Fire-and-forget: nudge to stderr if a newer version is on npm. Never blocks
// startup, never touches stdout (the MCP channel), fully fail-soft.
void checkForUpdate(pkg.version)
