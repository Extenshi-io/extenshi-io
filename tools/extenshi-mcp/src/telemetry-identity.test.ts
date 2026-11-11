import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'extenshi-telemetry-identity-'))
const CONFIG = path.join(HOME, '.extenshi', 'config.json')
const INSTALL = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '22222222-2222-4222-8222-222222222222'
/** What `extenshi telemetry on` and a `y` at the first-run question write. */
const CONSENT = { telemetry: true, telemetryConsentVersion: 2 }
const SAVED = { ...process.env }
const { capture, captureException } = vi.hoisted(() => ({
	capture: vi.fn(),
	captureException: vi.fn(),
}))
vi.mock('node:os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:os')>()
	return { ...actual, default: { ...actual, homedir: () => HOME } }
})
const clientOptions: Array<Record<string, unknown>> = []
vi.mock('posthog-node', () => ({
	PostHog: class {
		constructor(_key: string, options: Record<string, unknown>) {
			clientOptions.push(options)
		}
		capture = capture
		captureException = captureException
	},
}))

function writeConfig(value: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(CONFIG), { recursive: true })
	fs.writeFileSync(CONFIG, JSON.stringify(value))
}

function readConfig(): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
	vi.resetModules()
	vi.clearAllMocks()
	clientOptions.length = 0
	process.env = { ...SAVED }
	delete process.env.DO_NOT_TRACK
	delete process.env.EXTENSHI_TELEMETRY
	delete process.env.EXTENSHI_POSTHOG_KEY
	fs.rmSync(path.dirname(CONFIG), { recursive: true, force: true })
})
afterEach(() => {
	process.env = { ...SAVED }
})
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }))

describe('consent gate — off unless the user said yes', () => {
	it('sends nothing and creates no identity when nobody has answered', async () => {
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryEnabled()).toBe(false)
		expect(telemetry.telemetryAnonymousId()).toBeUndefined()
		expect(telemetry.telemetryClient()).toBeNull()
		telemetry.captureEvent('test')
		telemetry.captureError(new Error('boom'))
		expect(capture).not.toHaveBeenCalled()
		expect(captureException).not.toHaveBeenCalled()
		expect(fs.existsSync(CONFIG)).toBe(false)
	})

	it('does not read back an id that is already on the machine', async () => {
		// Left by a release that reported by default: without consent it is not
		// used, and the file is not touched.
		writeConfig({ anonId: INSTALL, apiKey: 'private-key' })
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryAnonymousId()).toBeUndefined()
		telemetry.captureEvent('test')
		expect(capture).not.toHaveBeenCalled()
		expect(readConfig()).toEqual({ anonId: INSTALL, apiKey: 'private-key' })
	})

	it('does not count a yes saved by the old default-on [Y/n] prompt', async () => {
		writeConfig({ telemetry: true, anonId: INSTALL })
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryEnabled()).toBe(false)
		telemetry.captureEvent('test')
		expect(capture).not.toHaveBeenCalled()
		expect(readConfig()).toEqual({ telemetry: true, anonId: INSTALL })
	})

	it.each([1, 3, '2'])('does not count a yes to another wording (version %j)', async (version) => {
		writeConfig({ telemetry: true, telemetryConsentVersion: version })
		expect((await import('./telemetry.js')).telemetryEnabled()).toBe(false)
	})

	it('reports once the current question was answered yes', async () => {
		writeConfig(CONSENT)
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryEnabled()).toBe(true)
		telemetry.captureEvent('test')
		expect(capture).toHaveBeenCalledTimes(1)
	})

	it('honors a saved no without minting an anonId', async () => {
		writeConfig({ telemetry: false })
		expect((await import('./telemetry.js')).telemetryAnonymousId()).toBeUndefined()
		expect(readConfig()).toEqual({ telemetry: false })
	})

	it.each(['DO_NOT_TRACK', 'EXTENSHI_TELEMETRY'])(
		'%s switches a consenting machine off without touching its identity',
		async (name) => {
			writeConfig(CONSENT)
			process.env[name] = name === 'DO_NOT_TRACK' ? '1' : 'off'
			const telemetry = await import('./telemetry.js')
			expect(telemetry.telemetryAnonymousId()).toBeUndefined()
			telemetry.captureEvent('test')
			expect(capture).not.toHaveBeenCalled()
			expect(readConfig()).toEqual(CONSENT)
		},
	)

	it('EXTENSHI_TELEMETRY=1 is an explicit yes for one environment', async () => {
		process.env.EXTENSHI_TELEMETRY = '1'
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryEnabled()).toBe(true)
		telemetry.captureEvent('test')
		expect(capture).toHaveBeenCalledTimes(1)
	})

	it('DO_NOT_TRACK beats EXTENSHI_TELEMETRY=1', async () => {
		process.env.EXTENSHI_TELEMETRY = '1'
		process.env.DO_NOT_TRACK = '1'
		expect((await import('./telemetry.js')).telemetryEnabled()).toBe(false)
	})

	it('an emptied key ships dark whatever was agreed', async () => {
		writeConfig(CONSENT)
		process.env.EXTENSHI_POSTHOG_KEY = ''
		process.env.EXTENSHI_TELEMETRY = '1'
		expect((await import('./telemetry.js')).telemetryEnabled()).toBe(false)
	})

	it('the hosted connector gates per connection instead of on a saved answer', async () => {
		const telemetry = await import('./telemetry.js')
		telemetry.useSessionConsent()
		expect(telemetry.telemetryEnabled()).toBe(true)
		// …and a refusal in its environment still wins.
		process.env.DO_NOT_TRACK = '1'
		expect(telemetry.telemetryEnabled()).toBe(false)
	})
})

describe('install identity shared by CLI and MCP', () => {
	it('keeps the persisted ID and never links it to the API key', async () => {
		writeConfig({ ...CONSENT, anonId: INSTALL, apiKey: 'private-key' })
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryAnonymousId()).toBe(INSTALL)
		telemetry.captureEvent('test')
		expect(capture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: INSTALL }))
		expect(JSON.stringify(capture.mock.calls)).not.toContain('private-key')
		expect(readConfig()).toEqual({ ...CONSENT, anonId: INSTALL, apiKey: 'private-key' })
	})

	it('persists one install ID across fresh module loads', async () => {
		writeConfig(CONSENT)
		const initial = (await import('./telemetry.js')).telemetryAnonymousId()
		expect(initial).toMatch(/^[0-9a-f-]{36}$/)
		vi.resetModules()
		expect((await import('./telemetry.js')).telemetryAnonymousId()).toBe(initial)
		expect(readConfig()).toEqual({ ...CONSENT, anonId: initial })
	})

	it('attributes remote errors to the account without changing the install identity', async () => {
		writeConfig({ ...CONSENT, anonId: INSTALL })
		const telemetry = await import('./telemetry.js')
		telemetry.captureError(new Error('failure'), { tool: 'get_extension' }, ACCOUNT)
		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			ACCOUNT,
			expect.objectContaining({ tool: 'get_extension' }),
		)
		telemetry.captureError(new Error('local'))
		expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), INSTALL, expect.any(Object))
		expect(telemetry.telemetryAnonymousId()).toBe(INSTALL)
	})
})

// The first-run question (telemetry-consent.ts in the CLI) tells the user what a
// report carries. These pin the two claims that only this file can break.
describe('what a report carries', () => {
	it('adds only the documented base properties to an event', async () => {
		writeConfig(CONSENT)
		const telemetry = await import('./telemetry.js')
		telemetry.initTelemetry({ surface: 'cli', version: '1.2.3' })
		telemetry.captureEvent('cli_command_started', { command: 'scan' })
		const { properties } = capture.mock.calls[0][0] as { properties: Record<string, unknown> }
		expect(Object.keys(properties).sort()).toEqual([
			'arch',
			'ci',
			'command',
			'node',
			'os',
			'surface',
			'version',
		])
		expect(properties).toMatchObject({ surface: 'cli', version: '1.2.3', os: process.platform })
	})

	it('removes the home path from a crash message and its stack trace', async () => {
		writeConfig(CONSENT)
		const telemetry = await import('./telemetry.js')
		const crash = new Error(`ENOENT: no such file, open '${HOME}/project/manifest.json'`)
		crash.stack = [
			`Error: ENOENT: no such file, open '${HOME}/project/manifest.json'`,
			`    at readManifest (${HOME}/node_modules/@extenshi/cli/dist/manifest.js:10:5)`,
			'    at run (file:///Users/alice/.npm/_npx/abc/node_modules/@extenshi/cli/dist/cli.js:3:1)',
			'    at main (/home/bob/work/tool.js:1:1)',
			'    at C:\\Users\\Carol\\AppData\\Roaming\\npm\\node_modules\\@extenshi\\cli\\dist\\cli.js:9:9',
		].join('\n')
		telemetry.captureError(crash, { command: 'scan' })

		const sent = captureException.mock.calls[0][0] as Error
		const text = `${sent.message}\n${sent.stack}`
		expect(text).not.toContain(HOME)
		expect(text).not.toMatch(/alice|bob|Carol/)
		expect(sent.message).toBe("ENOENT: no such file, open '~/project/manifest.json'")
		// The frames themselves survive — it is still a usable stack trace.
		expect(sent.stack).toContain('at readManifest (~/node_modules/@extenshi/cli/dist/manifest.js:10:5)')
		// A `cause` would carry the unredacted original past the redaction.
		expect(sent.cause).toBeUndefined()
	})

	it('sends the stack trace without the source lines posthog-node reads from disk', async () => {
		writeConfig(CONSENT)
		const telemetry = await import('./telemetry.js')
		telemetry.captureEvent('test')
		// The hook the client is built with is the one that runs on every event.
		const beforeSend = clientOptions[0].before_send as typeof telemetry.stripSourceContext
		expect(beforeSend).toBe(telemetry.stripSourceContext)

		const frame = {
			filename: '~/node_modules/@extenshi/cli/dist/cli.js',
			function: 'run',
			lineno: 3,
			colno: 1,
			pre_context: [`const key = readFileSync('${HOME}/.extenshi/config.json')`],
			context_line: 'throw new Error(key)',
			post_context: ['}'],
		}
		const sent = beforeSend({
			event: '$exception',
			properties: { command: 'scan', $exception_list: [{ type: 'Error', stacktrace: { frames: [frame] } }] },
		})
		expect(sent?.properties).toEqual({
			command: 'scan',
			$exception_list: [
				{
					type: 'Error',
					stacktrace: {
						frames: [
							{ filename: '~/node_modules/@extenshi/cli/dist/cli.js', function: 'run', lineno: 3, colno: 1 },
						],
					},
				},
			],
		})
		// Ordinary events pass through untouched.
		const plain = { event: 'cli_command_started', properties: { command: 'scan' } }
		expect(beforeSend(plain)).toBe(plain)
	})
})
