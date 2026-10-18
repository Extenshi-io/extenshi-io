/**
 * Best-effort "a newer version is available" nudge.
 *
 * The MCP has no built-in update mechanism — a pinned global install
 * (`npm i -g @extenshi/mcp`) stays on whatever version was installed, and even
 * an `npx @extenshi/mcp` (no `@latest`) can serve a stale cache. So on startup
 * we ask the npm registry once for the latest published version and, if we're
 * behind, print a one-line hint to STDERR.
 *
 * Hard constraints:
 *  - STDERR only. stdout is the MCP protocol channel (see index.ts header).
 *  - Fully fail-soft: any network/parse/timeout error is swallowed silently.
 *  - Non-blocking: callers fire-and-forget so tool availability is never delayed.
 *  - Opt-out honoured (shares the telemetry opt-out switches + a dedicated one).
 */

const REGISTRY_URL = 'https://registry.npmjs.org/@extenshi/mcp/latest'
const TIMEOUT_MS = 2500

/** True when the user has opted out of the (network) update check. */
export function updateCheckOptedOut(env: NodeJS.ProcessEnv = process.env): boolean {
	return (
		env.EXTENSHI_NO_UPDATE_CHECK === '1' ||
		env.DO_NOT_TRACK === '1' ||
		env.EXTENSHI_TELEMETRY === '0' ||
		env.CI === 'true'
	)
}

/**
 * Returns true when `latest` is a strictly newer 3-part version than `current`.
 * Tolerant of pre-release/garbage: non-numeric parts coerce to 0, and any parse
 * oddity returns false (never nag spuriously).
 */
export function isNewerVersion(current: string, latest: string): boolean {
	const parse = (v: string) =>
		v
			.split('.')
			.slice(0, 3)
			.map((p) => Number.parseInt(p, 10))
	const a = parse(current)
	const b = parse(latest)
	for (let i = 0; i < 3; i++) {
		const x = Number.isFinite(a[i]) ? a[i] : 0
		const y = Number.isFinite(b[i]) ? b[i] : 0
		if (y > x) return true
		if (y < x) return false
	}
	return false
}

/** Build the stderr hint (exported for testability). */
export function updateMessage(current: string, latest: string): string {
	return (
		`[extenshi-mcp] A newer version is available: ${current} → ${latest}. ` +
		'If your client runs `npx -y @extenshi/mcp@latest`, just restart it. ' +
		'For a pinned global install: `npm i -g @extenshi/mcp@latest`, then restart. ' +
		'(Silence this with EXTENSHI_NO_UPDATE_CHECK=1.)\n'
	)
}

/** What the last check learned, for connection_diagnostics: stderr never reaches the agent. */
export interface KnownUpdate {
	version: string
	latestVersion: string
	updateAvailable: boolean
	howToUpdate: string | null
}
let known: KnownUpdate | null = null

/** The result of this process's update check, or null when none finished (opted out, offline, remote). */
export function knownUpdate(): KnownUpdate | null {
	return known
}

/**
 * Fire-and-forget update check. Never throws; writes at most one line to stderr.
 * `fetchImpl`/`out` are injectable for tests.
 */
export async function checkForUpdate(
	current: string,
	fetchImpl: typeof fetch = fetch,
	out: (msg: string) => void = (m) => process.stderr.write(m),
): Promise<void> {
	if (updateCheckOptedOut()) return
	try {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		let res: Response
		try {
			res = await fetchImpl(REGISTRY_URL, {
				signal: controller.signal,
				headers: { accept: 'application/json' },
			})
		} finally {
			clearTimeout(timer)
		}
		if (!res.ok) return
		const json = (await res.json()) as { version?: unknown }
		const latest = typeof json.version === 'string' ? json.version : undefined
		if (!latest) return
		const updateAvailable = isNewerVersion(current, latest)
		known = {
			version: current,
			latestVersion: latest,
			updateAvailable,
			// A client with a cached npx copy keeps an older tool list until it fetches @latest.
			howToUpdate: updateAvailable
				? 'Restart the client with `npx -y @extenshi/mcp@latest` (or `npm i -g @extenshi/mcp@latest`).'
				: null,
		}
		if (updateAvailable) out(updateMessage(current, latest))
	} catch {
		// Offline, aborted, non-JSON, registry hiccup — stay silent.
	}
}
