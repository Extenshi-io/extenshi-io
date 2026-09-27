import { describe, expect, it } from 'vitest'
import {
	shapeExtension,
	shapeInstallDialog,
	shapeReviews,
	shapeSearch,
	shapeSecurity,
	shapeStoreRiskBatch,
} from './shape.js'

// Mirrors the `installDialogPreview` shape catalog-api attaches to
// getExtensionById (see shared-types/permission-warnings.ts → InstallDialogPreview).
const preview = {
	chrome: {
		warnings: [
			{
				message: 'Read and change all your data on all websites',
				sources: ['<all_urls>', 'proxy'],
			},
			{ message: 'Read your browsing history', sources: ['tabs'] },
		],
		readsAllData: true,
	},
	firefox: {
		warnings: [{ message: 'Access your data for all websites', sources: ['<all_urls>'] }],
		readsAllData: true,
	},
	silentPermissions: ['storage', 'scripting'],
	unknownPermissions: ['brandNewPermission'],
	excluded: ['bookmarks'],
	consideredCount: 4,
}

describe('shapeInstallDialog', () => {
	it('reduces each browser to readsAllData + human-readable warning lines', () => {
		const out = shapeInstallDialog(preview)
		expect(out?.chrome).toEqual({
			readsAllData: true,
			warnings: ['Read and change all your data on all websites', 'Read your browsing history'],
		})
		expect(out?.firefox).toEqual({
			readsAllData: true,
			warnings: ['Access your data for all websites'],
		})
		expect(out?.silentPermissions).toEqual(['storage', 'scripting'])
		expect(out?.optionalExcluded).toEqual(['bookmarks'])
		expect(out?.unknownPermissions).toEqual(['brandNewPermission'])
	})

	it('drops empty silent/optional lists and returns undefined for non-objects', () => {
		const out = shapeInstallDialog({
			chrome: { warnings: [], readsAllData: false },
			firefox: { warnings: [], readsAllData: false },
			silentPermissions: [],
			excluded: [],
		})
		expect(out?.silentPermissions).toBeUndefined()
		expect(out?.optionalExcluded).toBeUndefined()
		expect(shapeInstallDialog(null)).toBeUndefined()
		expect(shapeInstallDialog('nope')).toBeUndefined()
	})
})

describe('shapeSecurity with install-dialog preview', () => {
	it('surfaces the preview even when the extension was never scanned', () => {
		const out = shapeSecurity(null, null, preview)
		expect(out.scanned).toBe(false)
		expect(out.message).toMatch(/not been scanned/)
		expect(out.installDialogPreview).toBeDefined()
	})

	it('includes the preview alongside scan data (no scanned:false flag)', () => {
		const security = {
			findings: {
				total: 1,
				groupTotal: 1,
				bySeverity: { HIGH: [{ scanner: 'semgrep', severity: 'HIGH', count: 1 }] },
			},
		}
		const out = shapeSecurity(security, null, preview)
		expect(out.findings).toBeDefined()
		expect(out.installDialogPreview).toBeDefined()
		expect(out.scanned).toBeUndefined()
	})

	it('replaces raw scanner names with public capability phrases', () => {
		const security = {
			findings: {
				total: 3,
				groupTotal: 3,
				bySeverity: {
					HIGH: [
						{ scanner: 'semgrep', severity: 'HIGH', count: 1 },
						{ scanner: 'YARA', severity: 'HIGH', count: 1 },
						{ scanner: 'some_new_tool', severity: 'HIGH', count: 1 },
						{
							scanner: 'jstap',
							rule_id: 'jstap:document-cookie-access',
							title: 'jstap:document-cookie-access',
							severity: 'HIGH',
							count: 1,
						},
						{ scanner: 'semgrep', rule_id: 'note:keep-me', title: 'Ratio: 3:1', severity: 'HIGH', count: 1 },
					],
				},
			},
		}
		const json = JSON.stringify(shapeSecurity(security, null))
		expect(json).toContain('Code vulnerability analysis')
		expect(json).toContain('Malware signature matching')
		expect(json).toContain('Security analysis')
		for (const raw of ['semgrep', 'YARA', 'some_new_tool', 'jstap']) expect(json).not.toContain(raw)
		expect(json).toContain('"document-cookie-access"')
		// Only known scanner namespaces are stripped.
		expect(json).toContain('note:keep-me')
		expect(json).toContain('Ratio: 3:1')
	})

	it('omits the preview key when none is provided', () => {
		const out = shapeSecurity(null, { overallScore: 10 }, undefined)
		expect(out.installDialogPreview).toBeUndefined()
	})
})

describe('shapeExtension', () => {
	it('carries the install-dialog preview through', () => {
		const out = shapeExtension({ id: 1, slug: 'x', snapshots: [], installDialogPreview: preview }) as Record<
			string,
			unknown
		>
		expect(out.installDialogPreview).toBeDefined()
	})

	it('converts the backend risk score into the website safety score (100 - risk)', () => {
		const out = shapeExtension({ id: 1, slug: 'x', snapshots: [], latestRiskScore: 72.29 }) as Record<
			string,
			unknown
		>
		expect(out.safetyScore).toBeCloseTo(27.71)
		expect(out.riskScore).toBeUndefined()
	})

	it('omits safetyScore entirely when the extension was never scored', () => {
		const out = shapeExtension({ id: 1, slug: 'x', snapshots: [] }) as Record<string, unknown>
		expect(out.safetyScore).toBeUndefined()
	})
})

describe('safety-score parity with the website', () => {
	it('shapeSearch surfaces safetyScore (not riskScore) per cluster', () => {
		const out = shapeSearch(
			{ items: [{ id: 1, slug: 'x', snapshots: [{ name: 'X' }], security: { overallScore: 40 } }], total: 1 },
			10,
		)
		const item = (out.items as Record<string, unknown>[])[0]
		expect(item.safetyScore).toBe(60)
		expect(item.riskScore).toBeUndefined()
	})

	it('shapeSecurity summary reports safetyScore from the raw risk summary', () => {
		const out = shapeSecurity(null, { overallScore: 10, riskCategory: 'LOW' }, undefined)
		const summary = out.summary as Record<string, unknown>
		expect(summary.safetyScore).toBe(90)
		expect(summary.overallScore).toBeUndefined()
		expect(summary.riskCategory).toBe('LOW')
	})

	it('shapeSecurity summary falls back to riskAssessment.overallScore → safetyScore', () => {
		const out = shapeSecurity({ riskAssessment: { overallScore: 25 } }, null, undefined)
		const summary = out.summary as Record<string, unknown>
		expect(summary.safetyScore).toBe(75)
	})
})

describe('shapeReviews', () => {
	it('curates a FF/Edge review with an excerpt, source note, and store metadata', () => {
		const out = shapeReviews(
			{
				items: [
					{
						rating: 5,
						content: 'a'.repeat(1000),
						reviewDate: '2026-01-02T00:00:00.000Z',
						languageId: 7,
						storeReviewId: 'ff-1',
						store: 'FIREFOX',
						storeUrl: 'https://addons.mozilla.org/addon/foo/',
						contentPolicy: 'excerpt',
						contentTruncated: true,
					},
				],
				nextCursor: 99,
				aggregate: {
					rating: 4.5,
					ratingCount: 1200,
					ratingUpdatedAt: '2026-02-01T00:00:00.000Z',
					storeReviewsUrl: 'https://addons.mozilla.org/addon/foo/reviews/',
				},
			},
			10,
		)
		expect(out.count).toBe(1)
		expect(out.nextCursor).toBe(99)
		// Store-level aggregate passes through for quick sizing.
		expect(out.aggregate).toMatchObject({ rating: 4.5, ratingCount: 1200 })
		const items = out.items as Record<string, unknown>[]
		// Double-bound at the excerpt cap even if the server excerpt drifts longer.
		expect((items[0].content as string).length).toBe(300)
		expect(items[0].store).toBe('FIREFOX')
		expect(items[0].contentTruncated).toBe(true)
		expect(items[0].note).toBe('Source: FIREFOX, full review at https://addons.mozilla.org/addon/foo/')
		expect(items[0].storeReviewId).toBe('ff-1')
	})

	it('withholds Chrome review text and points at the store reviews tab', () => {
		const out = shapeReviews(
			{
				items: [
					{
						rating: 5,
						// A drifted payload that still carries a Chrome body — the shaper
						// must NOT surface it (defense-in-depth).
						content: 'LEAKED CHROME BODY',
						reviewDate: '2026-01-02T00:00:00.000Z',
						storeReviewId: 'chrome-uuid-1',
						store: 'CHROME',
						storeUrl: 'https://chromewebstore.google.com/detail/abc',
						contentPolicy: 'rating-only',
						contentTruncated: false,
					},
				],
				nextCursor: null,
			},
			10,
		)
		const items = out.items as Record<string, unknown>[]
		expect(items[0].content).toBeUndefined()
		expect(JSON.stringify(out)).not.toContain('LEAKED CHROME BODY')
		expect(items[0].note).toBe(
			'Per Chrome Web Store terms, review text is not republished — read the full review at https://chromewebstore.google.com/detail/abc/reviews',
		)
		expect(items[0].rating).toBe(5)
	})

	it('forces rating-only for a Chrome item even if contentPolicy is missing', () => {
		const out = shapeReviews(
			{ items: [{ rating: 4, content: 'still secret', store: 'CHROME' }], nextCursor: null },
			10,
		)
		expect(JSON.stringify(out)).not.toContain('still secret')
	})

	it('never surfaces reviewer identity even if the payload leaks it', () => {
		// Defense-in-depth: the server omits author fields, but the shaper must
		// not pass them through either if a drift ever reintroduces them.
		const out = shapeReviews(
			{
				items: [
					{
						rating: 4,
						content: 'ok',
						store: 'EDGE',
						contentPolicy: 'excerpt',
						authorName: 'Jane',
						authorAvatar: 'x.png',
					},
				],
				nextCursor: null,
			},
			10,
		)
		expect(JSON.stringify(out)).not.toContain('Jane')
		expect(JSON.stringify(out)).not.toContain('x.png')
	})
})

// A row as catalog-api returns it for a clustered extension: the store id
// belongs to the Chrome member (295111), but the score describes the cluster
// canonical (the Edge record 1116) — which is what the extension page renders.
const clusteredRow = {
	storeId: 'nkbihfbeogaeaoehlefnkodbefgpgknn',
	store: 'CHROME',
	extensionId: 295111,
	canonicalExtensionId: 1116,
	scoredExtensionId: 1116,
	scoredStore: 'EDGE',
	extensionName: 'MetaMask',
	riskCategory: 'CRITICAL',
	riskScore: 80.47,
	severityBreakdown: { critical: 3, high: 5, medium: 0, low: 1, info: 0, review_required: 0 },
	totalFindings: 9,
	lastScanDate: '2026-07-27T10:59:48.099Z',
}

describe('shapeStoreRiskBatch', () => {
	it('publishes the website safety coefficient, not the raw risk score', () => {
		// The backend stores RISK (0 = safest). Passing it straight through would
		// make the MCP answer contradict the extension page by construction.
		const out = shapeStoreRiskBatch([clusteredRow], [{ storeId: clusteredRow.storeId, store: 'CHROME' }])
		const row = (out.extensions as Record<string, unknown>[])[0]
		expect(row.safetyScore).toBeCloseTo(19.53, 2)
		expect(row.riskCategory).toBe('CRITICAL')
	})

	it('links to the CANONICAL catalog page, so the URL matches the score', () => {
		const out = shapeStoreRiskBatch([clusteredRow], [{ storeId: clusteredRow.storeId, store: 'CHROME' }])
		const row = (out.extensions as Record<string, unknown>[])[0]
		expect(row.extensionId).toBe(1116)
		expect(row.catalogUrl).toBe('https://catalog.extenshi.io/extensions/1116')
	})

	it('names the store variant the score was measured on', () => {
		// Cluster members are scanned independently and disagree, so an agent
		// reporting this number must be able to say which listing it describes.
		const out = shapeStoreRiskBatch([clusteredRow], [{ storeId: clusteredRow.storeId, store: 'CHROME' }])
		const row = (out.extensions as Record<string, unknown>[])[0]
		expect(row.scoredStore).toBe('EDGE')
		expect(row.scoredVariantId).toBe(1116)
	})

	it('omits the variant labels when the score is this listing’s own', () => {
		const own = {
			...clusteredRow,
			canonicalExtensionId: 295111,
			scoredExtensionId: 295111,
			scoredStore: 'CHROME',
		}
		const out = shapeStoreRiskBatch([own], [{ storeId: own.storeId, store: 'CHROME' }])
		const row = (out.extensions as Record<string, unknown>[])[0]
		expect(row.scoredStore).toBeUndefined()
		expect(row.scoredVariantId).toBeUndefined()
	})

	it('marks an unscanned extension rather than implying it is safe', () => {
		const unscanned = { ...clusteredRow, riskCategory: null, riskScore: null, totalFindings: null }
		const out = shapeStoreRiskBatch([unscanned], [{ storeId: unscanned.storeId, store: 'CHROME' }])
		const row = (out.extensions as Record<string, unknown>[])[0]
		expect(row.scanned).toBe(false)
		expect(row.safetyScore).toBeUndefined()
	})

	it('reports which requested ids the catalog has no listing for', () => {
		// "Not in the catalog" and "safe" must never look the same to an agent.
		const out = shapeStoreRiskBatch(
			[clusteredRow],
			[
				{ storeId: clusteredRow.storeId, store: 'CHROME' },
				{ storeId: 'neverscraped', store: 'EDGE' },
			],
		)
		expect(out.requested).toBe(2)
		expect(out.matched).toBe(1)
		expect(out.notInCatalog).toEqual([{ storeId: 'neverscraped', store: 'EDGE' }])
		expect(String(out.note)).toMatch(/NOT a safety verdict/)
	})

	it('says nothing about missing ids when everything resolved', () => {
		const out = shapeStoreRiskBatch([clusteredRow], [{ storeId: clusteredRow.storeId, store: 'CHROME' }])
		expect(out.notInCatalog).toBeUndefined()
		expect(out.note).toBeUndefined()
	})

	it('survives a drifted payload instead of throwing', () => {
		expect(() => shapeStoreRiskBatch(null, [])).not.toThrow()
		expect(() => shapeStoreRiskBatch(['nonsense'], [])).not.toThrow()
	})
})
