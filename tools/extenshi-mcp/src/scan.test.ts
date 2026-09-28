import fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ScanError, scanArtifact, scanReportProblem } from './scan.js'

/** Stub scan API: each test sets how POST /api/v1/scan answers. */
let respond: (res: import('node:http').ServerResponse) => void
let server: Server
let scanUrl: string
let artifact: string

const REPORT = {
	jobId: '02fa3373-6ad9-4d25-b82a-daf9334c8b3e',
	scanners: Array.from({ length: 8 }, (_, i) => ({
		scanner_name: `s${i}`,
		status: 'completed',
		findings: [],
	})),
	compliance: { verdict: 'pass' },
	permissionUsage: [],
	listing: {},
}

const sse = (frames: string[]) => (res: import('node:http').ServerResponse) => {
	res.writeHead(200, { 'content-type': 'text/event-stream' })
	for (const frame of frames) res.write(frame)
	res.end()
}

beforeAll(async () => {
	server = createServer((req, res) => {
		req.resume()
		req.on('end', () => respond(res))
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	scanUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	artifact = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scan-')), 'deploy.zip')
	fs.writeFileSync(artifact, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(() => {
	respond = (res) => res.end()
})

const scan = (onProgress?: (p: unknown) => void) =>
	scanArtifact({ artifactPath: artifact, apiKey: 'ek_test', scanUrl, onProgress })

describe('scanArtifact against a stubbed scan API', () => {
	it('returns the SSE result event as the report, with progress along the way', async () => {
		const progress: unknown[] = []
		respond = sse([
			'event: progress\ndata: {"completed":1,"total":8}\n\n',
			`event: result\ndata: ${JSON.stringify(REPORT)}\n\n`,
		])
		expect(await scan((p) => progress.push(p))).toEqual(REPORT)
		expect(progress).toEqual([{ completed: 1, total: 8 }])
	})

	it('parses a result frame split across chunks and not terminated by a blank line', async () => {
		const body = JSON.stringify(REPORT)
		respond = sse(['event: result\n', `data: ${body.slice(0, 40)}`, body.slice(40)])
		expect(await scan()).toEqual(REPORT)
	})

	it('accepts the legacy single-JSON response', async () => {
		respond = (res) => {
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify(REPORT))
		}
		expect(await scan()).toEqual(REPORT)
	})

	it('errors (naming the job) instead of returning an empty success', async () => {
		respond = sse(['event: result\ndata: {"jobId":"j-1"}\n\n'])
		await expect(scan()).rejects.toThrow(/job j-1\) has no scanner results/)
		respond = sse(['event: progress\ndata: {"completed":8,"total":8}\n\n'])
		await expect(scan()).rejects.toThrow(/ended before returning a result/)
		respond = sse(['event: error\ndata: {"error":"scanner pool down"}\n\n'])
		await expect(scan()).rejects.toThrow(/scanner pool down/)
	})

	it('surfaces a billing error with its status', async () => {
		respond = (res) => {
			res.writeHead(402, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ error: 'Insufficient credits', errorCode: 'NO_CREDITS' }))
		}
		const err = await scan().catch((e) => e)
		expect(err).toBeInstanceOf(ScanError)
		expect(err).toMatchObject({ status: 402, errorCode: 'NO_CREDITS' })
	})
})

describe('scanReportProblem', () => {
	it('accepts a report with scanner results and rejects everything else', () => {
		expect(scanReportProblem(REPORT)).toBeNull()
		expect(scanReportProblem({ scanners: [] })).toBeNull()
		for (const bad of [null, [], 'x', {}, { snapshots: [] }]) expect(scanReportProblem(bad)).not.toBeNull()
	})
})
