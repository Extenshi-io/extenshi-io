/**
 * Anthropic Software Directory Policy guards for the free reference tools.
 *
 *  - 2F/2G: static tool OUTPUTS are reference material (requirements, formats,
 *    process descriptions), not instructions addressed to the model.
 *  - 5B: default responses stay proportionate — size ceilings below are pinned
 *    against fixtures so a data or copy change cannot silently regress them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bff } from './bff.js'
import { clearDocsCache } from './docs.js'
import { renderIconWorkflow } from './icon-workflow.js'
import { renderLocalizeWorkflow } from './localize-workflow.js'
import { renderExtensionTemplates } from './templates.js'
import { type Capability, registerTools } from './tools.js'
import { renderWelcomeWorkflow } from './welcome-workflow.js'

vi.mock('./telemetry.js', async (original) => ({
	...(await original<typeof import('./telemetry.js')>()),
	captureEvent: vi.fn(),
	captureError: vi.fn(),
}))

type Exec = (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<string>

function registerAll(bff: Partial<Bff> = {}, capabilities: Capability[] = ['read', 'docs']) {
	const tools: Record<string, { execute: Exec }> = {}
	registerTools(
		{
			addTool: (t: { name: string; execute: Exec }) => {
				tools[t.name] = t
			},
		} as unknown as Parameters<typeof registerTools>[0],
		{
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set(capabilities),
			getBff: () => bff as Bff,
			requireApiKey: () => 'ek_test',
			getApiKey: () => 'ek_test',
		},
	)
	return tools
}

afterEach(() => {
	vi.unstubAllGlobals()
	clearDocsCache()
})

// ── 2F / 2G: voice ────────────────────────────────────────────────────────────

const STATIC_OUTPUTS: Array<[string, () => string]> = [
	['localize_workflow', () => renderLocalizeWorkflow()],
	['generate_icon_workflow', () => renderIconWorkflow({ extensionName: 'Tab Keeper' })],
	['generate_welcome_page_workflow (pin)', () => renderWelcomeWorkflow({ extensionName: 'Tab Keeper' })],
	[
		'generate_welcome_page_workflow (site, no target)',
		() =>
			renderWelcomeWorkflow({ extensionName: 'Tab Keeper', goal: 'VISIT_SITE', existingSteps: ['Open it'] }),
	],
	[
		'generate_welcome_page_workflow (custom)',
		() => renderWelcomeWorkflow({ extensionName: 'X', goal: 'CUSTOM' }),
	],
	['list_extension_templates', () => renderExtensionTemplates()],
]

describe('static reference outputs (policy 2F/2G)', () => {
	it.each(STATIC_OUTPUTS)('%s carries no model-directed meta-talk', (_name, render) => {
		const out = render()
		expect(out).not.toMatch(/\b(the agent|your agent|coding agent|AI agent|LLM|Claude|language model)\b/i)
		expect(out).not.toMatch(/\binstructions?\b/i)
		expect(out).not.toMatch(/\bYou are\b/)
	})

	it.each(STATIC_OUTPUTS.filter(([name]) => name !== 'list_extension_templates'))(
		'%s has no second-person address or absolute directives',
		(_name, render) => {
			const out = render()
			expect(out).not.toMatch(/\b(you|your|yourself)\b/i)
			expect(out).not.toMatch(/\b(you must|never|always)\b/i)
		},
	)

	it.each(STATIC_OUTPUTS)('%s does not direct a call to another tool', (_name, render) => {
		expect(render()).not.toMatch(/\b(call|invoke|run the tool|use the tool)\s+`?[a-z]+_[a-z_]+/i)
	})
})

// ── 5B: search_docs ───────────────────────────────────────────────────────────

/** Ten large pages whose every subsection mentions the query terms. */
function bigDocsFixture(): string {
	const para = 'Scan the extension zip in CI with the extenshi CLI and review-risk flags. '.repeat(40)
	const pages: string[] = ['# Extenshi documentation', '', '> Intro.', '']
	for (let p = 0; p < 10; p++) {
		pages.push(`# Page ${p}`, '', `*Source: https://docs.extenshi.io/page-${p}*`, '')
		for (let s = 0; s < 8; s++) {
			pages.push(`## Scan section ${s}`, '', para, '', '```bash', 'extenshi scan ./dist/app.zip', '```', '')
		}
	}
	return pages.join('\n')
}

describe('search_docs size (policy 5B)', () => {
	it('returns bounded passages with URLs by default, well under 8k chars', async () => {
		const full = bigDocsFixture()
		expect(full.length).toBeGreaterThan(200_000)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(full, { status: 200 })),
		)
		const tools = registerAll()
		const out = await tools.search_docs.execute({ query: 'scan a zip in CI' }, {})
		expect(out.length).toBeLessThanOrEqual(8_000)
		expect(out).toContain('Source: https://docs.extenshi.io/page-')
		expect(out).toContain('excerpt truncated')
		expect(out.match(/^## /gm)).toHaveLength(4)
	})

	it('honours limit and max_chars', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(bigDocsFixture(), { status: 200 })),
		)
		const tools = registerAll()
		const small = await tools.search_docs.execute({ query: 'scan', limit: 2, max_chars: 300 }, {})
		expect(small.match(/^## /gm)).toHaveLength(2)
		expect(small.length).toBeLessThanOrEqual(1_200)
	})
})

// ── 5B: market_overview ───────────────────────────────────────────────────────

function categoryNode(key: string, count: number, children: unknown[] = []) {
	return {
		id: `__root__::${key}`,
		name: key,
		slug: key,
		displayName: key,
		filterKey: key,
		aliases: [key, `${key}_alias`],
		description: 'Extensions that help with everyday tasks in this area of the browser store taxonomy.',
		store: null,
		parentId: null,
		_count: { snapshots: count },
		count,
		children,
	}
}

/** A catalog-sized fixture: ~40 categories (some with subcategories), 17 permissions, 80 sites. */
function marketFixture() {
	const categoryTree = Array.from({ length: 36 }, (_, i) =>
		categoryNode(
			`category-${i}`,
			1000 - i,
			i < 4 ? Array.from({ length: 12 }, (_, k) => categoryNode(`category-${i}-${k}`, 100 - k)) : [],
		),
	)
	const permissions = Object.fromEntries(
		Array.from({ length: 17 }, (_, i) => [`permission${i}`, 5000 - i * 100]),
	)
	const targetSites = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`site-${i}.com`, 900 - i]))
	const extended = {
		manifestVersion: { '2': 12000, '3': 150000 },
		traderStatus: { TRADER: 30000, NON_TRADER: 90000 },
		updatedWithin: { '30d': 1, '90d': 2, '1y': 3, stale: 4 },
		minReviews: { '10': 1, '100': 2, '1000': 3 },
		permissions,
		targetSites,
		riskCategory: { UNKNOWN: 1, NONE: 2, LOW: 3, MEDIUM: 4, HIGH: 5, CRITICAL: 6 },
		languageCount: { '2': 1, '5': 2, '10': 3, '25': 4 },
	}
	const stats = {
		totalExtensions: 200000,
		totalsnapshots: 900000,
		totalReviews: 3000000,
		averageRating: '4.1',
		storeDistribution: [
			{ store: 'CHROME', count: 150000 },
			{ store: 'FIREFOX', count: 40000 },
			{ store: 'EDGE', count: 10000 },
		],
	}
	const searchFacets = {
		stores: stats.storeDistribution.map((s) => ({ name: s.store, count: s.count, label: s.store })),
		categories: categoryTree.map((c) => ({
			filterKey: c.filterKey,
			displayName: c.displayName,
			aliases: c.aliases,
			count: c.count,
			description: c.description,
			stores: ['CHROME'],
		})),
		categoryTree,
		questionnaire: {
			monetizationModel: { FREE: 1, ONE_TIME: 2, SUBSCRIPTION: 3, FREEMIUM: 4, DONATIONS: 5, ADS: 6 },
			hasPaywall: 1,
			isOpenSource: 2,
			noTelemetry: 3,
			collectsHealthData: 4,
		},
		downloads: { '100m': 1, '10m': 2, '1m': 3, '100k': 4 },
		extended,
		total: 1234,
	}
	const bff: Partial<Bff> = {
		getStats: async () => stats,
		getExtendedFilterFacets: async () => extended,
		getCategoryTree: async () => categoryTree,
		getSearchFacets: async () => searchFacets,
	}
	return { bff, rawSize: JSON.stringify({ stats, extended, categoryTree }).length }
}

describe('market_overview size (policy 5B)', () => {
	it('keeps the default catalog-wide response under 10k chars and reports what was trimmed', async () => {
		const { bff, rawSize } = marketFixture()
		expect(rawSize).toBeGreaterThan(25_000)
		const out = await registerAll(bff).market_overview.execute({}, {})
		expect(out.length).toBeLessThanOrEqual(10_000)
		const parsed = JSON.parse(out)
		expect(parsed.scope).toBe('catalog-wide')
		expect(parsed.facets.categoryTree).toHaveLength(10)
		expect(parsed.facets.categoryTree[0]).toEqual(
			expect.objectContaining({ name: 'category-0', slug: 'category-0', count: 1000 }),
		)
		expect(parsed.facets.categoryTree[0].children).toHaveLength(10)
		expect(parsed.facets.categoryTree[0].moreChildren).toBe(2)
		expect(Object.keys(parsed.facets.extended.targetSites)).toHaveLength(10)
		expect(parsed.facets.extended.manifestVersion).toEqual({ '2': 12000, '3': 150000 })
		expect(parsed.truncated).toEqual({
			categoryTree: 26,
			'extended.permissions': 7,
			'extended.targetSites': 70,
		})
		expect(parsed.stats.totalExtensions).toBe(200000)
	})

	it('keeps the default query-scoped response under 10k chars', async () => {
		const { bff } = marketFixture()
		const out = await registerAll(bff).market_overview.execute({ query: 'ad blocker' }, {})
		expect(out.length).toBeLessThanOrEqual(10_000)
		const parsed = JSON.parse(out)
		expect(parsed.scope).toBe('search')
		expect(parsed.facets.questionnaire.monetizationModel.FREE).toBe(1)
		expect(parsed.facets.total).toBe(1234)
		// The flat list duplicates the tree; only the tree is returned.
		expect(parsed.facets.categories).toBeUndefined()
	})

	it('narrows to the requested facets and widens with top_n', async () => {
		const { bff } = marketFixture()
		const tools = registerAll(bff)
		const onlyStats = JSON.parse(await tools.market_overview.execute({ facets: ['stats'] }, {}))
		expect(onlyStats.stats.totalExtensions).toBe(200000)
		expect(onlyStats.facets).toBeUndefined()

		const wide = JSON.parse(await tools.market_overview.execute({ facets: ['extended'], top_n: 100 }, {}))
		expect(Object.keys(wide.facets.extended.targetSites)).toHaveLength(80)
		expect(wide.truncated).toBeUndefined()
	})
})
