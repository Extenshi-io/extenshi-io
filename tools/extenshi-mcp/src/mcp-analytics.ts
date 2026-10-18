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
import { bindSessionTelemetryGuard } from './session-telemetry.js'
import { telemetryAnonymousId, telemetryClient, telemetryEnabled } from './telemetry.js'

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

interface SessionActor {
	userId?: string
	allowed: boolean
	revision: number
	/** A connection reused by a different account must reconnect for analytics. */
	ambiguous: boolean
}

// Auth is private in FastMCP; only validated updateAuth calls populate this map.
const actors = new WeakMap<FastMCPSession, SessionActor>()
const AUTH_REVISION = '_extenshi_auth_revision'

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
			const auth = args[0] as { userId?: unknown; telemetry?: unknown } | undefined
			const userId = typeof auth?.userId === 'string' && auth.userId.trim() ? auth.userId : undefined
			const previous = actors.get(this)
			const allowed = userId !== undefined && auth?.telemetry === true
			const ambiguous =
				previous?.ambiguous === true || Boolean(previous?.userId && userId && previous.userId !== userId)
			const changed = previous?.allowed !== allowed || (userId !== undefined && previous?.userId !== userId)
			const snapshot: SessionActor = {
				userId: previous?.userId ?? userId,
				allowed,
				revision: (previous?.revision ?? 0) + Number(changed),
				ambiguous,
			}
			actors.set(this, snapshot)
			// FastMCP reads mutable auth after async validation. Suppress custom
			// telemetry too if this transport switches accounts; permissions and
			// backend identity remain the validated auth's own values.
			if (args[0]) {
				args[0] = { ...args[0], ...(ambiguous ? { telemetry: false } : {}) }
				bindSessionTelemetryGuard(args[0], () => {
					const current = actors.get(this)
					return (
						snapshot.allowed &&
						current?.allowed === true &&
						!current.ambiguous &&
						current.revision === snapshot.revision
					)
				})
			}
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
			eventProperties: () => ({
				surface: opts.surface,
				...(session.sessionId ? { mcp_session_id: session.sessionId } : {}),
				...(opts.perSessionConsent ? { [AUTH_REVISION]: actors.get(session)?.revision ?? 0 } : {}),
			}),
			beforeSend: (event) => {
				if (!telemetryEnabled()) return null
				const props = event.properties ?? {}
				if (opts.perSessionConsent) {
					const actor = actors.get(session)
					// Snapshot the auth revision before the handler runs. Never attribute
					// an in-flight completion to a later account/consent choice.
					const revision = props[AUTH_REVISION]
					delete props[AUTH_REVISION]
					if (!actor?.allowed || !actor.userId || actor.ambiguous || revision !== actor.revision) return null
					event.distinct_id = actor.userId
					props.$process_person_profile = true
				} else {
					const anonymousId = telemetryAnonymousId()
					if (!anonymousId) return null
					event.distinct_id = anonymousId
					// The install stays anonymous, with no identify or alias to an account.
					props.$process_person_profile = false
				}
				for (const key of DROPPED_PROPERTIES) delete props[key]
				return event
			},
		})
	} catch {
		// Analytics must never break a session.
	}
}
