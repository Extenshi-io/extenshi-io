import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// Resolve the MCP SDK through its owner so this also runs in the standalone
// public mirror, where it is a transitive FastMCP dependency rather than hoisted.
const require = createRequire(import.meta.url)
const requireFromFastMcp = createRequire(require.resolve('fastmcp'))
const { Client } = requireFromFastMcp('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = requireFromFastMcp('@modelcontextprotocol/sdk/inMemory.js')

interface CapturedEvent {
	distinctId: string
	event: string
	properties: Record<string, unknown>
}

const telemetry = vi.hoisted(() => ({
	enabled: true,
	anonymousId: 'ac58ff6a-058b-4382-bbed-42fdd7998d78',
	capture: vi.fn(),
}))

// Only replace the external delivery sink. Both FastMCP and @posthog/mcp execute
// their real request handling, identity transforms and capture pipeline below.
vi.mock('./telemetry.js', () => ({
	telemetryClient: () => (telemetry.enabled ? { capture: telemetry.capture } : null),
	telemetryAnonymousId: () => (telemetry.enabled ? telemetry.anonymousId : undefined),
	telemetryEnabled: () => telemetry.enabled,
}))

const ACCOUNT_A = '68390376-f922-4b3c-a292-f9b3c9e52ee'
const ACCOUNT_B = 'ccba9436-6b44-428f-abdd-7407c9f70502'
const PRIVATE_INPUT = 'private-input-alice@example.com-/Users/alice/private/artifact.zip'
const PRIVATE_RESULT = 'private-result-ek_do_not_capture'
const PRIVATE_ERROR = 'private-error-Bearer-do_not_capture'

function captured(): CapturedEvent[] {
	return telemetry.capture.mock.calls.map(([event]) => event as CapturedEvent)
}

function toolCalls(): CapturedEvent[] {
	return captured().filter((event) => event.event === '$mcp_tool_call')
}

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

type FastMcpModule = typeof import('fastmcp')
let fastMcp: FastMcpModule
let restorePrototype: () => void
const cleanup: Array<() => Promise<unknown>> = []

async function install(perSessionConsent = false) {
	vi.resetModules()
	fastMcp = await import('fastmcp')
	const { connect, updateAuth } = fastMcp.FastMCPSession.prototype
	restorePrototype = () => {
		fastMcp.FastMCPSession.prototype.connect = connect
		fastMcp.FastMCPSession.prototype.updateAuth = updateAuth
	}
	const { instrumentMcpAnalytics } = await import('./mcp-analytics.js')
	instrumentMcpAnalytics({ surface: perSessionConsent ? 'mcp-remote' : 'mcp', perSessionConsent })
}

async function connectSession(sessionId: string) {
	const entered = deferred()
	const release = deferred()
	const session = new fastMcp.FastMCPSession({
		name: 'extenshi-analytics-regression',
		version: '0.0.0',
		logger: { debug() {}, error() {}, info() {}, log() {}, warn() {} },
		ping: { enabled: false },
		roots: { enabled: false },
		transportType: 'httpStream',
		prompts: [],
		resources: [],
		resourcesTemplates: [],
		tools: [
			{
				name: 'privacy_probe',
				description: 'Exercises analytics without external calls.',
				parameters: z.object({
					secret: z.string(),
					fail: z.boolean().optional(),
					wait: z.boolean().optional(),
				}),
				execute: async ({ fail, wait }) => {
					if (wait) {
						entered.resolve()
						await release.promise
					}
					if (fail) throw new Error(PRIVATE_ERROR)
					return PRIVATE_RESULT
				},
			},
		],
	})
	const client = new Client({ name: 'analytics-regression-client', version: '0.0.0' }, { capabilities: {} })
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	serverTransport.sessionId = sessionId
	cleanup.push(async () => {
		release.resolve()
		await client.close()
		await session.close()
	})
	await Promise.all([session.connect(serverTransport), client.connect(clientTransport)])
	await new Promise<void>((resolve) => setImmediate(resolve))
	return {
		session,
		client,
		entered: entered.promise,
		release: release.resolve,
		call: async (extra: { fail?: boolean; wait?: boolean } = {}) => {
			const result = await client.callTool({
				name: 'privacy_probe',
				arguments: { secret: PRIVATE_INPUT, ...extra },
			})
			// SDK auto-capture is deliberately fire-and-forget. Drain its microtasks
			// before negative assertions so a late emission cannot make them vacuous.
			await new Promise<void>((resolve) => setImmediate(resolve))
			return result
		},
	}
}

function expectNoPrivatePayloads() {
	const payload = JSON.stringify(captured())
	for (const secret of [PRIVATE_INPUT, PRIVATE_RESULT, PRIVATE_ERROR, 'private-auth-email@example.com']) {
		expect(payload).not.toContain(secret)
	}
	expect(captured().map(({ event }) => event)).not.toContain('$identify')
	expect(captured().map(({ event }) => event)).not.toContain('$create_alias')
	for (const { properties } of captured()) {
		for (const key of [
			'$mcp_parameters',
			'$mcp_response',
			'$mcp_intent',
			'$mcp_intent_source',
			'$mcp_error_message',
		]) {
			expect(properties).not.toHaveProperty(key)
		}
		expect(Object.keys(properties).filter((key) => /revision|__extenshi/i.test(key))).toEqual([])
	}
}

describe.sequential('MCP analytics actual SDK capture', () => {
	beforeEach(() => {
		telemetry.enabled = true
		telemetry.capture.mockClear()
	})

	afterEach(async () => {
		await Promise.allSettled(cleanup.splice(0).map((close) => close()))
		restorePrototype?.()
	})

	it('keeps local reconnects on the existing anonymous install without sending tool content or aliasing it', async () => {
		await install()
		const first = await connectSession('local-transport-one')
		const second = await connectSession('local-transport-two')
		const result = await first.call()
		expect(result.content).toEqual([{ type: 'text', text: PRIVATE_RESULT }])
		await second.call({ fail: true })
		await vi.waitFor(() => expect(toolCalls()).toHaveLength(2))
		expect(captured().every(({ distinctId }) => distinctId === telemetry.anonymousId)).toBe(true)
		expect(toolCalls().every(({ properties }) => properties.$process_person_profile === false)).toBe(true)
		expect(new Set(toolCalls().map(({ properties }) => properties.$session_id)).size).toBe(2)
		expect(toolCalls().some(({ properties }) => properties.$mcp_is_error === true)).toBe(true)
		const beforeOptOut = captured().length
		telemetry.enabled = false
		await first.call()
		expect(captured()).toHaveLength(beforeOptOut)
		expectNoPrivatePayloads()
	})

	it('isolates hosted users, requires explicit consent and blocks an account switch on the same transport', async () => {
		await install(true)
		const a = await connectSession('remote-transport-a')
		const b = await connectSession('remote-transport-b')
		await a.call()
		await b.call()
		expect(captured()).toEqual([])

		a.session.updateAuth({ userId: ACCOUNT_A, telemetry: true, email: 'private-auth-email@example.com' })
		b.session.updateAuth({ userId: ACCOUNT_B, telemetry: false })
		const pendingA = a.call({ wait: true })
		await a.entered
		await b.call()
		b.session.updateAuth({ userId: ACCOUNT_B, telemetry: true })
		await b.call()
		a.release()
		await pendingA
		await vi.waitFor(() => expect(toolCalls()).toHaveLength(2))
		expect(new Set(toolCalls().map(({ distinctId }) => distinctId))).toEqual(new Set([ACCOUNT_A, ACCOUNT_B]))
		expect(toolCalls().every(({ properties }) => properties.$process_person_profile === true)).toBe(true)
		expect(new Set(toolCalls().map(({ properties }) => properties.$session_id)).size).toBe(2)

		const beforeOptOut = captured().length
		a.session.updateAuth({ userId: ACCOUNT_A, telemetry: false })
		await a.call({ fail: true })
		b.session.updateAuth({ userId: ACCOUNT_B })
		await b.call()
		b.session.updateAuth({ userId: '', telemetry: true })
		await b.call()
		expect(captured()).toHaveLength(beforeOptOut)

		// A transport authenticated as another account must not send either its
		// outstanding completion or later calls under the newly observed identity.
		const changing = await connectSession('remote-transport-changing')
		changing.session.updateAuth({ userId: ACCOUNT_A, telemetry: true })
		const pending = changing.call({ wait: true })
		await changing.entered
		changing.session.updateAuth({ userId: ACCOUNT_B, telemetry: true })
		changing.release()
		await pending
		await changing.call()
		expect(captured()).toHaveLength(beforeOptOut)
		expectNoPrivatePayloads()
	})

	it('does not capture a local session when global telemetry is disabled', async () => {
		telemetry.enabled = false
		await install()
		const local = await connectSession('local-opted-out')
		await local.call({ fail: true })
		expect(captured()).toEqual([])
	})
})
