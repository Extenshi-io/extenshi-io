import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'extenshi-telemetry-identity-'))
const CONFIG = path.join(HOME, '.extenshi', 'config.json')
const INSTALL = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '22222222-2222-4222-8222-222222222222'
const SAVED = { ...process.env }
const { capture, captureException } = vi.hoisted(() => ({
	capture: vi.fn(),
	captureException: vi.fn(),
}))
vi.mock('node:os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:os')>()
	return { ...actual, default: { ...actual, homedir: () => HOME } }
})
vi.mock('posthog-node', () => ({
	PostHog: class {
		capture = capture
		captureException = captureException
	},
}))

beforeEach(() => {
	vi.resetModules()
	vi.clearAllMocks()
	process.env = { ...SAVED }
	delete process.env.DO_NOT_TRACK
	delete process.env.EXTENSHI_TELEMETRY
	fs.rmSync(path.dirname(CONFIG), { recursive: true, force: true })
})
afterEach(() => {
	process.env = { ...SAVED }
})
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }))

describe('anonymous install identity shared by CLI and MCP', () => {
	it.each(['DO_NOT_TRACK', 'EXTENSHI_TELEMETRY'])(
		'does not create an identity when %s opts out',
		async (name) => {
			process.env[name] = name === 'DO_NOT_TRACK' ? '1' : 'off'
			const telemetry = await import('./telemetry.js')
			expect(telemetry.telemetryAnonymousId()).toBeUndefined()
			telemetry.captureEvent('test')
			expect(fs.existsSync(CONFIG)).toBe(false)
			expect(capture).not.toHaveBeenCalled()
		},
	)

	it('keeps the persisted anonymous ID and never links it to the API key', async () => {
		fs.mkdirSync(path.dirname(CONFIG), { recursive: true })
		fs.writeFileSync(CONFIG, JSON.stringify({ anonId: INSTALL, apiKey: 'private-key' }))
		const telemetry = await import('./telemetry.js')
		expect(telemetry.telemetryAnonymousId()).toBe(INSTALL)
		telemetry.captureEvent('test')
		expect(capture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: INSTALL }))
		expect(JSON.stringify(capture.mock.calls)).not.toContain('private-key')
		expect(JSON.parse(fs.readFileSync(CONFIG, 'utf8'))).toEqual({ anonId: INSTALL, apiKey: 'private-key' })
	})

	it('persists one install ID across fresh module loads', async () => {
		const initial = (await import('./telemetry.js')).telemetryAnonymousId()
		expect(initial).toMatch(/^[0-9a-f-]{36}$/)
		vi.resetModules()
		expect((await import('./telemetry.js')).telemetryAnonymousId()).toBe(initial)
	})

	it('honors config opt-out without minting an anonId', async () => {
		fs.mkdirSync(path.dirname(CONFIG), { recursive: true })
		fs.writeFileSync(CONFIG, JSON.stringify({ telemetry: false }))
		expect((await import('./telemetry.js')).telemetryAnonymousId()).toBeUndefined()
		expect(JSON.parse(fs.readFileSync(CONFIG, 'utf8'))).toEqual({ telemetry: false })
	})

	it('attributes remote errors to the account without changing the install identity', async () => {
		fs.mkdirSync(path.dirname(CONFIG), { recursive: true })
		fs.writeFileSync(CONFIG, JSON.stringify({ anonId: INSTALL }))
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
