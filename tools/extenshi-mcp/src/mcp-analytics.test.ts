import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for FastMCP's session: the module under test only touches the
// prototype's `connect` / `updateAuth` and the `server` getter.
class FakeSession {
	readonly server = { id: Symbol('server') }
	async connect(_transport?: unknown): Promise<void> {}
	updateAuth(_auth: unknown): void {}
}

const instrument = vi.fn()
vi.mock('fastmcp', () => ({ FastMCPSession: FakeSession }))
vi.mock('@posthog/mcp', () => ({ instrument }))
vi.mock('./telemetry.js', () => ({ telemetryClient: () => ({}) }))

type BeforeSend = (event: { event: string; properties: Record<string, unknown> }) => unknown

const toolCall = () => ({
	event: '$mcp_tool_call',
	properties: {
		$mcp_tool_name: 'get_extension',
		$mcp_is_error: true,
		$mcp_error_type: 'UserError',
		$mcp_error_message: 'No extension with store id abcdefghijklmnopabcdefghijklmnop',
		$mcp_parameters: { store_id: 'abcdefghijklmnopabcdefghijklmnop' },
		$mcp_response: { content: [{ type: 'text', text: 'secret' }] },
		$mcp_intent: 'user goal',
	},
})

/** Fresh module per test: installation is once-per-process by design. */
async function install(opts: { surface: string; perSessionConsent?: boolean }) {
	vi.resetModules()
	instrument.mockClear()
	FakeSession.prototype.connect = async () => {}
	FakeSession.prototype.updateAuth = () => {}
	const { instrumentMcpAnalytics } = await import('./mcp-analytics.js')
	instrumentMcpAnalytics(opts)
	const session = new FakeSession()
	await session.connect()
	const [server, , options] = instrument.mock.calls[0]
	return { session, server, options, beforeSend: options.beforeSend as BeforeSend }
}

describe('instrumentMcpAnalytics', () => {
	beforeEach(() => instrument.mockClear())

	it('instruments the session server on connect without touching tool schemas or results', async () => {
		const { session, server, options } = await install({ surface: 'mcp' })
		expect(server).toBe(session.server)
		expect(options).toMatchObject({
			context: false,
			captureModel: false,
			enableConversationId: false,
			enableExceptionAutocapture: false,
		})
		expect(options.eventProperties()).toEqual({ surface: 'mcp' })
	})

	it('never sends arguments, results, intent or error messages', async () => {
		const { beforeSend } = await install({ surface: 'mcp' })
		const sent = beforeSend(toolCall()) as { properties: Record<string, unknown> }
		expect(sent.properties).toEqual({
			$mcp_tool_name: 'get_extension',
			$mcp_is_error: true,
			$mcp_error_type: 'UserError',
		})
		expect(JSON.stringify(sent)).not.toContain('abcdefghijklmnop')
	})

	describe('with perSessionConsent (hosted connector)', () => {
		it('fails closed until the session auth has consented', async () => {
			const { beforeSend } = await install({ surface: 'mcp-remote', perSessionConsent: true })
			expect(beforeSend(toolCall())).toBeNull()
		})

		it('drops events for a session that declined analytics', async () => {
			const { session, beforeSend } = await install({ surface: 'mcp-remote', perSessionConsent: true })
			session.updateAuth({ userId: 'u1', telemetry: false })
			expect(beforeSend(toolCall())).toBeNull()
		})

		it('sends once consented, and follows a later change of mind', async () => {
			const { session, beforeSend } = await install({ surface: 'mcp-remote', perSessionConsent: true })
			session.updateAuth({ userId: 'u1', telemetry: true })
			expect(beforeSend(toolCall())).not.toBeNull()
			session.updateAuth({ userId: 'u1', telemetry: false })
			expect(beforeSend(toolCall())).toBeNull()
		})

		it('keeps consent per session', async () => {
			const { beforeSend } = await install({ surface: 'mcp-remote', perSessionConsent: true })
			const other = new FakeSession()
			other.updateAuth({ telemetry: true })
			expect(beforeSend(toolCall())).toBeNull()
		})
	})
})
