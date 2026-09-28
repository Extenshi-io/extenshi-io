/**
 * Capability-gating contract for the shared tool registry.
 *
 * This is a SECURITY guard, not a nicety: the remote OAuth connector must
 * expose ONLY the read/research/docs tools. `scan_extension` and
 * `publish_extension` require the caller's local filesystem / store credentials
 * and must never be reachable over a hosted transport. If a future edit lets
 * those leak into the remote capability set, this test fails.
 * See internal-docs/plans/2026-06-25-claude-connector-directory.md §13 #1.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { UserError } from 'fastmcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bff } from './bff.js'
import { scanArtifact } from './scan.js'
import { captureError, captureEvent } from './telemetry.js'
import {
	type Capability,
	isExpectedError,
	MAX_BATCH_EXTENSIONS,
	registerTools,
	type ToolDeps,
} from './tools.js'

// The `instrument` wrapper fires telemetry on every execute; stub the capture
// sinks so the execute-level tests below never spin up a real PostHog client.
// `classifyError` is deliberately NOT stubbed: it decides which failures count
// as expected, so stubbing it would leave these tests asserting against a mock
// instead of the real expected-vs-fault boundary.
vi.mock('./telemetry.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./telemetry.js')>()),
	captureEvent: vi.fn(),
	captureError: vi.fn(),
}))

// Stub the real scan network call so scan_extension tests never hit the backend;
// `ScanError` is preserved (tools.ts imports + instanceof-checks it) via importOriginal.
vi.mock('./scan.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./scan.js')>()),
	scanArtifact: vi.fn(),
}))
const mockedScanArtifact = vi.mocked(scanArtifact)

interface RecordedTool {
	name: string
	annotations?: {
		title?: string
		readOnlyHint?: boolean
		destructiveHint?: boolean
		idempotentHint?: boolean
		openWorldHint?: boolean
	}
}

/** Minimal FastMCP stand-in that records the registered tools (name + annotations). */
function recordingServer(): {
	names: string[]
	tools: RecordedTool[]
	server: Parameters<typeof registerTools>[0]
} {
	const tools: RecordedTool[] = []
	const names: string[] = []
	// Only `addTool` is exercised at registration time. `names` and `tools` are
	// stable array references mutated in place, so callers can destructure either.
	const server = {
		addTool: (t: RecordedTool) => {
			tools.push(t)
			names.push(t.name)
		},
	}
	return { names, tools, server: server as unknown as Parameters<typeof registerTools>[0] }
}

const noopBff = {} as Bff

function depsFor(capabilities: Capability[]): ToolDeps {
	return {
		cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
		capabilities: new Set(capabilities),
		getBff: () => noopBff,
		requireApiKey: () => 'ek_test',
		getApiKey: () => 'ek_test',
	}
}

const READ_TOOLS = [
	'list_pay_apps',
	'create_pay_app',
	'get_pay_app',
	'get_pay_readiness',
	'link_pay_app',
	'unlink_pay_app',
	'archive_pay_app',
	'export_pay_data',
	'get_pay_seller',
	'connect_pay_seller',
	'refresh_pay_seller',
	'set_pay_seller_profile',
	'upsert_pay_offer',
	'archive_pay_offer',
	'set_pay_enabled',
	'rotate_pay_key',

	'import_manifest',
	'get_project_workspace',
	'get_release_readiness',
	'connection_diagnostics',
	'diff_project_state',
	'apply_project_patch',
	'record_project_evidence',
	'create_ci_ingest_secret',
	'upsert_hosted_page',
	'verify_hosted_artifact',
	'remove_hosted_page',
	'list_hosted_pages',
	'search_extensions',
	'get_extension',
	'get_reviews',
	'get_security',
	'get_risk_by_store_ids',
	'market_overview',
	'get_credit_balance',
	// The developer's OWN projects: keyed like the catalog reads, but free —
	// credits pay for data about other people's extensions, not for your own work.
	'list_my_projects',
	'get_project_state',
	'get_project_scaffold',
	'list_privacy_policy_versions',
	'get_privacy_policy_version',
	'publish_privacy_policy',
	'update_privacy_policy_with_ai',
]
const DOCS_TOOLS = [
	'get_development_guide',
	'search_docs',
	'list_extension_templates',
	'generate_icon_workflow',
	'localize_workflow',
	'generate_welcome_page_workflow',
]
const LOCAL_ONLY_TOOLS = ['scan_extension', 'publish_extension']

describe('registerTools capability gating', () => {
	it('stdio (all capabilities) registers all registered tools', () => {
		const { names, server } = recordingServer()
		registerTools(server, depsFor(['read', 'docs', 'scan', 'publish']))
		expect(names.sort()).toEqual([...READ_TOOLS, ...DOCS_TOOLS, ...LOCAL_ONLY_TOOLS].sort())
		expect(names).toHaveLength(READ_TOOLS.length + DOCS_TOOLS.length + LOCAL_ONLY_TOOLS.length)
	})

	it('remote (read + docs only) registers the 19 hosted tools and NO local-only tools', () => {
		const { names, server } = recordingServer()
		registerTools(server, depsFor(['read', 'docs']))
		expect(names.sort()).toEqual([...READ_TOOLS, ...DOCS_TOOLS].sort())
		// The security-critical assertion: scan/publish are absent.
		for (const forbidden of LOCAL_ONLY_TOOLS) {
			expect(names).not.toContain(forbidden)
		}
	})

	it('docs-only registers just the keyless free tools', () => {
		const { names, server } = recordingServer()
		registerTools(server, depsFor(['docs']))
		expect(names.sort()).toEqual([...DOCS_TOOLS].sort())
	})

	it('read capability does not pull in docs tools or local-only tools', () => {
		const { names, server } = recordingServer()
		registerTools(server, depsFor(['read']))
		expect(names.sort()).toEqual([...READ_TOOLS].sort())
		expect(names).not.toContain('search_docs')
		expect(names).not.toContain('generate_icon_workflow')
		expect(names).not.toContain('scan_extension')
	})

	it('empty capability set registers nothing', () => {
		const { names, server } = recordingServer()
		registerTools(server, depsFor([]))
		expect(names).toEqual([])
	})
})

describe('get_reviews execute — arg mapping', () => {
	it('maps snake_case tool args to the BFF camelCase input', async () => {
		// Capture the full tool objects (not just names) so we can drive execute().
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}

		const calls: Record<string, unknown>[] = []
		const stubBff = {
			getReviews: (input: Record<string, unknown>) => {
				calls.push(input)
				return Promise.resolve({ items: [], nextCursor: null })
			},
		} as unknown as Bff

		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})

		// Raw snake_case args as FastMCP would pass post-Zod-parse.
		await tools.get_reviews.execute(
			{ extension_id: 77, limit: 10, cursor: 5, language_id: 3, min_rating: 4, sort: 'rating' },
			{},
		)

		expect(calls).toHaveLength(1)
		expect(calls[0]).toEqual({
			extensionId: 77,
			limit: 10,
			cursor: 5,
			languageId: 3,
			minRating: 4,
			sort: 'rating',
		})
	})

	it('applies the per-store content policy end-to-end (Chrome text withheld)', async () => {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		const stubBff = {
			getReviews: () =>
				Promise.resolve({
					items: [
						{
							rating: 5,
							content: 'SECRET CHROME REVIEW BODY',
							store: 'CHROME',
							storeUrl: 'https://chromewebstore.google.com/detail/abc',
							contentPolicy: 'rating-only',
						},
					],
					nextCursor: null,
					aggregate: { rating: 4.6, ratingCount: 10, storeReviewsUrl: 'x/reviews' },
				}),
		} as unknown as Bff

		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})

		const rendered: string = await tools.get_reviews.execute({ extension_id: 1, limit: 20 }, {})
		// The Chrome review body must never reach the model context.
		expect(rendered).not.toContain('SECRET CHROME REVIEW BODY')
		// …but the reviews-tab link + aggregate DO surface.
		expect(rendered).toContain('review text is not republished')
		expect(rendered).toContain('aggregate')
	})

	it('defaults sort to recent when omitted', async () => {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		const calls: Record<string, unknown>[] = []
		const stubBff = {
			getReviews: (input: Record<string, unknown>) => {
				calls.push(input)
				return Promise.resolve({ items: [], nextCursor: null })
			},
		} as unknown as Bff

		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})

		await tools.get_reviews.execute({ extension_id: 77, limit: 20 }, {})

		expect(calls[0]).toMatchObject({ extensionId: 77, sort: 'recent' })
	})
})

/** Register the read tools against a stub BFF and return them keyed by name. */
function readToolsWith(stubBff: Partial<Bff>): Record<string, any> {
	const tools: Record<string, any> = {}
	const server = {
		addTool: (t: { name: string }) => {
			tools[t.name] = t
		},
	}
	registerTools(server as unknown as Parameters<typeof registerTools>[0], {
		cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
		capabilities: new Set<Capability>(['read']),
		getBff: () => stubBff as Bff,
	})
	return tools
}

describe('get_credit_balance execute', () => {
	it('returns every pool from the FREE balance endpoint verbatim', async () => {
		const balance = {
			read: { remaining: 42, freeRemaining: 3, freeGranted: 10, freeUsed: 7 },
			scan: { remaining: 5, freeRemaining: 0, freeGranted: 3, freeUsed: 3 },
			// icon/inventory report total spendable (purchased + free), consistent with
			// the BFF invariant freeRemaining ≤ remaining — never freeRemaining > remaining.
			icon: { remaining: 6, freeRemaining: 2, freeGranted: 2, freeUsed: 0 },
			inventory: { remaining: 1, freeRemaining: 1, freeGranted: 1, freeUsed: 0 },
			billingUrl: 'https://dojo.extenshi.io/billing',
		}
		let called = 0
		const tools = readToolsWith({
			getApiCallerBalance: () => {
				called++
				return Promise.resolve(balance)
			},
		})

		const out: string = await tools.get_credit_balance.execute({}, {})
		expect(called).toBe(1)
		expect(JSON.parse(out)).toEqual(balance)
	})
})

describe('extension reference resolution (extension_id | store_id)', () => {
	it('get_extension resolves a store_id to a catalog id via the FREE resolver', async () => {
		const resolveCalls: Array<Record<string, unknown>> = []
		let gotId: number | undefined
		const tools = readToolsWith({
			resolveExtensionRef: (input) => {
				resolveCalls.push(input)
				return Promise.resolve({ id: 42, store: 'CHROME' })
			},
			getExtensionById: (id: number) => {
				gotId = id
				return Promise.resolve(null) // triggers the authored "no extension" message below
			},
		})

		// store_id + explicit store → one resolve call, then the read uses the resolved id.
		await expect(
			tools.get_extension.execute({ store_id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', store: 'CHROME' }, {}),
		).rejects.toThrow('42')
		expect(resolveCalls).toEqual([{ storeId: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', store: 'CHROME' }])
		expect(gotId).toBe(42)
	})

	it('get_security resolves a store_id ONCE and reuses it across its 3 metered calls', async () => {
		let resolveCount = 0
		const ids: number[] = []
		const capture = (id: number) => {
			ids.push(id)
			return Promise.resolve(null)
		}
		const tools = readToolsWith({
			resolveExtensionRef: () => {
				resolveCount++
				return Promise.resolve({ id: 88, store: 'FIREFOX' })
			},
			getSecurityData: capture,
			getRiskSummary: capture,
			getExtensionById: capture,
		})

		await tools.get_security.execute({ store_id: 'dark-reader' }, {})
		// Resolved once (not per-call), and all three metered reads use the resolved id.
		expect(resolveCount).toBe(1)
		expect(ids).toEqual([88, 88, 88])
	})

	it('get_reviews maps a resolved store_id into the BFF extensionId', async () => {
		const calls: Record<string, unknown>[] = []
		const tools = readToolsWith({
			resolveExtensionRef: () => Promise.resolve({ id: 99, store: 'FIREFOX' }),
			getReviews: (input: Record<string, unknown>) => {
				calls.push(input)
				return Promise.resolve({ items: [], nextCursor: null })
			},
		})

		await tools.get_reviews.execute({ store_id: 'dark-reader', limit: 20 }, {})
		expect(calls[0]).toMatchObject({ extensionId: 99, sort: 'recent' })
	})

	it('an explicit extension_id skips resolution entirely', async () => {
		let resolveCalled = false
		let gotId: number | undefined
		const tools = readToolsWith({
			resolveExtensionRef: () => {
				resolveCalled = true
				return Promise.resolve(null)
			},
			getExtensionById: (id: number) => {
				gotId = id
				return Promise.resolve(null)
			},
		})

		await expect(tools.get_extension.execute({ extension_id: 7 }, {})).rejects.toThrow('7')
		expect(resolveCalled).toBe(false)
		expect(gotId).toBe(7)
	})

	it('errors actionably when neither extension_id nor store_id is given', async () => {
		const tools = readToolsWith({
			getExtensionById: () => Promise.resolve({ id: 1 }),
		})
		await expect(tools.get_extension.execute({}, {})).rejects.toThrow(
			/extension_id.*store_id|store_id.*extension_id/s,
		)
	})

	it('surfaces a BAD_REQUEST (ambiguous Chrome/Edge id) as an actionable message', async () => {
		const tools = readToolsWith({
			resolveExtensionRef: () =>
				Promise.reject(
					Object.assign(new Error('has the Chrome/Edge id format … pass store: "CHROME" or store: "EDGE"'), {
						data: { code: 'BAD_REQUEST', httpStatus: 400 },
					}),
				),
		})
		await expect(
			tools.get_extension.execute({ store_id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm' }, {}),
		).rejects.toThrow(/CHROME.*EDGE/s)
	})
})

describe('scan_extension store-id association', () => {
	beforeEach(() => vi.clearAllMocks())

	/** Register just scan_extension (scan capability) against a stub BFF. */
	function scanToolWith(stubBff: Partial<Bff>): any {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['scan']),
			getBff: () => stubBff as Bff,
			requireApiKey: () => 'ek_test',
		})
		return tools.scan_extension
	}

	it('resolves a store_id and passes the catalog id as the scan association', async () => {
		mockedScanArtifact.mockResolvedValue({} as Awaited<ReturnType<typeof scanArtifact>>)
		const tool = scanToolWith({ resolveExtensionRef: () => Promise.resolve({ id: 55, store: 'CHROME' }) })

		await tool.execute(
			{ artifact_path: './x.zip', store_id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', store: 'CHROME' },
			{},
		)
		expect(mockedScanArtifact).toHaveBeenCalledTimes(1)
		// The resolved numeric id reaches the scan backend as a string association.
		expect(mockedScanArtifact.mock.calls[0][0]).toMatchObject({ extensionId: '55' })
	})

	it('fails fast on an ambiguous/unresolvable store_id WITHOUT spending a scan', async () => {
		const tool = scanToolWith({
			resolveExtensionRef: () =>
				Promise.reject(
					Object.assign(new Error('pass store: "CHROME" or store: "EDGE"'), {
						data: { code: 'BAD_REQUEST', httpStatus: 400 },
					}),
				),
		})

		await expect(
			tool.execute({ artifact_path: './x.zip', store_id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm' }, {}),
		).rejects.toThrow(/CHROME.*EDGE/s)
		// The critical invariant: no scan credit is spent when the id can't be resolved.
		expect(mockedScanArtifact).not.toHaveBeenCalled()
	})

	it('scans with no association when neither extension_id nor store_id is given', async () => {
		mockedScanArtifact.mockResolvedValue({} as Awaited<ReturnType<typeof scanArtifact>>)
		const tool = scanToolWith({})

		await tool.execute({ artifact_path: './x.zip' }, {})
		expect(mockedScanArtifact).toHaveBeenCalledTimes(1)
		expect(mockedScanArtifact.mock.calls[0][0].extensionId).toBeUndefined()
	})
})

// The Anthropic Connectors Directory submission portal auto-syncs the server's
// tools and refuses to submit any tool missing a `title` or a read/write hint.
// This contract guards that every tool ships those annotations, and that the
// read/write split is declared correctly.
describe('directory tool annotations', () => {
	it('every registered tool declares a title and a readOnlyHint', () => {
		const { tools, server } = recordingServer()
		registerTools(server, depsFor(['read', 'docs', 'scan', 'publish']))
		expect(tools).toHaveLength(READ_TOOLS.length + DOCS_TOOLS.length + LOCAL_ONLY_TOOLS.length)
		for (const t of tools) {
			expect(t.annotations?.title, `${t.name} title`).toBeTruthy()
			expect(typeof t.annotations?.readOnlyHint, `${t.name} readOnlyHint`).toBe('boolean')
		}
	})

	// The two static workflow guides are pure functions of their arguments: same
	// args → same text (idempotent), and they touch no network (closed world).
	// Pinned per-tool because adding a NEW entry to the annotation map is exactly
	// how the previous two hints got silently re-attributed away from
	// generate_icon_workflow — a `title` + `readOnlyHint` check did not notice.
	it.each([
		'get_development_guide',
		'generate_icon_workflow',
		'generate_welcome_page_workflow',
		'localize_workflow',
	])('%s declares the full static-guide annotation set', (name) => {
		const { tools, server } = recordingServer()
		registerTools(server, depsFor(['docs']))
		const tool = tools.find((t) => t.name === name)
		expect(tool, `${name} registered`).toBeTruthy()
		expect(tool?.annotations).toMatchObject({
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false,
		})
		expect(tool?.annotations?.title).toBeTruthy()
	})

	it('all remote-exposed (read + docs) tools are read-only except hosted-project writes', () => {
		const { tools, server } = recordingServer()
		registerTools(server, depsFor(['read', 'docs']))
		const hostedWrites = new Set([
			'create_pay_app',
			'link_pay_app',
			'unlink_pay_app',
			'archive_pay_app',
			'connect_pay_seller',
			'refresh_pay_seller',
			'set_pay_seller_profile',
			'upsert_pay_offer',
			'archive_pay_offer',
			'set_pay_enabled',
			'rotate_pay_key',

			'import_manifest',
			'publish_privacy_policy',
			'update_privacy_policy_with_ai',
			'apply_project_patch',
			'record_project_evidence',
			'create_ci_ingest_secret',
			'upsert_hosted_page',
			// Re-fetches and records the observed status server-side.
			'verify_hosted_artifact',
			'remove_hosted_page',
		])
		for (const t of tools) {
			if (hostedWrites.has(t.name)) {
				expect(t.annotations?.readOnlyHint, `${t.name} mutates the hosted policy`).toBe(false)
				continue
			}
			expect(t.annotations?.readOnlyHint, `${t.name} should be read-only`).toBe(true)
		}
	})

	it('publish is destructive and scan is a non-read-only write', () => {
		const { tools, server } = recordingServer()
		registerTools(server, depsFor(['scan', 'publish']))
		const publish = tools.find((t) => t.name === 'publish_extension')
		const scan = tools.find((t) => t.name === 'scan_extension')
		expect(publish?.annotations?.readOnlyHint).toBe(false)
		expect(publish?.annotations?.destructiveHint).toBe(true)
		expect(scan?.annotations?.readOnlyHint).toBe(false)
		expect(scan?.annotations?.destructiveHint).toBe(false)
	})
})

// The billing quota gate (and other expected, user-facing conditions) must NOT
// be shipped to error tracking as exceptions — otherwise a routine "free read
// allowance exhausted" message mints a bogus, self-reopening issue. The failure
// count still has to be tracked, so `mcp_tool_failed` must fire regardless.
//
// These run end-to-end through the real readError() + classifyError(): the whole
// question is what survives that wrapping, which a stub can't answer.
describe('instrument — expected errors skip exception capture', () => {
	// Cleared BEFORE each test, not after: the describe blocks above drive
	// execute() through the same instrumented spies, so these `not.toHaveBeenCalled`
	// assertions would otherwise depend on what ran earlier in the file.
	beforeEach(() => vi.clearAllMocks())

	/**
	 * A `get_reviews` tool whose BFF call rejects with `err`. Any read tool would
	 * do — they all funnel through the same readError() — but get_reviews is a
	 * metered read, so it is the one that actually hits the free-allowance gate
	 * being reproduced here.
	 */
	function getReviewsToolRejectingWith(err: unknown): {
		execute: (a: unknown, c: unknown) => Promise<unknown>
	} {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		const stubBff = {
			getReviews: () => Promise.reject(err),
		} as unknown as Bff
		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})
		return tools.get_reviews
	}

	/** How the catalog BFF's free-read gate reaches the client: TRPCClientError, HTTP 429. */
	const quotaGate = () =>
		Object.assign(
			new Error(
				'Free read allowance exhausted (10, one-time). Buy a read pack at https://dojo.extenshi.io/billing to continue.',
			),
			{ data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 } },
		)

	it('a quota gate fires mcp_tool_failed but is NOT captured as an exception', async () => {
		// The exact reported scenario: a metered read hits the free-allowance gate.
		const tool = getReviewsToolRejectingWith(quotaGate())
		await expect(tool.execute({ extension_id: 1, limit: 20 }, {})).rejects.toBeInstanceOf(UserError)

		expect(captureError).not.toHaveBeenCalled()
		// Third arg is the distinct_id override: undefined here because these
		// tools execute with no session, i.e. the local stdio surface, which stays
		// on the per-install anonymous id.
		expect(captureEvent).toHaveBeenCalledWith(
			'mcp_tool_failed',
			expect.objectContaining({ tool: 'get_reviews', error_kind: 'quota' }),
			undefined,
		)
	})

	// The regression the `cause` plumbing exists to prevent: readError() wraps a
	// genuine fault in a UserError too, so without the origin these would read as
	// "expected" and silently stop reaching error tracking.
	it('a BFF 5xx behind the same UserError IS captured as an exception', async () => {
		const tool = getReviewsToolRejectingWith(
			Object.assign(new Error('Internal server error'), {
				data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
			}),
		)
		await expect(tool.execute({ extension_id: 1, limit: 20 }, {})).rejects.toBeInstanceOf(UserError)

		expect(captureError).toHaveBeenCalledWith(expect.any(Error), { tool: 'get_reviews' })
		expect(captureEvent).toHaveBeenCalledWith(
			'mcp_tool_failed',
			expect.objectContaining({ tool: 'get_reviews', error_kind: 'api_5xx' }),
			undefined,
		)
	})

	it('an unexpected fault inside a read handler IS captured as an exception', async () => {
		const tool = getReviewsToolRejectingWith(new TypeError('x.map is not a function'))
		await expect(tool.execute({ extension_id: 1, limit: 20 }, {})).rejects.toBeInstanceOf(UserError)

		expect(captureError).toHaveBeenCalledWith(expect.any(Error), { tool: 'get_reviews' })
	})
})

// Who made the call. The hosted connector is ONE process serving many accounts,
// so without this every user of the service collapses into the single per-install
// anonymous id — and that id is re-minted whenever the container is replaced.
describe('instrument — per-call attribution from the session', () => {
	beforeEach(() => vi.clearAllMocks())

	/** A get_reviews tool whose BFF call succeeds, so the success path is exercised. */
	function getReviewsToolResolving(): { execute: (a: unknown, c: unknown) => Promise<unknown> } {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		const stubBff = { getReviews: () => Promise.resolve({ reviews: [] }) } as unknown as Bff
		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})
		return tools.get_reviews
	}

	/** Same shape, but the BFF call rejects — for the failure-path assertion. */
	function getReviewsToolRejecting(err: unknown): {
		execute: (a: unknown, c: unknown) => Promise<unknown>
	} {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		const stubBff = { getReviews: () => Promise.reject(err) } as unknown as Bff
		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})
		return tools.get_reviews
	}

	const remote = { userId: 'usr_42', sessionId: 'conn-abc', email: 'someone@example.com' }

	it('reports the account id as the distinct_id and threads the connection', async () => {
		const tool = getReviewsToolResolving()
		await tool.execute({ extension_id: 1, limit: 20 }, { session: remote })

		for (const event of ['mcp_tool_called', 'mcp_tool_succeeded']) {
			expect(captureEvent).toHaveBeenCalledWith(
				event,
				expect.objectContaining({ tool: 'get_reviews', mcp_session_id: 'conn-abc' }),
				'usr_42',
			)
		}
	})

	it('sends nothing when the connection declined usage analytics', async () => {
		await getReviewsToolResolving().execute(
			{ extension_id: 1, limit: 20 },
			{ session: { ...remote, telemetry: false } },
		)
		await expect(
			getReviewsToolRejecting(new Error('boom')).execute(
				{ extension_id: 1, limit: 20 },
				{ session: { ...remote, telemetry: false } },
			),
		).rejects.toThrow()
		expect(captureEvent).not.toHaveBeenCalled()
		expect(captureError).not.toHaveBeenCalled()
	})

	it('never reports the email — it stays in our own database', async () => {
		const tool = getReviewsToolResolving()
		await tool.execute({ extension_id: 1, limit: 20 }, { session: remote })

		const everything = JSON.stringify((captureEvent as unknown as { mock: { calls: unknown[] } }).mock.calls)
		expect(everything).not.toContain('someone@example.com')
	})

	it('carries the attribution onto failures too', async () => {
		const tool = getReviewsToolRejecting(new TypeError('x.map is not a function'))
		await expect(tool.execute({ extension_id: 1, limit: 20 }, { session: remote })).rejects.toBeInstanceOf(
			UserError,
		)

		expect(captureEvent).toHaveBeenCalledWith(
			'mcp_tool_failed',
			expect.objectContaining({ tool: 'get_reviews', mcp_session_id: 'conn-abc' }),
			'usr_42',
		)
	})

	// Local stdio has no session at all; it must keep falling back to the
	// per-install id rather than throwing inside instrumentation.
	it.each([
		['no session', undefined],
		['a session without identity', { scopes: new Set() }],
		['a non-object session', 'nonsense'],
	])('degrades to anonymous for %s', async (_label, session) => {
		const tool = getReviewsToolResolving()
		await tool.execute({ extension_id: 1, limit: 20 }, { session })

		expect(captureEvent).toHaveBeenCalledWith(
			'mcp_tool_called',
			expect.not.objectContaining({ mcp_session_id: expect.anything() }),
			undefined,
		)
	})
})

// The policy that decides which failures are "expected" (user-facing) vs a real
// fault worth an exception report.
describe('isExpectedError', () => {
	/** A UserError wrapping an origin, as readError()/the docs+scan handlers build it. */
	function wrapping(cause: unknown): UserError {
		const err = new UserError('rendered for the caller')
		err.cause = cause
		return err
	}

	it('treats an AUTHORED UserError (no cause) as expected', () => {
		// e.g. "No extension found with catalog ID 5" or the missing-key help —
		// messages this codebase wrote deliberately, not wrapped faults.
		expect(isExpectedError(new UserError('No extension found with catalog ID 5.'))).toBe(true)
	})

	it('treats quota / rate_limit / auth classes as expected', () => {
		expect(isExpectedError({ status: 402 }), 'quota').toBe(true)
		expect(isExpectedError({ status: 429 }), 'rate_limit').toBe(true)
		expect(isExpectedError({ status: 401 }), 'auth').toBe(true)
	})

	it('treats genuine faults as NOT expected', () => {
		expect(isExpectedError({ status: 500 }), 'api_5xx').toBe(false)
		expect(isExpectedError(new Error('fetch failed')), 'network').toBe(false)
		expect(isExpectedError(new Error('timed out')), 'timeout').toBe(false)
		expect(isExpectedError(new Error('something weird')), 'unexpected').toBe(false)
	})

	// The core of the wrapper/authored split: a UserError is only as expected as
	// whatever it wraps.
	it('a UserError WRAPPING an expected condition stays expected', () => {
		expect(isExpectedError(wrapping({ status: 429 }))).toBe(true)
	})

	it('honours a caller-supplied kind, so instrument() cannot report one kind and gate on another', () => {
		// instrument() classifies once and passes the result in; the default
		// argument must not re-classify behind its back.
		expect(isExpectedError({ status: 500 }, 'quota')).toBe(true)
		expect(isExpectedError({ status: 402 }, 'api_5xx')).toBe(false)
	})

	it('a UserError WRAPPING a genuine fault is NOT expected', () => {
		expect(isExpectedError(wrapping({ status: 500 })), 'api_5xx').toBe(false)
		expect(isExpectedError(wrapping(new TypeError('x.map is not a function'))), 'bug').toBe(false)
	})
})

describe('localize_workflow execute', () => {
	it('returns offline guidance without account access and keeps the translation/release boundaries explicit', async () => {
		const { tools, server } = recordingServer()
		const deps = depsFor(['docs'])
		deps.getBff = vi.fn(() => {
			throw new Error('Unexpected account access')
		})
		deps.requireApiKey = vi.fn(() => {
			throw new Error('Unexpected key access')
		})
		registerTools(server, deps)
		const tool = tools.find((t) => t.name === 'localize_workflow') as unknown as {
			execute: (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<string>
		}
		const out = await tool.execute({}, {})
		for (const expected of [
			'extenshi localize prepare ./extension --lang fr,de,es --output ./localization --protect MyBrand',
			'extenshi localize apply ./extension --translations ./localization/translations.json --protect MyBrand',
			'extenshi localize check ./extension --protect MyBrand',
			'sourceHashes',
			'translation provider',
			'npm `latest` tag',
			'fluent reviewer',
			'review-risk',
			'RTL',
			'no API key',
		])
			expect(out).toContain(expected)
		expect(await tool.execute({}, {})).toBe(out)
		expect(deps.getBff).not.toHaveBeenCalled()
		expect(deps.requireApiKey).not.toHaveBeenCalled()
	})
})

describe('generate_icon_workflow execute', () => {
	it('returns the static workflow with the extension name inlined', async () => {
		const { tools, server } = recordingServer()
		registerTools(server, depsFor(['docs']))
		const tool = tools.find((t) => t.name === 'generate_icon_workflow') as unknown as {
			execute: (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<string>
		}
		const out = await tool.execute({ extension_name: 'Tab Keeper' }, {})
		// Pin the FULL invocation, `@latest` included: agents run this command verbatim, and
		// a bare `npx @extenshi/cli` silently reuses whatever is in their npx cache.
		expect(out).toContain('npx @extenshi/cli@latest icon preview icon.svg --name "Tab Keeper"')
		expect(out).toContain('16, 32, 48 and 128 px')
		expect(out).toContain('No API key')
	})

	it('falls back to a generic name when none is given', async () => {
		const { tools, server } = recordingServer()
		registerTools(server, depsFor(['docs']))
		const tool = tools.find((t) => t.name === 'generate_icon_workflow') as unknown as {
			execute: (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<string>
		}
		const out = await tool.execute({}, {})
		expect(out).toContain('npx @extenshi/cli@latest icon preview icon.svg --name "My Extension"')
	})
})

describe('get_risk_by_store_ids', () => {
	function registerWith(stubBff: Bff) {
		const tools: Record<string, any> = {}
		const server = {
			addTool: (t: { name: string }) => {
				tools[t.name] = t
			},
		}
		registerTools(server as unknown as Parameters<typeof registerTools>[0], {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => stubBff,
		})
		return tools
	}

	it('maps snake_case store_id to the BFF storeId input', async () => {
		const calls: Record<string, unknown>[] = []
		const tools = registerWith({
			getSecuritySummaryBatch: (input: Record<string, unknown>) => {
				calls.push(input)
				return Promise.resolve([])
			},
		} as unknown as Bff)

		await tools.get_risk_by_store_ids.execute(
			{
				extensions: [
					{ store_id: 'abc', store: 'CHROME' },
					{ store_id: 'ublock-origin', store: 'FIREFOX' },
				],
			},
			{},
		)

		expect(calls).toEqual([
			{
				extensions: [
					{ storeId: 'abc', store: 'CHROME' },
					{ storeId: 'ublock-origin', store: 'FIREFOX' },
				],
			},
		])
	})

	it('rejects a batch over the cap before it reaches the network', () => {
		// The BFF enforces the real limit; the tool schema states it so an agent
		// is told up front rather than discovering it as a round-tripped error.
		const tools = registerWith({} as unknown as Bff)
		const schema = tools.get_risk_by_store_ids.parameters
		const tooMany = {
			extensions: Array.from({ length: MAX_BATCH_EXTENSIONS + 1 }, (_, i) => ({
				store_id: `id${i}`,
				store: 'CHROME' as const,
			})),
		}
		expect(schema.safeParse(tooMany).success).toBe(false)
		expect(schema.safeParse({ extensions: tooMany.extensions.slice(0, MAX_BATCH_EXTENSIONS) }).success).toBe(
			true,
		)
	})

	it('requires an explicit store — Chrome and Edge ids are indistinguishable', () => {
		const tools = registerWith({} as unknown as Bff)
		const schema = tools.get_risk_by_store_ids.parameters
		expect(schema.safeParse({ extensions: [{ store_id: 'abc' }] }).success).toBe(false)
	})

	it('tells the agent the cap and the per-call credit cost', () => {
		const tools = registerWith({} as unknown as Bff)
		const description: string = tools.get_risk_by_store_ids.description
		expect(description).toContain(String(MAX_BATCH_EXTENSIONS))
		expect(description).toMatch(/1 read credit/i)
	})

	// Cross-package sync point: this package is published to npm and mirrored to
	// a public repo, so it cannot import from catalog-bff — the constants are kept
	// in step by reading the source. The BFF is what actually rejects an over-cap
	// request.
	//
	// The gate is the catalog-bff workspace being present, NOT the file itself.
	// Outside the monorepo (the npm tarball, and the isolated copy that
	// .github/workflows/mirror-mcp.yml builds to prove the package stands alone)
	// there is nothing to compare against, so the test skips — visibly, as a
	// reported skip. Inside the monorepo it always runs, so renaming or moving
	// metered-batch-cap.ts fails here instead of silently retiring the guard.
	const bffLib = join(__dirname, '..', '..', '..', 'catalog', 'catalog-bff', 'src', 'lib')
	const inMonorepo = existsSync(join(__dirname, '..', '..', '..', 'catalog', 'catalog-bff', 'package.json'))

	it.skipIf(!inMonorepo)('matches METERED_BATCH_MAX_EXTENSIONS in the BFF, which is the authority', () => {
		const bffSource = readFileSync(join(bffLib, 'metered-batch-cap.ts'), 'utf8')
		const match = bffSource.match(/METERED_BATCH_MAX_EXTENSIONS\s*=\s*(\d+)/)
		expect(match, 'METERED_BATCH_MAX_EXTENSIONS not found in catalog-bff').not.toBeNull()
		expect(Number(match?.[1])).toBe(MAX_BATCH_EXTENSIONS)
	})
})

describe('import_manifest execute', () => {
	it('defaults to preview, forwards all manifest fields and requires the preview hash to apply', async () => {
		const imported = vi.fn(async () => ({ dryRun: true, expectedStateHash: 'a'.repeat(64), changes: [] }))
		const tool = readToolsWith({ importManifest: imported }).import_manifest
		const envelope = {
			projectId: '11111111-1111-4111-8111-111111111111',
			schemaVersion: 1,
			expectedRevision: 0,
			idempotencyKey: '22222222-2222-4222-8222-222222222222',
			browser: 'chrome',
			provenance: { source: 'agent', toolVersion: 'test', observedAt: '2026-09-10T12:00:00Z' },
			manifest: {
				manifest_version: 3,
				name: '__MSG_name__',
				version: '0.1.0',
				commands: { custom: { description: 'keep' } },
			},
			messages: { name: { message: 'Reader' } },
		}
		const input = tool.parameters.parse(envelope)
		expect(input.dryRun).toBe(true)
		await tool.execute(input, {})
		expect(imported).toHaveBeenCalledWith(input)
		expect(() => tool.parameters.parse({ ...envelope, dryRun: false })).toThrow('expectedStateHash')
		expect(() => tool.parameters.parse({ ...envelope, tombstones: ['/release'] })).toThrow('tombstones')
	})
})

describe('published input schemas', () => {
	// The connector directory rejects untyped parameters, and zod-to-json-schema's
	// default turns every reused zod instance into a bare `$ref` (inputDigest,
	// expectedStateHash, toolVersion, …). fastmcp reads `~standard.jsonSchema`
	// first, so that is the schema clients and the directory actually see.
	const tools: Array<{ name: string; parameters?: any }> = []
	registerTools(
		{ addTool: (t: { name: string }) => tools.push(t) } as unknown as Parameters<typeof registerTools>[0],
		depsFor(['read', 'docs', 'scan', 'publish']),
	)

	it.each(tools.filter((t) => t.parameters).map((t) => [t.name, t.parameters]))(
		'%s has no $ref and a type on every property',
		(_name, parameters) => {
			const schema = parameters['~standard'].jsonSchema.input({ target: 'draft-07' })
			expect(JSON.stringify(schema)).not.toContain('$ref')
			for (const [key, prop] of Object.entries<Record<string, unknown>>(schema.properties ?? {}))
				expect(
					'type' in prop || 'anyOf' in prop || 'enum' in prop || 'const' in prop,
					`${key} is untyped`,
				).toBe(true)
		},
	)

	it('keeps zod validation on the wrapped schema', () => {
		const record = tools.find((t) => t.name === 'record_project_evidence')?.parameters
		expect(record['~standard'].jsonSchema.input().properties.inputDigest).toMatchObject({ type: 'string' })
		expect(record.safeParse({}).success).toBe(false)
	})
})

describe('tool descriptions (Anthropic Software Directory Policy §2)', () => {
	// Descriptions state what a tool does, returns and changes. They carry no
	// instructions to the model, no steering toward other tools and no hidden text.
	const IMPERATIVE = /\b(never|always|do not|don't|must)\b/i
	const STEERING =
		/\b(then call|call this|re-read|before telling|omit (to|for|the)|limit to|include extensions)\b/i
	const tools: Array<{ name: string; description?: string; parameters?: any }> = []
	registerTools(
		{ addTool: (t: { name: string }) => tools.push(t) } as unknown as Parameters<typeof registerTools>[0],
		depsFor(['read', 'docs', 'scan', 'publish']),
	)
	const paramDescriptions = (node: unknown, out: string[] = []): string[] => {
		if (Array.isArray(node)) for (const item of node) paramDescriptions(item, out)
		else if (node && typeof node === 'object')
			for (const [key, value] of Object.entries(node)) {
				if (key === 'description' && typeof value === 'string') out.push(value)
				else paramDescriptions(value, out)
			}
		return out
	}
	const texts = tools.flatMap((t) => [
		[t.name, t.description ?? ''] as const,
		...(t.parameters
			? paramDescriptions(t.parameters['~standard'].jsonSchema.input({ target: 'draft-07' })).map(
					(d) => [`${t.name} (parameter)`, d] as const,
				)
			: []),
	])

	it('registers every tool with a description', () => {
		expect(tools.length).toBeGreaterThan(40)
		for (const t of tools) expect(t.description, t.name).toBeTruthy()
	})

	it.each(texts)('%s has no imperative or steering wording', (_name, text) => {
		expect(text).not.toMatch(IMPERATIVE)
		expect(text).not.toMatch(STEERING)
		// No hidden or encoded text: printable characters only (plus newlines).
		const hidden = [...text].filter((ch) => {
			const code = ch.codePointAt(0) ?? 0
			return (
				(code < 0x20 && code !== 0x0a) ||
				(code >= 0x200b && code <= 0x200f) ||
				(code >= 0x2060 && code <= 0x2064) ||
				code === 0xfeff
			)
		})
		expect(hidden).toEqual([])
	})

	it('states the extension-safe keys fact once, on get_pay_seller', () => {
		const withFact = tools.filter((t) => /embedded in extension code/.test(t.description ?? ''))
		expect(withFact.map((t) => t.name)).toEqual(['get_pay_seller'])
	})
})

describe('Pay error guidance', () => {
	const trpcError = (message: string, httpStatus: number) =>
		Object.assign(new Error(message), { data: { httpStatus } })
	const appId = '11111111-1111-4111-8111-111111111111'

	it.each([
		[trpcError('No payment gateway connected', 404), /connect_pay_seller/],
		[trpcError('Pay application is archived', 412), /archived/],
		[trpcError('Seller agreement not accepted', 412), /KYC in the browser/],
		[trpcError('Application not found', 404), /list_pay_apps/],
	])('maps %s to actionable guidance', async (err, expected) => {
		const tools = readToolsWith({ rotatePayKey: () => Promise.reject(err) })
		await expect(tools.rotate_pay_key.execute({ appId }, {})).rejects.toThrow(expected)
	})

	it('never echoes the backend or provider message', async () => {
		const tools = readToolsWith({
			rotatePayKey: () => Promise.reject(trpcError('sk_live_secret leaked', 404)),
		})
		await expect(tools.rotate_pay_key.execute({ appId }, {})).rejects.not.toThrow(/sk_live/)
	})
})
