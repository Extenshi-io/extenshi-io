/**
 * Opt-in usage telemetry — VENDORED, kept byte-identical between @extenshi/cli
 * and @extenshi/mcp (same pattern as validate-artifact.ts). Edit one, copy to
 * the other.
 *
 * Off unless the user said yes. Storing an ID on someone's machine and reading
 * it back for analytics needs prior consent (LSSI art. 22.2 / ePrivacy 5(3)),
 * so nothing is sent and no `anonId` is minted or read unless ONE of these holds:
 *   - ~/.extenshi/config.json records a yes to the CURRENT question — both
 *     "telemetry": true and "telemetryConsentVersion": TELEMETRY_CONSENT_VERSION
 *     (written by the CLI's first-run question and by `extenshi telemetry on`);
 *   - EXTENSHI_TELEMETRY is 1/true/on/yes — typed by hand, for one environment;
 *   - the host called useSessionConsent(): the hosted connector, which runs on
 *     our servers and asks every connection on its own consent screen.
 * No answer, a timeout, no TTY, CI and a headless MCP server all mean off.
 * DO_NOT_TRACK (https://consoledonottrack.com), EXTENSHI_TELEMETRY=0/false/off/no
 * and an emptied key (EXTENSHI_POSTHOG_KEY='') win over all three.
 *
 * What a report carries. TELEMETRY_PROMPT_TEXT (the CLI's telemetry-consent.ts)
 * is what the user agreed to, so keep it in step with this list:
 *   - command/tool name, surface, package + Node version, os/arch, a CI bool
 *   - the NAMES of CLI flags used (never their values — see flagsFromArgv)
 *   - outcome, duration, exit code and a coarse error_kind
 *   - for an unexpected failure, the error message and stack trace: the home
 *     directory replaced by `~` (sanitizeError), the attached source lines
 *     removed (stripSourceContext). A message can still quote user input.
 * Never artifact or file contents, manifest data, API keys or flag values.
 *
 * Identity is a random per-install UUID in ~/.extenshi/config.json (`anonId`):
 * an install, not a person, never linked client-side to the API key or account.
 *
 * Fail-soft: a throw in here is swallowed and can never break the command.
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

/**
 * Which wording of the consent question a saved `telemetry: true` answers.
 *
 * Version 1 carried no marker at all: it was the default-on `[Y/n]` prompt,
 * where an empty Enter counted as yes. That is not consent, so a `true` saved
 * without this marker is treated as "never asked" — off, and the CLI asks again.
 * A saved `false` needs no marker; a refusal stands whatever it was a refusal of.
 *
 * Bump it whenever the question changes what the user is agreeing to (a new
 * kind of data, a new recipient). Compared with `===` on purpose: a yes to a
 * later wording is not a yes to this one either.
 */
export const TELEMETRY_CONSENT_VERSION = 2

interface TelemetryConfigFile {
	anonId?: string
	telemetry?: boolean
	telemetryConsentVersion?: number
}

/** True only for a saved yes to the current question. See TELEMETRY_CONSENT_VERSION. */
export function consentRecorded(cfg: { telemetry?: unknown; telemetryConsentVersion?: unknown }): boolean {
	return cfg.telemetry === true && cfg.telemetryConsentVersion === TELEMETRY_CONSENT_VERSION
}

let surface = 'unknown'
let appVersion = '0.0.0'
let client: PostHog | null = null
let triedInit = false
let cachedAnonId: string | null = null
let consentSource: 'device' | 'session' = 'device'

/** Record the surface + version once at process startup. */
export function initTelemetry(opts: { surface: string; version: string }): void {
	surface = opts.surface
	appVersion = opts.version
}

/**
 * Declare that consent is collected per connection by the host, not saved on
 * this machine. For the hosted connector only: it runs on our own servers, so
 * there is no user device to store an ID on, and every event it sends is gated
 * on that connection's answer to its consent screen (mcp-analytics.ts,
 * session-telemetry.ts). Must be called before the first event of the process.
 */
export function useSessionConsent(): void {
	consentSource = 'session'
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

/**
 * Off by default. The order is the contract: the switches that turn reporting
 * OFF are read first, so no way of turning it on can override a refusal.
 */
export function telemetryEnabled(): boolean {
	if (!telemetryKey()) return false
	if (isTruthy(process.env.DO_NOT_TRACK)) return false
	const t = (process.env.EXTENSHI_TELEMETRY ?? '').trim().toLowerCase()
	if (t === '0' || t === 'false' || t === 'off' || t === 'no') return false
	if (isTruthy(t)) return true
	if (consentSource === 'session') return true
	return consentRecorded(readConfig())
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

/** The existing install identity, without identifying or aliasing an account. */
export function telemetryAnonymousId(): string | undefined {
	// Without consent the id is neither minted nor read back from the config.
	return telemetryEnabled() ? anonId() : undefined
}

const SOURCE_CONTEXT_KEYS = ['pre_context', 'context_line', 'post_context']

/**
 * posthog-node opens the source file behind every stack frame and attaches the
 * lines around it to the report. A stack trace is what the user agreed to send;
 * the contents of files on their disk are not, so those lines are removed from
 * every event before it is queued. If that ever fails the event is dropped —
 * losing a crash report is the cheaper mistake.
 */
export function stripSourceContext<T extends { properties?: Record<string | number, unknown> }>(
	event: T,
): T | null {
	try {
		const exceptions = event.properties?.$exception_list
		if (!Array.isArray(exceptions)) return event
		for (const exception of exceptions) {
			const frames = (exception as { stacktrace?: { frames?: unknown } } | null)?.stacktrace?.frames
			if (!Array.isArray(frames)) continue
			for (const frame of frames) {
				if (!frame || typeof frame !== 'object') continue
				for (const key of SOURCE_CONTEXT_KEYS) delete (frame as Record<string, unknown>)[key]
			}
		}
		return event
	} catch {
		return null
	}
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
		client = new PostHog(telemetryKey(), {
			host: telemetryHost(),
			flushAt: 20,
			flushInterval: 5000,
			before_send: stripSourceContext,
		})
	} catch {
		client = null
	}
	return client
}

/**
 * The shared posthog-node client, or null when telemetry is disabled. Exposed so
 * the MCP package's PostHog MCP Analytics instrumentation (mcp-analytics.ts)
 * rides this same client: one consent gate, one flush path (flushTelemetry).
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

const FLAG_NAME = /^--[A-Za-z][A-Za-z0-9-]{0,63}$/

/**
 * The NAMES of long flags the user passed, with values stripped. `--out=/x`
 * becomes `--out`; the separate-token value of `--output /x` is never a `--`
 * token, so it is never collected. A token is kept only when what is left looks
 * like a flag name (letters, digits, dashes), so a value that happens to start
 * with `--` — a path, a URL, free text — is dropped rather than reported.
 */
export function flagsFromArgv(argv: string[] = process.argv.slice(2)): string[] {
	const flags = new Set<string>()
	for (const tok of argv) {
		if (!tok.startsWith('--')) continue
		const name = tok.split('=')[0]
		if (FLAG_NAME.test(name)) flags.add(name)
	}
	return [...flags]
}

/**
 * `distinctId` overrides the per-install id. The CLI never passes it —
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

export function captureError(err: unknown, context: Record<string, unknown> = {}, distinctId?: string): void {
	const c = getClient()
	if (!c) return
	try {
		c.captureException(sanitizeError(err), distinctId?.trim() || anonId(), { ...baseProps(), ...context })
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
