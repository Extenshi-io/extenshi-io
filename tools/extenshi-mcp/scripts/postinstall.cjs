'use strict'
/**
 * Install ping — VENDORED, kept byte-identical between @extenshi/cli
 * and @extenshi/mcp (it figures out which one it is from its own package.json).
 *
 * Fires a single `cli_installed` / `mcp_installed` event when the package is
 * installed as a real dependency ON A MACHINE THAT HAS ALREADY ACCEPTED
 * telemetry, so we can see adoption in PostHog. It is a standalone CommonJS
 * script using ONLY Node built-ins (no posthog-node, no build step) so it can
 * run the instant npm extracts the tarball.
 *
 * Hard rules (a postinstall that breaks `npm install` is unacceptable):
 *   - ALWAYS exits 0, even on any error — wrapped in try/catch + a hard timeout.
 *   - Fully fail-soft and fire-and-forget; the request is capped at ~2s.
 *
 * It self-skips (no event, no network) when:
 *   - the package is NOT under node_modules — i.e. our own monorepo workspace
 *     install (tools/<pkg>), so dev installs never inflate adoption counts;
 *   - ~/.extenshi/config.json does not record a yes to the CURRENT question
 *     ("telemetry": true next to "telemetryConsentVersion": CONSENT_VERSION).
 *     A postinstall runs before the CLI can ask anything, so "no answer yet"
 *     is not permission (see the ACCEPTED-ONLY note below);
 *   - DO_NOT_TRACK is truthy or EXTENSHI_TELEMETRY is off;
 *   - CI is set (CI re-installs would massively inflate the count);
 *   - no ingestion key is configured.
 *
 * Privacy: sends only the package version, Node version, coarse os/arch, a
 * first-install-on-this-machine boolean, and the random per-install UUID (the
 * same id the runtime telemetry uses). Never any path, package contents, or
 * user input.
 *
 * ACCEPTED-ONLY, and what that costs. Until 2026-08-13 this fired unless the
 * user had actively opted out, which meant a first-ever install reported before
 * anyone had been asked — the one place consent did not reach after the CLI
 * grew a first-run question (tools/extenshi-cli/src/telemetry-consent.ts). The
 * gate is now positive, and the consequences are deliberate:
 *   - a FIRST install never pings. Only the CLI's first-run question writes
 *     `telemetry: true`, and that happens on the first RUN, so the earliest
 *     ping is the next upgrade of an accepted machine.
 *   - @extenshi/mcp is headless and never prompts, so it can only ping on a
 *     machine where the CLI recorded consent into the shared config. Treat its
 *     install count as gone, not as a number that dropped.
 *   - `first_extenshi_install` is therefore ~always false now. It is kept so the
 *     event schema does not change under existing PostHog queries, not because
 *     it still measures anything.
 *
 * NB for anyone reading this as an adoption metric: it counts npm EXTRACTIONS,
 * not users. Most of them are ecosystem scanners that install a new version once
 * on a throwaway machine and never run the binary. The "did a client actually
 * launch the server" signal is `mcp_server_started`, emitted from
 * @extenshi/mcp's src/startup.ts — a relative path would be wrong in one of the
 * two packages, since this file is vendored byte-identical into both.
 */

// Shared EU PostHog project key (114791) — public, write-only, already in our
// web bundles. Override with EXTENSHI_POSTHOG_KEY; empty disables the ping.
// NB: this line's NUMBER is pinned in .infisicalignore
// (`…/postinstall.cjs:generic-api-key:<line>`) — gitleaks fingerprints include
// it, so ADDING OR REMOVING LINES ABOVE HERE breaks the allowlist and turns the
// key into a CI secret-scan failure. Move the fingerprint with it.
const EMBEDDED_KEY = 'phc_fqKrAmtNZvJqe0krpYB3UwYqALLpT1WM8m5LtNs9eUu'
const DEFAULT_HOST = 'https://eu.i.posthog.com'

/**
 * Every guard below calls this as `return done()`, not as a bare statement. The
 * process.exit is what actually stops the script, but the `return` is what keeps
 * the early exit true if this ever stops exiting synchronously — without it, a
 * deferred done() would let the code past the consent gate run on a machine that
 * never agreed to be measured.
 */
function done() {
	process.exit(0)
}

// A standalone script cannot import telemetry.ts, so this is a copy of its
// TELEMETRY_CONSENT_VERSION.
const CONSENT_VERSION = 2

try {
	const path = require('node:path')
	const fs = require('node:fs')
	const os = require('node:os')
	const https = require('node:https')
	const { randomUUID } = require('node:crypto')

	// Real dependency install only — workspace path has no /node_modules/ segment.
	if (!__dirname.includes(`${path.sep}node_modules${path.sep}`)) return done()

	// CI re-installs would inflate the adoption count — skip them.
	if (process.env.CI) return done()

	const key = (process.env.EXTENSHI_POSTHOG_KEY || EMBEDDED_KEY).trim()
	if (!key) return done()

	const dnt = String(process.env.DO_NOT_TRACK || '')
		.trim()
		.toLowerCase()
	if (['1', 'true', 'yes', 'on'].includes(dnt)) return done()
	const optOut = String(process.env.EXTENSHI_TELEMETRY || '')
		.trim()
		.toLowerCase()
	if (['0', 'false', 'off', 'no'].includes(optOut)) return done()

	// The per-install id is shared with the runtime telemetry module.
	const configPath = path.join(os.homedir(), '.extenshi', 'config.json')
	let cfg = {}
	try {
		cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
	} catch {}

	// Positive consent only. An install happens before the CLI can put the
	// question, so an absent answer is "not asked yet", never "yes" — this exits
	// for a machine that declined AND for one that has never been asked. Every
	// line below this point, including minting the install id, is reached only
	// with a recorded `true`, which is what stops a bare `npx` from creating an
	// identity on a machine that never agreed to one. The yes must also be to the
	// current question: a `true` left by the old default-on `[Y/n]` prompt has no
	// version next to it and does not count (telemetry.ts,
	// TELEMETRY_CONSENT_VERSION — postinstall.test.ts keeps the two in step).
	if (!cfg || cfg.telemetry !== true || cfg.telemetryConsentVersion !== CONSENT_VERSION) return done()

	let anonId = cfg.anonId
	// Retained for event-schema stability, but it no longer measures anything:
	// accepting the first-run question writes `telemetry: true` and then emits an
	// event, which mints the id — so by the time this gate opens, an anonId is
	// already there and this is false. It stays true only in the odd case of a
	// config that kept the answer but lost the id. Before the accepted-only gate
	// it was the new-machine-vs-upgrade discriminator described above.
	const firstExtenshiInstall = !anonId
	if (!anonId) {
		anonId = randomUUID()
		try {
			fs.mkdirSync(path.dirname(configPath), { recursive: true })
			fs.writeFileSync(configPath, `${JSON.stringify({ ...cfg, anonId }, null, 2)}\n`, { mode: 0o600 })
		} catch {}
	}

	// Identify the surface + version from our own package.json.
	let pkg = {}
	try {
		pkg = require(path.join(__dirname, '..', 'package.json'))
	} catch {}
	const surface = String(pkg.name || '').includes('mcp') ? 'mcp' : 'cli'
	const host = (process.env.EXTENSHI_POSTHOG_HOST || DEFAULT_HOST).trim()

	const payload = JSON.stringify({
		api_key: key,
		event: `${surface}_installed`,
		distinct_id: anonId,
		properties: {
			surface,
			version: pkg.version || '0.0.0',
			node: process.version,
			os: process.platform,
			arch: process.arch,
			ci: false,
			source: 'npm_postinstall',
			first_extenshi_install: firstExtenshiInstall,
		},
	})

	const url = new URL('/i/v0/e/', host)
	const req = https.request(
		{
			method: 'POST',
			hostname: url.hostname,
			port: url.port || 443,
			path: url.pathname,
			headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
			timeout: 2000,
		},
		(res) => {
			res.on('data', () => {})
			res.on('end', done)
			res.on('error', done)
		},
	)
	req.on('error', done)
	req.on('timeout', () => {
		try {
			req.destroy()
		} catch {}
		done()
	})
	req.write(payload)
	req.end()

	// Backstop: never let the ping hold the install open.
	const guard = setTimeout(done, 2500)
	if (guard.unref) guard.unref()
} catch {
	done()
}
