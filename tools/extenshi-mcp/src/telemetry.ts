/**
 * Anonymous, opt-out usage telemetry — VENDORED, kept byte-identical between
 * @extenshi/cli and @extenshi/mcp (same pattern as validate-artifact.ts). Edit
 * one, copy to the other.
 *
 * Why it exists: we want to know which commands/tools are used most, which fail,
 * and what errors recur — without shipping a heavyweight client or leaking PII.
 *
 * What it sends (and ONLY this):
 *   - command/tool name, surface ('cli' | 'mcp'), package + Node version,
 *     coarse os/arch, a CI bool
 *   - the NAMES of CLI flags used (never their values — see flagsFromArgv)
 *   - a coarse error_kind classification + durations
 *   - a path-redacted exception signature (message + stack, $HOME stripped)
 *
 * What it NEVER sends: file paths, artifact names/contents, API keys, manifest
 * data, or raw user input.
 *
 * Identity is an anonymous per-install UUID in ~/.extenshi/config.json
 * (`anonId`) — it identifies an install, not a person, and is never linked to
 * the API key client-side.
 *
 * On by default: the shared-project ingestion key is embedded (see
 * EMBEDDED_KEY), so telemetry is active unless the user opts out. Disabled
 * (no-op, never blocks the command) when ANY holds:
 *   - DO_NOT_TRACK is truthy (industry standard, https://consoledonottrack.com)
 *   - EXTENSHI_TELEMETRY in {0,false,off,no}
 *   - config file has "telemetry": false
 *   - the key is cleared (EMBEDDED_KEY emptied AND no EXTENSHI_POSTHOG_KEY)
 *
 * Everything here is fail-soft: any throw inside telemetry is swallowed so a
 * PostHog/network/disk problem can never break or slow the actual command.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PostHog } from 'posthog-node'

// Shared PostHog *project* ingestion key (EU project 114791 — the same project
// the web apps use; we run on the free tier so CLI/MCP share it). It is the
// public, write-only key already shipped in our web bundles, so embedding it
// here is not a secret leak. CLI/MCP events are namespaced (`cli_*` / `mcp_*`,
// plus a `surface` property) so they stay separable from web analytics.
// Override at runtime with EXTENSHI_POSTHOG_KEY; set it empty to ship dark.
const EMBEDDED_KEY = 'phc_fqKrAmtNZvJqe0krpYB3UwYqALLpT1WM8m5LtNs9eUu'
const DEFAULT_HOST = 'https://eu.i.posthog.com'

const CONFIG_PATH = path.join(os.homedir(), '.extenshi', 'config.json')
const HOME = os.homedir()

interface TelemetryConfigFile {
	anonId?: string
	telemetry?: boolean
}

let surface = 'unknown'
let appVersion = '0.0.0'
let client: PostHog | null = null
let triedInit = false
let cachedAnonId: string | null = null

/** Record the surface + version once at process startup. */
export function initTelemetry(opts: { surface: string; version: string }): void {
	surface = opts.surface
	appVersion = opts.version
}

function telemetryKey(): string {
	return (process.env.EXTENSHI_POSTHOG_KEY ?? EMBEDDED_KEY).trim()
}

function telemetryHost(): string {
	return (process.env.EXTENSHI_POSTHOG_HOST ?? DEFAULT_HOST).trim()
}

function readConfig(): TelemetryConfigFile {
	try {
		return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as TelemetryConfigFile
	} catch {
		return {}
	}
}

/** Merge-write so we never clobber apiKey/apiUrl written by `extenshi login`. */
function mergeWriteConfig(update: TelemetryConfigFile): void {
	try {
		const existing = readConfig()
		const merged = { ...existing, ...update }
		fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
		fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
	} catch {
		// Read-only home / unwritable config — fall back to an ephemeral id.
	}
}

function isTruthy(v: string | undefined): boolean {
	const t = (v ?? '').trim().toLowerCase()
	return t === '1' || t === 'true' || t === 'yes' || t === 'on'
}

export function telemetryEnabled(): boolean {
	if (!telemetryKey()) return false
	if (isTruthy(process.env.DO_NOT_TRACK)) return false
	const t = (process.env.EXTENSHI_TELEMETRY ?? '').trim().toLowerCase()
	if (t === '0' || t === 'false' || t === 'off' || t === 'no') return false
	if (readConfig().telemetry === false) return false
	return true
}

function anonId(): string {
	if (cachedAnonId) return cachedAnonId
	const existing = readConfig().anonId
	if (existing) {
		cachedAnonId = existing
		return existing
	}
	const id = randomUUID()
	cachedAnonId = id
	mergeWriteConfig({ anonId: id })
	return id
}

function getClient(): PostHog | null {
	// Fast path after the first call: never re-read the config file
	// (telemetryEnabled does a sync read) on subsequent events — matters for the
	// long-running MCP server, which can handle many tool calls.
	if (client) return client
	if (triedInit) return null
	triedInit = true
	if (!telemetryEnabled()) return null
	try {
		// Batch events; the 2–3 events a CLI run emits flush together on
		// flushTelemetry()/shutdown(). The MCP server (long-running) also gets a
		// periodic interval flush.
		client = new PostHog(telemetryKey(), { host: telemetryHost(), flushAt: 20, flushInterval: 5000 })
	} catch {
		client = null
	}
	return client
}

/**
 * The shared posthog-node client, or null when telemetry is disabled. Exposed so
 * the MCP package's PostHog MCP Analytics instrumentation (mcp-analytics.ts)
 * rides this same client: one opt-out, one flush path (flushTelemetry).
 */
export function telemetryClient(): PostHog | null {
	return getClient()
}

function baseProps(): Record<string, unknown> {
	return {
		surface,
		version: appVersion,
		node: process.version,
		os: process.platform,
		arch: process.arch,
		ci: Boolean(process.env.CI),
	}
}

/** Strip absolute home paths from any string before it leaves the machine. */
export function redactText(s: string): string {
	if (!s) return s
	let out = s
	if (HOME) out = out.split(HOME).join('~')
	out = out.replace(/\/(?:Users|home)\/[^/\s]+/g, '~')
	out = out.replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
	return out
}

function sanitizeError(err: unknown): Error {
	const original = err instanceof Error ? err : new Error(String(err))
	const e = new Error(redactText(original.message))
	e.name = original.name
	if (original.stack) e.stack = redactText(original.stack)
	return e
}

/**
 * The HTTP status an error carries, whichever shape it arrived in:
 *   - `status`          — the MCP package's ScanError (@extenshi/mcp scan.ts).
 *   - `data.httpStatus` — @trpc/client's TRPCClientError, i.e. every catalog BFF
 *     read on EITHER surface. tRPC puts the status inside `data` and has NO
 *     top-level `status`, so reading only `status` left the entire read path to
 *     message heuristics.
 *
 * Surface-neutral on purpose: this file is vendored byte-identical into both
 * packages (see the header), so it must describe both. Neither branch costs the
 * surface that cannot produce that shape anything — the check simply never fires.
 */
function statusOf(err: unknown): number | undefined {
	const e = err as { status?: unknown; data?: { httpStatus?: unknown } } | null | undefined
	if (typeof e?.status === 'number') return e.status
	if (typeof e?.data?.httpStatus === 'number') return e.data.httpStatus
	return undefined
}

/** Classify a single error, ignoring any `cause` chain. See classifyError(). */
function classifyOne(err: unknown): string {
	const status = statusOf(err)
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()

	// InvalidInputError (expected-error.ts): the user's own file or flag.
	if (err instanceof Error && err.name === 'InvalidInputError') return 'invalid_input'
	if (status === 401 || status === 403) return 'auth'
	if (status === 402) return 'quota'
	if (status === 429) return 'rate_limit'
	if (status && status >= 500) return 'api_5xx'
	if (status && status >= 400) return 'api_4xx'

	if (/enotfound|econnrefused|econnreset|eai_again|fetch failed|network|socket hang|und_err/.test(msg))
		return 'network'
	if (/timed out|timeout|aborted|aborterror/.test(msg)) return 'timeout'
	if (/authentication failed|unauthorized|api key|access denied|forbidden/.test(msg)) return 'auth'
	// `allowance exhausted` is the catalog BFF's free-read gate (routers/_app.ts:
	// "Free read allowance exhausted (25/mo)"), which matches none of the credit
	// wordings above.
	if (/insufficient credits|out of .*credits|\bquota\b|allowance exhausted/.test(msg)) return 'quota'
	if (/rate limit/.test(msg)) return 'rate_limit'
	if (/artifact|not a file|file not found|exceeds .*mb|invalid .*(crx|xpi|zip)|magic|unsupported/.test(msg))
		return 'invalid_artifact'
	if (/http 4\d{2}/.test(msg)) return 'api_4xx'
	if (/non-json response|http 5\d{2}|server returned/.test(msg)) return 'api_5xx'
	return 'unexpected'
}

/** How deep to follow `cause` before giving up (guards a cyclic chain). */
const MAX_CAUSE_DEPTH = 4

/**
 * Coarse error bucket. Driven by a numeric status when the error carries one
 * (ScanError `status`, tRPC `data.httpStatus`), else by message patterns (both
 * surfaces also throw plain Errors). Order matters — status first, then
 * transport, then semantic buckets.
 *
 * Follows the `cause` chain, because both surfaces re-throw a failure wrapped in
 * an error of their own so it renders for the caller — the MCP tool layer wraps
 * in fastmcp's `UserError` (readError() in its tools.ts) — and the wrapper's own
 * message can carry no status. The origin hangs off `cause`, so an
 * unclassifiable wrapper defers to what it wraps; without this, a BFF 500 behind
 * a wrapper reads as `unexpected`.
 */
export function classifyError(err: unknown): string {
	let cur: unknown = err
	for (let depth = 0; cur != null && depth < MAX_CAUSE_DEPTH; depth++) {
		const kind = classifyOne(cur)
		if (kind !== 'unexpected') return kind
		const next: unknown = (cur as { cause?: unknown }).cause
		// Handles the DIRECT cycle only (`a.cause === a`): such an error has no
		// origin left to consult, which is a different thing from running out of
		// depth budget, so stopping here says so at the point it's true. A longer
		// cycle (A → B → A) is not detected and is not meant to be — it terminates
		// on MAX_CAUSE_DEPTH like any other over-deep chain, which is why the
		// bound, not this check, is what guarantees termination.
		if (next === cur) break
		cur = next
	}
	return 'unexpected'
}

/**
 * The NAMES of long flags the user passed, with values stripped. `--out=/x`
 * becomes `--out`; the separate-token value of `--output /x` is never a `--`
 * token, so it is never collected. No flag VALUE can leak through here.
 */
export function flagsFromArgv(argv: string[] = process.argv.slice(2)): string[] {
	const flags = new Set<string>()
	for (const tok of argv) {
		if (tok.startsWith('--')) flags.add(tok.split('=')[0])
	}
	return [...flags]
}

/**
 * `distinctId` overrides the per-install anonymous id. The CLI never passes it —
 * one install IS one identity there. The hosted MCP connector must: it is one
 * process serving many accounts, so the install id would collapse every user of
 * the service into a single person and re-mint on each redeploy. It passes the
 * authenticated account id instead (never an email — that stays in our own
 * database, see tools/extenshi-mcp-server/src/legal.ts).
 */
export function captureEvent(
	event: string,
	properties: Record<string, unknown> = {},
	distinctId?: string,
): void {
	const c = getClient()
	if (!c) return
	// Empty is treated as ABSENT, not as an id. PostHog accepts "" and mints a
	// person nobody can resolve, so a caller bug would turn into permanently
	// unattributable rows; degrading to the install id keeps the event readable.
	// attribution() already filters empties — this restates the contract at the
	// sink so it does not depend on the caller doing so.
	const id = distinctId?.trim() || anonId()
	try {
		c.capture({
			distinctId: id,
			event,
			properties: { ...baseProps(), ...properties },
		})
	} catch {
		// Telemetry must never throw into the command path.
	}
}

export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
	const c = getClient()
	if (!c) return
	try {
		c.captureException(sanitizeError(err), anonId(), { ...baseProps(), ...context })
	} catch {
		// Swallow — see captureEvent.
	}
}

function timeout(ms: number): Promise<void> {
	return new Promise<void>((resolve) => {
		// unref so the flush timer can't keep a short-lived CLI process alive.
		setTimeout(resolve, ms).unref()
	})
}

/**
 * Flush buffered events and close the client. Hard-capped so a slow/hung
 * PostHog endpoint can never delay the command's exit. Safe to call when
 * telemetry is disabled (no-op) or more than once.
 */
export async function flushTelemetry(): Promise<void> {
	if (!client) return
	const c = client
	client = null
	try {
		await Promise.race([c.shutdown(2000), timeout(2500)])
	} catch {
		// Best-effort.
	}
}
