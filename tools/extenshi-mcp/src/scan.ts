/**
 * Scan an extension artifact against the Extenshi scan backend and RETURN the
 * report (no printing) — the MCP-friendly counterpart to the CLI's `runScan`.
 *
 * It replicates the exact request `@extenshi/cli` makes
 * (`POST {scanUrl}/api/v1/scan`, multipart `apiKey` + `artifact` + optional
 * `extensionId`, SSE progress, 240s timeout, server-side credit
 * consume→commit→refund) so the MCP `scan_extension` tool and the CLI bill and
 * behave identically. The network + SSE logic is vendored (not imported) to
 * keep this package independently publishable — npm rejects `workspace:*`.
 *
 * Errors surface as `ScanError` carrying the HTTP status + machine `errorCode`
 * so the caller can render the right next-step instruction.
 */

import fs from 'node:fs'
import path from 'node:path'
import { FormData, fetch, type Response } from 'undici'
import { parseSseFrames, type SseEvent } from './sse.js'
import { assertValidArtifact } from './validate-artifact.js'

const SCAN_TIMEOUT_MS = 240_000
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024

export interface ScanProgress {
	stage?: string
	scanner?: string | null
	completed?: number
	total?: number | null
	pct?: number
}

export interface ScanArtifactOptions {
	artifactPath: string
	apiKey: string
	/** Scan backend base URL, no trailing slash (e.g. https://scan.extenshi.io). */
	scanUrl: string
	/** Numeric catalog ID — required to spend a FREE credit on an unverified extension. */
	extensionId?: string
	/** Called for each upstream progress event so the caller can stream it. */
	onProgress?: (p: ScanProgress) => void
}

/** A scan failure that carries the HTTP status and the backend's machine code. */
export class ScanError extends Error {
	status?: number
	errorCode?: string
	retryAfterSec?: number

	constructor(message: string, opts: { status?: number; errorCode?: string; retryAfterSec?: number } = {}) {
		super(message)
		this.name = 'ScanError'
		this.status = opts.status
		this.errorCode = opts.errorCode
		this.retryAfterSec = opts.retryAfterSec
	}
}

export type ScanReport = Record<string, unknown>

/**
 * Why a parsed scan response is not a usable report, or null when it is. The
 * backend has already committed the credit by the time a result arrives, so an
 * unusable body must surface as an error naming the job — never as an empty
 * success the caller cannot tell apart from a clean scan.
 */
export function scanReportProblem(report: unknown): string | null {
	if (!report || typeof report !== 'object' || Array.isArray(report))
		return 'the scan returned no report object'
	const r = report as Record<string, unknown>
	if (!Array.isArray(r.scanners)) {
		const job = typeof r.jobId === 'string' ? ` (job ${r.jobId})` : ''
		return `the scan result${job} has no scanner results`
	}
	return null
}

function assertScanReport(report: unknown): ScanReport {
	const problem = scanReportProblem(report)
	if (problem) {
		throw new ScanError(
			`Scan finished but ${problem}. If a scan credit was charged, keep the job id and re-run with ` +
				'`npx @extenshi/cli@latest scan <artifact> --format json`, which reads the same backend.',
		)
	}
	return report as ScanReport
}

export async function scanArtifact(opts: ScanArtifactOptions): Promise<ScanReport> {
	const { artifactPath, apiKey, scanUrl, extensionId, onProgress } = opts

	if (!fs.existsSync(artifactPath)) {
		throw new ScanError(`Artifact file not found: ${artifactPath}`)
	}
	const stats = fs.statSync(artifactPath)
	if (!stats.isFile()) {
		throw new ScanError(`Artifact path is not a file: ${artifactPath}`)
	}
	if (stats.size > MAX_ARTIFACT_BYTES) {
		throw new ScanError(`Artifact exceeds 50 MB limit (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
	}

	// Refuse non-extension files (executables, scripts, …) before uploading.
	try {
		assertValidArtifact(artifactPath)
	} catch (err) {
		throw new ScanError(err instanceof Error ? err.message : String(err))
	}

	const form = new FormData()
	form.append('apiKey', apiKey)
	form.append('artifact', new File([fs.readFileSync(artifactPath)], path.basename(artifactPath)))
	if (extensionId) form.append('extensionId', extensionId)

	let response: Response
	try {
		response = await fetch(`${scanUrl}/api/v1/scan`, {
			method: 'POST',
			body: form,
			headers: { accept: 'text/event-stream' },
			signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
		})
	} catch (err) {
		if (err instanceof Error && err.name === 'TimeoutError') {
			throw new ScanError(
				`Scan timed out after ${SCAN_TIMEOUT_MS / 1000}s. If a credit was charged it auto-refunds within 1 minute — do NOT retry immediately.`,
			)
		}
		throw err
	}

	// Auth/billing/gateway errors are always JSON and arrive before any stream.
	if (!response.ok) {
		const body = await parseJsonBody(response)
		throw errorForStatus(response.status, body)
	}

	const contentType = response.headers.get('content-type') ?? ''
	if (contentType.includes('text/event-stream')) {
		return assertScanReport(await consumeSseStream(response, onProgress))
	}

	// Legacy single-JSON mode (server ignored the Accept header).
	return assertScanReport(await parseJsonBody(response))
}

async function consumeSseStream(
	response: Response,
	onProgress?: (p: ScanProgress) => void,
): Promise<ScanReport> {
	if (!response.body) throw new ScanError('Scan stream had no response body')

	const decoder = new TextDecoder()
	let buffer = ''
	let report: ScanReport | null = null
	let errorMessage: string | null = null

	const handle = (ev: SseEvent): void => {
		if (ev.event === 'progress') {
			const p = safeJson(ev.data)
			if (p && onProgress) onProgress(p as ScanProgress)
		} else if (ev.event === 'result') {
			report = safeJson(ev.data)
		} else if (ev.event === 'error') {
			const e = safeJson(ev.data)
			errorMessage = e && typeof e.error === 'string' ? e.error : 'scan failed'
		}
	}

	for await (const chunk of response.body) {
		buffer += decoder.decode(chunk as Uint8Array, { stream: true })
		const { events, rest } = parseSseFrames(buffer)
		buffer = rest
		for (const ev of events) handle(ev)
	}
	// Flush a trailing frame not terminated by a blank line.
	const { events } = parseSseFrames(`${buffer}\n\n`)
	for (const ev of events) handle(ev)

	if (errorMessage) throw new ScanError(`Scan failed: ${errorMessage}`)
	if (!report) throw new ScanError('Scan stream ended before returning a result')
	return report
}

function safeJson(data: string): Record<string, unknown> | null {
	try {
		return JSON.parse(data) as Record<string, unknown>
	} catch {
		return null
	}
}

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
	const raw = await response.text()
	try {
		return JSON.parse(raw) as Record<string, unknown>
	} catch {
		const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
		throw new ScanError(
			`Scan backend returned a non-JSON response (HTTP ${response.status}). ${snippet ? `Response: ${snippet}` : ''}`.trim(),
			{ status: response.status },
		)
	}
}

function errorForStatus(status: number, body: Record<string, unknown>): ScanError {
	const message = typeof body.error === 'string' ? body.error : `HTTP ${status}`
	const errorCode = typeof body.errorCode === 'string' ? body.errorCode : undefined
	const retryAfterSec =
		typeof (body as { retryAfterSec?: number }).retryAfterSec === 'number'
			? (body as { retryAfterSec: number }).retryAfterSec
			: undefined
	return new ScanError(message, { status, errorCode, retryAfterSec })
}
