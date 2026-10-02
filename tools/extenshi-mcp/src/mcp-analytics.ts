/**
 * PostHog MCP Analytics (`@posthog/mcp`) — `$mcp_tool_call` etc. for the MCP
 * Analytics product, on top of our own `mcp_tool_*` events (telemetry.ts).
 *
 * FastMCP builds a fresh low-level SDK `Server` per session (stdio: one; HTTP: one
 * per MCP session). We instrument it in `FastMCPSession.connect`, BEFORE the
 * transport delivers anything. FastMCP's own `connect` event is too late: it fires
 * only after FastMCP has polled for client capabilities and listed roots, by which
 * point `initialize`, `tools/list` and early `tools/call`s have already been
 * served uninstrumented. The SDK also wraps `setRequestHandler`, so the tool
 * handlers FastMCP re-registers on `toolsListChanged` stay instrumented.
 *
 * It reuses the telemetry client, so the same opt-outs apply (DO_NOT_TRACK,
 * EXTENSHI_TELEMETRY, config `telemetry: false`) and flushTelemetry() drains it.
 *
 * Per-connection consent (hosted connector): the consent screen lets a user
 * decline analytics, recorded as `telemetry: false` on the session's auth (see
 * tools/extenshi-mcp-server/src/identity.ts; tools.ts honours it for our own
 * events). FastMCP keeps a session's auth private, but mcp-proxy hands every
 * validated auth to the public `updateAuth` before it handles a request on an
 * existing session, so we record the choice there. With `perSessionConsent`,
 * events are sent only once a session's auth has said yes — fail closed, so the
 * `initialize` that opens a session (before any updateAuth) is never sent.
 *
 * Configured to keep telemetry.ts's promise — no raw user input, no file paths:
 *   - tool arguments, results and agent intent are dropped (beforeSend);
 *   - error MESSAGES are dropped too: tool errors echo arguments (store ids,
 *     artifact paths), so only `$mcp_is_error` and `$mcp_error_type` remain;
 *   - nothing is injected into tool schemas or results (context, llm_model and
 *     conversation_id parameters are all off), so the tool surface is unchanged;
 *   - `$exception` siblings are off — captureError() already reports those.
 */

import { instrument } from '@posthog/mcp'
import { FastMCPSession } from 'fastmcp'
import { telemetryClient } from './telemetry.js'

const DROPPED_PROPERTIES = [
	'$mcp_parameters',
	'$mcp_response',
	'$mcp_intent',
	'$mcp_intent_source',
	'$mcp_error_message',
]

interface Options {
	surface: string
	/** Send a session's events only after its auth has consented (hosted connector). */
	perSessionConsent?: boolean
}

/** Latest analytics consent per session, from the auth mcp-proxy passes to updateAuth. */
const consent = new WeakMap<FastMCPSession, boolean>()

let installed = false

/** Call once per process, before `server.start()`. */
export function instrumentMcpAnalytics(opts: Options): void {
	if (installed) return
	installed = true
	const proto = FastMCPSession.prototype
	const connect = proto.connect
	proto.connect = function (this: FastMCPSession, ...args: Parameters<typeof connect>) {
		instrumentSession(this, opts)
		return connect.apply(this, args)
	}
	if (opts.perSessionConsent) {
		const updateAuth = proto.updateAuth
		proto.updateAuth = function (this: FastMCPSession, ...args: Parameters<typeof updateAuth>) {
			// Same rule as tools.ts: only an explicit `telemetry: false` declines.
			consent.set(this, (args[0] as { telemetry?: unknown } | undefined)?.telemetry !== false)
			return updateAuth.apply(this, args)
		}
	}
}

function instrumentSession(session: FastMCPSession, opts: Options): void {
	const posthog = telemetryClient()
	if (!posthog) return
	try {
		instrument(session.server, posthog, {
			context: false,
			captureModel: false,
			enableConversationId: false,
			enableExceptionAutocapture: false,
			eventProperties: () => ({ surface: opts.surface }),
			beforeSend: (event) => {
				if (opts.perSessionConsent && consent.get(session) !== true) return null
				const props = event.properties ?? {}
				for (const key of DROPPED_PROPERTIES) delete props[key]
				return event
			},
		})
	} catch {
		// Analytics must never break a session.
	}
}
