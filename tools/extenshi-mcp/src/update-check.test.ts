import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	checkForUpdate,
	isNewerVersion,
	knownUpdate,
	updateCheckOptedOut,
	updateMessage,
} from './update-check.js'

describe('isNewerVersion', () => {
	it('detects a strictly newer version', () => {
		expect(isNewerVersion('0.1.2', '0.1.3')).toBe(true)
		expect(isNewerVersion('0.1.2', '0.2.0')).toBe(true)
		expect(isNewerVersion('0.9.9', '1.0.0')).toBe(true)
	})
	it('returns false for same or older', () => {
		expect(isNewerVersion('0.1.3', '0.1.3')).toBe(false)
		expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
		expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
	})
	it('never nags on garbage input', () => {
		expect(isNewerVersion('0.1.2', 'not-a-version')).toBe(false)
		expect(isNewerVersion('0.1.2', '')).toBe(false)
	})
})

describe('updateCheckOptedOut', () => {
	it('honours each opt-out switch', () => {
		expect(updateCheckOptedOut({ EXTENSHI_NO_UPDATE_CHECK: '1' })).toBe(true)
		expect(updateCheckOptedOut({ DO_NOT_TRACK: '1' })).toBe(true)
		expect(updateCheckOptedOut({ EXTENSHI_TELEMETRY: '0' })).toBe(true)
		expect(updateCheckOptedOut({ CI: 'true' })).toBe(true)
		expect(updateCheckOptedOut({})).toBe(false)
	})
})

describe('checkForUpdate', () => {
	// The CI runner sets CI=true, which is a real opt-out switch — clear all the
	// opt-out env vars so these tests exercise the fetch path itself, not the gate.
	beforeEach(() => {
		for (const k of ['CI', 'DO_NOT_TRACK', 'EXTENSHI_TELEMETRY', 'EXTENSHI_NO_UPDATE_CHECK']) {
			vi.stubEnv(k, '')
		}
	})
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('writes a hint to the sink when npm reports a newer version', async () => {
		const out = vi.fn()
		const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '9.9.9' }) })
		await checkForUpdate('0.1.3', fetchImpl as unknown as typeof fetch, out)
		expect(out).toHaveBeenCalledOnce()
		expect(out.mock.calls[0][0]).toContain('0.1.3 → 9.9.9')
	})

	it('stays silent when already current', async () => {
		const out = vi.fn()
		const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.1.3' }) })
		await checkForUpdate('0.1.3', fetchImpl as unknown as typeof fetch, out)
		expect(out).not.toHaveBeenCalled()
	})

	it('never throws on a network error', async () => {
		const out = vi.fn()
		const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
		await expect(checkForUpdate('0.1.3', fetchImpl as unknown as typeof fetch, out)).resolves.toBeUndefined()
		expect(out).not.toHaveBeenCalled()
	})

	it('stays silent on a non-OK response', async () => {
		const out = vi.fn()
		const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
		await checkForUpdate('0.1.3', fetchImpl as unknown as typeof fetch, out)
		expect(out).not.toHaveBeenCalled()
	})

	it('message names both update paths', () => {
		const m = updateMessage('0.1.2', '0.1.3')
		expect(m).toContain('npx -y @extenshi/mcp@latest')
		expect(m).toContain('npm i -g @extenshi/mcp@latest')
	})
})

describe('knownUpdate', () => {
	it('remembers what the check found, so connection_diagnostics can tell the agent', async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ version: '9.0.0' }), { status: 200 })) as typeof fetch
		const previous = process.env.CI
		delete process.env.CI
		try {
			await checkForUpdate('1.0.0', fetchImpl, () => {})
		} finally {
			if (previous !== undefined) process.env.CI = previous
		}
		expect(knownUpdate()).toMatchObject({ version: '1.0.0', latestVersion: '9.0.0', updateAvailable: true })
	})
})
