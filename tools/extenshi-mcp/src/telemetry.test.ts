import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyError, flagsFromArgv, redactText, telemetryEnabled } from './telemetry.js'

const SAVED = { ...process.env }

beforeEach(() => {
	process.env = { ...SAVED }
	delete process.env.DO_NOT_TRACK
	delete process.env.EXTENSHI_TELEMETRY
	delete process.env.CI
})

afterEach(() => {
	process.env = { ...SAVED }
})

describe('telemetryEnabled — environment switches', () => {
	// Whether a SAVED answer turns reporting on is covered in
	// telemetry-identity.test.ts, which runs against a throwaway home directory.
	// These read no config: each variable below decides before the file is opened.
	it('is switched on by an explicit EXTENSHI_TELEMETRY=1 / true / on / yes', () => {
		process.env.EXTENSHI_POSTHOG_KEY = 'phc_test'
		for (const v of ['1', 'true', 'on', 'yes', ' ON ']) {
			process.env.EXTENSHI_TELEMETRY = v
			expect(telemetryEnabled()).toBe(true)
		}
	})

	it('honors DO_NOT_TRACK=1, also over an explicit EXTENSHI_TELEMETRY=1', () => {
		process.env.EXTENSHI_POSTHOG_KEY = 'phc_test'
		process.env.DO_NOT_TRACK = '1'
		expect(telemetryEnabled()).toBe(false)
		process.env.EXTENSHI_TELEMETRY = '1'
		expect(telemetryEnabled()).toBe(false)
	})

	it('honors EXTENSHI_TELEMETRY=0 / false / off', () => {
		process.env.EXTENSHI_POSTHOG_KEY = 'phc_test'
		for (const v of ['0', 'false', 'off', 'no']) {
			process.env.EXTENSHI_TELEMETRY = v
			expect(telemetryEnabled()).toBe(false)
		}
	})

	it('stays off with the key emptied, whatever else is set', () => {
		process.env.EXTENSHI_POSTHOG_KEY = ''
		process.env.EXTENSHI_TELEMETRY = '1'
		expect(telemetryEnabled()).toBe(false)
	})
})

describe('classifyError (MCP ScanError carries a numeric status)', () => {
	it('maps a numeric status', () => {
		expect(classifyError({ status: 401 })).toBe('auth')
		expect(classifyError({ status: 402 })).toBe('quota')
		expect(classifyError({ status: 429 })).toBe('rate_limit')
		expect(classifyError({ status: 503 })).toBe('api_5xx')
		expect(classifyError({ status: 422 })).toBe('api_4xx')
	})

	it('falls back to message patterns', () => {
		expect(classifyError(new Error('fetch failed'))).toBe('network')
		expect(classifyError(new Error('something weird'))).toBe('unexpected')
	})
})

// Every catalog BFF read arrives as a TRPCClientError, which carries its status
// at `data.httpStatus` and has NO top-level `status`. Reading only `status` left
// the whole read path to message heuristics.
describe('classifyError (tRPC client errors carry data.httpStatus)', () => {
	/** The shape @trpc/client exposes on TRPCClientError (default errorFormatter). */
	function trpcError(message: string, httpStatus: number): Error {
		return Object.assign(new Error(message), { data: { code: 'X', httpStatus } })
	}

	it('maps data.httpStatus', () => {
		expect(classifyError(trpcError('nope', 401))).toBe('auth')
		expect(classifyError(trpcError('nope', 429))).toBe('rate_limit')
		expect(classifyError(trpcError('boom', 500))).toBe('api_5xx')
	})

	it('classifies the free-read gate as quota, not unexpected', () => {
		// Verbatim from catalog-bff routers/_app.ts — it matches none of the
		// credit/quota wordings, which is why `allowance exhausted` is a pattern.
		const gate = 'Free read allowance exhausted (25/mo). Buy a read pack at https://dojo.extenshi.io/billing'
		expect(classifyError(new Error(gate))).toBe('quota')
	})
})

// readError()/the docs+scan handlers re-throw failures wrapped in a UserError so
// fastmcp can render them; the wrapper's own message carries no status, so the
// classifier has to look through to the origin.
describe('classifyError (follows the cause chain)', () => {
	it('classifies the cause when the wrapper itself is unclassifiable', () => {
		const wrapper = Object.assign(new Error('rendered for the user'), {
			cause: Object.assign(new Error('boom'), { data: { httpStatus: 500 } }),
		})
		expect(classifyError(wrapper)).toBe('api_5xx')
	})

	it('prefers the wrapper when it classifies on its own', () => {
		const wrapper = Object.assign(new Error('fetch failed'), { cause: { status: 500 } })
		expect(classifyError(wrapper)).toBe('network')
	})

	it('does not hang on a self-referential or cyclic cause', () => {
		const a = new Error('a') as Error & { cause?: unknown }
		const b = new Error('b') as Error & { cause?: unknown }
		a.cause = a
		expect(classifyError(a)).toBe('unexpected')
		b.cause = a
		a.cause = b
		expect(classifyError(b)).toBe('unexpected')
	})
})

describe('flagsFromArgv', () => {
	it('never leaks flag values', () => {
		expect(flagsFromArgv(['--api-url', 'https://secret/y', '--json'])).toEqual(['--api-url', '--json'])
	})
})

describe('redactText', () => {
	it('strips absolute home paths', () => {
		const home = os.homedir()
		expect(redactText(`oops ${home}/proj`)).not.toContain(home)
		expect(redactText('at /Users/alice/x and /home/bob/y')).toBe('at ~/x and ~/y')
	})
})
