/**
 * "A real MCP client launched this server" — the signal `mcp_installed` is not.
 *
 * Why this exists: `mcp_installed` fires from scripts/postinstall.cjs the moment
 * npm extracts the tarball, so it counts every machine that INSTALLS the
 * package, whether or not anything ever runs the binary. Measured over the
 * package's lifetime on 2026-08-08, that population is overwhelmingly automated:
 * 107 of 109 install-reporting machines installed exactly one version, exactly
 * once, and were never seen again; 88 of 122 install events were linux/x64
 * across nine different Node majors, arriving within days of each publish. None
 * of them ever emitted a tool call. That is the signature of npm-ecosystem
 * scanners and mirrors, not of developers — so an "activation rate" computed as
 * tool-callers ÷ installers measures robots, and reads as a product failure.
 *
 * A scanner sandbox runs `npm install` and stops there. An MCP client, by
 * construction, EXECUTES the binary — so this event, emitted once per server
 * process, is the honest denominator for "installed → actually used". Pair it
 * with `mcp_tool_called` for a funnel whose numerator and denominator describe
 * the same population.
 *
 * `has_api_key` is a boolean and never the key itself. It answers, at the
 * population level, the question this funnel cannot otherwise settle: of the
 * servers that really start, how many are configured well enough to be useful.
 * Every read/scan tool refuses without a key (see MISSING_KEY_MESSAGE), so a
 * high started-but-keyless share is an onboarding problem, not a demand problem.
 *
 * Privacy is unchanged from ./telemetry.ts: sent only with the user's consent,
 * and one boolean on top of the base properties. No path, no key, no user input.
 */

import { captureEvent } from './telemetry.js'

/** The event name, exported so tests and analyses can't drift from the emitter. */
export const SERVER_STARTED_EVENT = 'mcp_server_started'

/** Sink shape, matching captureEvent — injectable so tests need no PostHog. */
type Capture = (event: string, properties: Record<string, unknown>) => void

/**
 * Everything this event carries beyond the base properties. Declared
 * as a closed type rather than a `Record`, so "the payload is one boolean" is
 * enforced by the compiler instead of asserted in prose: a later edit that tries
 * to smuggle the key itself in here does not type-check.
 *
 * A type alias, not an `interface`, deliberately: an interface gets no implicit
 * index signature, so it is not assignable to the `Record<string, unknown>` the
 * sink takes and this would not compile.
 */
export type ServerStartedProperties = {
	has_api_key: boolean
}

/**
 * The properties carried by SERVER_STARTED_EVENT. Split out from the emitter so
 * the mapping "configured key → has_api_key" is directly testable, and so it is
 * obvious at review time that the key's VALUE never reaches the payload.
 */
export function serverStartedProperties(apiKey: string | null | undefined): ServerStartedProperties {
	return { has_api_key: Boolean(apiKey) }
}

/**
 * Report that this process got far enough to serve the MCP protocol.
 *
 * Fail-soft in the same sense as everything else in this package: telemetry must
 * never be able to stop a server from serving, so any throw from the sink is
 * swallowed. Buffered like every other event — the periodic flush and the
 * SIGTERM/beforeExit handlers in index.ts drain it.
 */
export function reportServerStarted(
	apiKey: string | null | undefined,
	capture: Capture = captureEvent,
): void {
	try {
		capture(SERVER_STARTED_EVENT, serverStartedProperties(apiKey))
	} catch {
		// Never throw into startup.
	}
}
