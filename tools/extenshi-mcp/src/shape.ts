/**
 * Output shaping for MCP tool results.
 *
 * MCP tool results land directly in the AI client's context window, so we keep
 * them compact and curated. Field names below match the live BFF payloads
 * (catalog router mounted as `catalog`, security as `security`):
 *   - search items wrap a cross-store cluster: `{ id, slug, snapshots[], availableStores, security }`
 *     where the human-facing fields (name, rating, users, store) live on each snapshot.
 *   - `getExtensionById` returns the cluster with aggregated `latest*` fields.
 *   - `getSecurityData` returns `{ riskAssessment, scanExecution, findings:{ total, groupTotal, bySeverity } }`.
 *   - `getRiskSummary` is already a compact summary (or null if never scanned).
 *
 * `compact()` is a defensive fallback that bounds array length / string length /
 * depth so a tool can never blow up the context even if a shape drifts.
 */

interface CompactOpts {
	maxArray?: number
	maxString?: number
	maxDepth?: number
}

/** Recursively bound a value's size: cap arrays, truncate strings, limit depth. */
export function compact(value: unknown, opts: CompactOpts = {}, depth = 0): unknown {
	const { maxArray = 20, maxString = 400, maxDepth = 5 } = opts

	if (typeof value === 'string') {
		return value.length > maxString ? `${value.slice(0, maxString)}…` : value
	}
	if (value === null || typeof value !== 'object') return value
	if (depth >= maxDepth) return Array.isArray(value) ? `[${value.length} items]` : '{…}'

	if (Array.isArray(value)) {
		const capped = value.slice(0, maxArray).map((v) => compact(v, opts, depth + 1))
		if (value.length > maxArray) capped.push(`…+${value.length - maxArray} more`)
		return capped
	}

	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (v === undefined || v === null) continue
		out[k] = compact(v, opts, depth + 1)
	}
	return out
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
	return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Drop nullish entries so curated objects stay terse. */
function prune(obj: Obj): Obj {
	for (const k of Object.keys(obj)) if (obj[k] === undefined || obj[k] === null) delete obj[k]
	return obj
}

/**
 * Convert a backend risk score (0 = safest, 100 = most dangerous) into the
 * user-facing safety score (0 = most dangerous, 100 = safest) — the SAME
 * coefficient the website shows everywhere (catalog-frontend `toSafetyScore`:
 * `clamp(0, 100, 100 - risk)`). Returns undefined for a missing score so an
 * unscanned extension surfaces no score at all (rather than a misleading 100).
 */
function toSafetyScore(risk: unknown): number | undefined {
	if (risk === undefined || risk === null) return undefined
	const r = Number(risk)
	if (!Number.isFinite(r)) return undefined
	return Math.max(0, Math.min(100, 100 - r))
}

function primaryCategory(snap: Obj): unknown {
	const cats = snap.categories
	if (Array.isArray(cats) && isObj(cats[0])) return (cats[0] as Obj).name ?? (cats[0] as Obj).displayName
	return undefined
}

/** Curate one search-result cluster via its primary (first) snapshot. */
function shapeSearchItem(item: unknown): Obj {
	if (!isObj(item)) return { value: compact(item) }
	const snaps = Array.isArray(item.snapshots) ? (item.snapshots as Obj[]) : []
	const snap = isObj(snaps[0]) ? snaps[0] : {}
	const security = isObj(item.security) ? item.security : undefined
	const riskAssessment =
		security && isObj(security.riskAssessment) ? (security.riskAssessment as Obj) : undefined
	return prune({
		id: item.id,
		slug: item.slug,
		name: snap.name,
		author: snap.authorName,
		stores: item.availableStores,
		store: snap.store,
		storeId: snap.storeId,
		users: snap.usersNumeric ?? snap.weeklyDownloads,
		rating: snap.rating,
		reviews: snap.ratingCount,
		category: primaryCategory(snap),
		version: snap.version,
		lastUpdated: snap.lastUpdated,
		sizeBytes: item.latestSizeBytes,
		safetyScore: toSafetyScore(riskAssessment?.overallScore ?? security?.overallScore),
		shortDescription:
			typeof snap.shortDescription === 'string' ? snap.shortDescription.slice(0, 200) : undefined,
	})
}

/** Compact a search result down to a count + curated items. */
export function shapeSearch(result: unknown, limit: number): Obj {
	const arr = Array.isArray(result)
		? result
		: isObj(result) && Array.isArray(result.items)
			? (result.items as unknown[])
			: []
	const items = arr.slice(0, limit).map(shapeSearchItem)
	const total = isObj(result) ? (result.total ?? result.totalCount) : undefined
	return prune({ count: items.length, total, items } as Obj)
}

/** Curate a single extension detail (`getExtensionById`). */
export function shapeExtension(result: unknown): unknown {
	if (!isObj(result)) return result ?? null
	const snaps = Array.isArray(result.snapshots) ? (result.snapshots as Obj[]) : []
	const stores = [...new Set(snaps.map((s) => (isObj(s) ? s.store : undefined)).filter(Boolean))]
	const reviews = result.reviews
	return prune({
		id: result.id,
		slug: result.slug,
		name: result.latestName,
		rating: result.latestRating,
		users: result.latestUsersNumeric,
		lastUpdated: result.latestUpdatedAt,
		traderStatus: result.latestTraderStatus,
		safetyScore: toSafetyScore(result.latestRiskScore),
		safetyScoreAt: result.latestRiskScoreAt,
		sizeBytes: result.latestSizeBytes,
		hidden: result.hidden || undefined,
		stores: stores.length ? stores : undefined,
		reviewCount: Array.isArray(reviews) ? reviews.length : reviews,
		installDialogPreview: shapeInstallDialog(result.installDialogPreview),
		snapshots: snaps.slice(0, 6).map((s) =>
			prune({
				store: s.store,
				storeId: s.storeId,
				name: s.name,
				rating: s.rating,
				reviews: s.ratingCount,
				users: s.usersNumeric ?? s.weeklyDownloads,
				version: s.version,
				lastUpdated: s.lastUpdated,
				category: primaryCategory(s),
			}),
		),
	})
}

/** Hard cap on FF/Edge excerpt length surfaced by the MCP — mirrors the
 *  server's REVIEW_EXCERPT_MAX_CHARS (shared-types/reviews.ts). The server
 *  already excerpts; this is a defense-in-depth double-bound so a drifted
 *  payload can never surface a longer body through the MCP. */
const REVIEW_EXCERPT_MAX_CHARS = 300

/** Curate one store review. Reviewer identity is never in the payload (the
 *  server omits authorName/authorAvatar as PII), so there is nothing to strip
 *  here. The paid MCP surface obeys the same per-store content policy as the
 *  website (shared-types/reviews.ts):
 *    - CHROME (`contentPolicy: 'rating-only'`) → NO review text; surface the
 *      bare facts + a note pointing at the store's reviews tab.
 *    - FIREFOX/EDGE (`'excerpt'`) → the ≤300-char excerpt + a source attribution.
 *  Chrome is forced rating-only even if a drifted payload carried a body. */
function shapeReview(r: unknown): Obj {
	if (!isObj(r)) return { value: compact(r) }
	const store = typeof r.store === 'string' ? r.store : undefined
	const storeUrl = typeof r.storeUrl === 'string' ? r.storeUrl : undefined
	const base: Obj = {
		rating: r.rating,
		date: r.reviewDate,
		languageId: r.languageId,
		// Store-native review id (Chrome UUID, Firefox rating id, Edge review id) —
		// surfaced so an LLM consumer can cite or deep-link a specific review.
		storeReviewId: r.storeReviewId,
		store,
		storeUrl,
	}

	// Chrome: never republish the text. Point the model at the store reviews tab.
	if (r.contentPolicy === 'rating-only' || store === 'CHROME') {
		// `storeUrl` here is the LISTING url (`/detail/<id>`), so appending
		// `/reviews` yields the reviews tab — matching the server's
		// getStoreReviewsUrl('CHROME', …). It does NOT double-append.
		const reviewsUrl = storeUrl ? `${storeUrl}/reviews` : undefined
		return prune({
			...base,
			note: reviewsUrl
				? `Per Chrome Web Store terms, review text is not republished — read the full review at ${reviewsUrl}`
				: 'Per Chrome Web Store terms, review text is not republished.',
		} as Obj)
	}

	// Firefox / Edge: bounded excerpt + source attribution.
	const content = typeof r.content === 'string' ? r.content.slice(0, REVIEW_EXCERPT_MAX_CHARS) : undefined
	return prune({
		...base,
		content,
		contentTruncated: r.contentTruncated === true ? true : undefined,
		note: storeUrl && store ? `Source: ${store}, full review at ${storeUrl}` : undefined,
	} as Obj)
}

/**
 * Curate a page of store user reviews (`get_reviews`). Passes through the
 * keyset `nextCursor` so the model can page, a `count` for quick sizing, and the
 * store-level `aggregate` (rating / count / snapshot date + reviews link) — the
 * bare facts that stay public even for Chrome.
 */
export function shapeReviews(result: unknown, limit: number): Obj {
	const arr = Array.isArray(result)
		? result
		: isObj(result) && Array.isArray(result.items)
			? (result.items as unknown[])
			: []
	const items = arr.slice(0, limit).map(shapeReview)
	const nextCursor = isObj(result) ? result.nextCursor : undefined
	const aggregate = isObj(result) && isObj(result.aggregate) ? compact(result.aggregate) : undefined
	return prune({ count: items.length, nextCursor, aggregate, items } as Obj)
}

/**
 * Curate the install-dialog preview — the consolidated permission prompt the
 * browser shows at install (computed server-side by catalog-api from the
 * manifest's required permissions; source of truth: shared-types/permission-warnings.ts).
 * Reduces each browser's warnings to their human-readable lines for terseness.
 */
export function shapeInstallDialog(preview: unknown): Obj | undefined {
	if (!isObj(preview)) return undefined
	const browser = (b: unknown): Obj | undefined => {
		if (!isObj(b)) return undefined
		const warnings = Array.isArray(b.warnings)
			? (b.warnings as unknown[]).map((w) => (isObj(w) ? w.message : w)).filter(Boolean)
			: []
		return { readsAllData: b.readsAllData === true, warnings }
	}
	const silent = Array.isArray(preview.silentPermissions) ? preview.silentPermissions : []
	const optional = Array.isArray(preview.excluded) ? preview.excluded : []
	const unknown = Array.isArray(preview.unknownPermissions) ? preview.unknownPermissions : []
	return prune({
		chrome: browser(preview.chrome),
		firefox: browser(preview.firefox),
		silentPermissions: silent.length ? silent : undefined,
		optionalExcluded: optional.length ? optional : undefined,
		// Surfaced separately so a developer can tell "silent by design" from
		// "not in our warning table yet" (e.g. a brand-new browser permission).
		unknownPermissions: unknown.length ? unknown : undefined,
	})
}

// Public capability phrase per raw scanner key. We never disclose which tools the
// pipeline runs, and MCP output is public (it lands in chats, screenshots and
// the connector-directory review). Mirrors
// catalog/catalog-frontend/src/lib/scanner-display-names.ts — keep them in sync.
const SCANNER_PHRASES: Readonly<Record<string, string>> = {
	static_scan: 'Manifest & permission analysis',
	jstap: 'Behavioral & obfuscation analysis',
	app_inspector: 'API & capability inspection',
	jsluice: 'Network endpoint & exfiltration analysis',
	clamav: 'Antivirus malware scan',
	wallet_chain: 'Cryptocurrency & wallet abuse',
	obfuscation_detector: 'Obfuscation & evasion detection',
	llm_analysis: 'AI code-intent analysis',
	semgrep: 'Code vulnerability analysis',
	library_hash: 'Known-vulnerable dependency detection',
	yara: 'Malware signature matching',
	threat_intel: 'Threat intelligence correlation',
	link_reputation: 'Outbound link reputation',
}

/** Capability phrase for a scanner key; unknown keys get a generic phrase, never the raw name. */
export function scannerPhrase(scanner: unknown): string | undefined {
	if (typeof scanner !== 'string' || !scanner) return undefined
	return SCANNER_PHRASES[scanner.toLowerCase()] ?? 'Security analysis'
}

/**
 * Some rule ids carry the scanner key as a namespace (`jstap:document-cookie-access`);
 * the same string is often the finding title. Drop a known scanner prefix so the
 * tool name never leaks through the rule or title either.
 */
export function stripScannerPrefix(value: unknown): unknown {
	if (typeof value !== 'string') return value
	const i = value.indexOf(':')
	if (i <= 0) return value
	return value.slice(0, i).toLowerCase() in SCANNER_PHRASES ? value.slice(i + 1) : value
}

/** Curate a finding group to the essentials. */
function shapeFinding(f: unknown): Obj {
	if (!isObj(f)) return { value: compact(f) }
	const locations = Array.isArray(f.locations)
		? (f.locations as unknown[]).slice(0, 5).map((l) => (isObj(l) ? l.file : l))
		: undefined
	return prune({
		scanner: scannerPhrase(f.scanner),
		rule: stripScannerPrefix(f.rule_id ?? f.ruleId),
		severity: f.severity,
		title: stripScannerPrefix(f.title),
		count: f.count,
		files: locations,
	})
}

/** Curate the security view: risk summary + grouped findings (top N per severity). */
export function shapeSecurity(security: unknown, riskSummary: unknown, installDialogPreview?: unknown): Obj {
	const out: Obj = {}

	if (isObj(riskSummary)) {
		// Replace the backend `overallScore` (0 = safest) with the website's
		// `safetyScore` (100 = safest) so the MCP and the site never disagree.
		const { overallScore, ...rest } = riskSummary as Obj
		out.summary = prune({ safetyScore: toSafetyScore(overallScore), ...rest })
	} else if (isObj(security) && isObj(security.riskAssessment)) {
		const ra = security.riskAssessment as Obj
		out.summary = prune({
			safetyScore: toSafetyScore(ra.overallScore),
			riskCategory: ra.riskCategory,
			severityBreakdown: isObj(ra.contributingFactors)
				? (ra.contributingFactors as Obj).severity_breakdown
				: undefined,
		})
	}

	if (isObj(security)) {
		if (isObj(security.scanExecution)) {
			const se = security.scanExecution as Obj
			out.scan = prune({ status: se.status, completedAt: se.completedAt })
		}
		if (isObj(security.findings)) {
			const f = security.findings as Obj
			const bySeverity: Obj = {}
			if (isObj(f.bySeverity)) {
				for (const [sev, rows] of Object.entries(f.bySeverity as Obj)) {
					if (Array.isArray(rows) && rows.length) {
						bySeverity[sev] = rows.slice(0, 8).map(shapeFinding)
						if (rows.length > 8) (bySeverity[sev] as unknown[]).push(`…+${rows.length - 8} more`)
					}
				}
			}
			out.findings = prune({ total: f.total, groupTotal: f.groupTotal, bySeverity })
		}
	}

	// The install-dialog preview is a manifest transform, independent of
	// scanning — surface it even when the extension was never scanned.
	const hasScanData = Object.keys(out).length > 0
	const dialog = shapeInstallDialog(installDialogPreview)
	if (dialog) out.installDialogPreview = dialog

	if (!hasScanData) {
		out.scanned = false
		out.message = 'This extension has not been scanned yet.'
	}
	return out
}

/** The catalog URL an agent can hand the developer for a given catalog id. */
const CATALOG_EXTENSION_URL = 'https://catalog.extenshi.io/extensions/'

/**
 * Shape one row of `security.getSecuritySummaryBatch` for the risk-by-store-id
 * tool.
 *
 * Two things this deliberately does NOT hide:
 *  - `scoredStore` / `scoredVariantId` — the batch resolves a store id through
 *    its cross-store cluster to the record the extension page renders, and
 *    cluster members are scanned independently (the same extension scored 78.55
 *    HIGH on its Chrome record and 80.47 CRITICAL on its Edge one). An agent
 *    reporting a number to a developer must be able to say which listing it
 *    describes.
 *  - a `null` score — "not scanned" is an expected state, not an error, and
 *    must never be flattened into a reassuring 100.
 *
 * `catalogUrl` uses the CANONICAL id so the link lands on the page the score
 * came from without a redirect hop.
 */
export function shapeStoreRiskRow(row: unknown): Obj {
	if (!isObj(row)) return { value: compact(row) }
	const canonicalId =
		typeof row.canonicalExtensionId === 'number' ? row.canonicalExtensionId : row.extensionId
	const scored = row.scoredExtensionId
	return prune({
		storeId: row.storeId,
		store: row.store,
		name: row.extensionName,
		extensionId: canonicalId,
		catalogUrl: typeof canonicalId === 'number' ? `${CATALOG_EXTENSION_URL}${canonicalId}` : undefined,
		safetyScore: toSafetyScore(row.riskScore),
		riskCategory: row.riskCategory,
		severityBreakdown: isObj(row.severityBreakdown) ? row.severityBreakdown : undefined,
		totalFindings: row.totalFindings ?? undefined,
		lastScanDate: row.lastScanDate,
		// Only worth the tokens when the score came from a DIFFERENT listing
		// than the one the caller asked about — that is the case an agent must
		// not silently paper over.
		//
		// NB the asymmetry, which is deliberate: the emitted `extensionId` above
		// is the CANONICAL id (it is what the catalog URL needs), but the test
		// here is against the raw `row.extensionId` — the MEMBER that owns the
		// store id the caller passed in. "Did the score come from the listing I
		// asked about?" is a question about the member, so comparing against the
		// canonical would suppress the label on exactly the clustered rows that
		// need it.
		scoredStore: typeof scored === 'number' && scored !== row.extensionId ? row.scoredStore : undefined,
		scoredVariantId: typeof scored === 'number' && scored !== row.extensionId ? scored : undefined,
		scanned: row.riskCategory == null ? false : undefined,
	})
}

/**
 * Shape a whole risk-by-store-id batch, and say which requested ids the catalog
 * had no listing for — an agent that cannot tell "safe" from "unknown" will
 * report the wrong thing.
 */
export function shapeStoreRiskBatch(
	rows: unknown,
	requested: Array<{ storeId: string; store: string }>,
): Obj {
	const list = Array.isArray(rows) ? rows : []
	const found = new Set(list.filter(isObj).map((row) => `${String(row.store)}:${String(row.storeId)}`))
	const notFound = requested
		.filter((ref) => !found.has(`${ref.store}:${ref.storeId}`))
		.map((ref) => ({ storeId: ref.storeId, store: ref.store }))

	return prune({
		requested: requested.length,
		matched: list.length,
		extensions: list.map(shapeStoreRiskRow),
		notInCatalog: notFound.length > 0 ? notFound : undefined,
		note:
			notFound.length > 0
				? 'notInCatalog means no listing has been scraped for that store id yet — it is NOT a safety verdict.'
				: undefined,
	})
}

// ── market_overview ─────────────────────────────────────────────────────────

/** Facet groups `market_overview` can return, selectable via its `facets` argument. */
export const MARKET_FACETS = [
	'stats',
	'stores',
	'categories',
	'extended',
	'questionnaire',
	'downloads',
] as const
export type MarketFacet = (typeof MARKET_FACETS)[number]

/** Default number of entries kept per open-ended facet list (categories, permissions, sites). */
export const DEFAULT_MARKET_TOP_N = 10
export const MAX_MARKET_TOP_N = 100

export interface MarketOverviewInput {
	scope: 'search' | 'catalog-wide'
	stats?: unknown
	/** Raw facets as the BFF returns them (search facets, or the catalog-wide assembly). */
	facets?: unknown
	note?: string
}

export interface MarketShapeOpts {
	facets?: readonly string[]
	topN?: number
}

/** Extended-facet keys whose value is an open-ended `{ key: count }` map worth trimming. */
const OPEN_ENDED_EXTENDED = ['permissions', 'targetSites'] as const

function num(v: unknown): number {
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** Keep the `topN` largest entries of a `{ key: count }` map; report how many were dropped. */
function topEntries(map: unknown, topN: number): { top: Record<string, number>; omitted: number } {
	if (!isObj(map)) return { top: {}, omitted: 0 }
	const entries = Object.entries(map).sort((a, b) => num(b[1]) - num(a[1]))
	return {
		top: Object.fromEntries(entries.slice(0, topN).map(([k, v]) => [k, num(v)])),
		omitted: Math.max(0, entries.length - topN),
	}
}

/**
 * One category-tree node reduced to what market analysis uses: display name,
 * the slug the `categories` filter accepts, count, and a single store when the
 * category is store-specific. Children are trimmed to `topN` as well.
 */
function compactCategory(node: unknown, topN: number, depth: number): Obj {
	if (!isObj(node)) return { value: compact(node) }
	const children = Array.isArray(node.children) ? node.children : []
	const sorted = [...children].sort((a, b) => num((b as Obj)?.count) - num((a as Obj)?.count))
	return prune({
		name: node.displayName ?? node.name,
		slug: node.filterKey ?? node.slug,
		count: num(node.count ?? (isObj(node._count) ? node._count.snapshots : undefined)),
		store: node.store ?? undefined,
		children:
			depth < 2 && sorted.length > 0
				? sorted.slice(0, topN).map((child) => compactCategory(child, topN, depth + 1))
				: undefined,
		moreChildren: sorted.length > topN && depth < 2 ? sorted.length - topN : undefined,
	})
}

/**
 * Trim a market_overview payload for the model's context: pick the requested
 * facet groups (default: all), cut open-ended lists to the `topN` largest
 * entries, and reduce category nodes to name/slug/count. Counts are passed
 * through unchanged — this shapes the response, it does not recompute data.
 * A `truncated` map says how many entries each trimmed list dropped, so the
 * caller knows when a larger `top_n` would reveal more.
 */
export function shapeMarketOverview(input: MarketOverviewInput, opts: MarketShapeOpts = {}): Obj {
	const requested = (opts.facets ?? []).filter((f): f is MarketFacet =>
		(MARKET_FACETS as readonly string[]).includes(f),
	)
	const want = new Set<MarketFacet>(requested.length > 0 ? requested : MARKET_FACETS)
	const topN = Math.min(MAX_MARKET_TOP_N, Math.max(1, Math.floor(opts.topN ?? DEFAULT_MARKET_TOP_N)))
	const raw = isObj(input.facets) ? input.facets : {}
	const truncated: Record<string, number> = {}
	const facets: Obj = {}

	if (want.has('stores') && raw.stores !== undefined) facets.stores = compact(raw.stores)

	if (want.has('categories')) {
		const tree = Array.isArray(raw.categoryTree) ? raw.categoryTree : undefined
		const flat = Array.isArray(raw.categories) ? raw.categories : undefined
		// The flat list is the same data grouped by slug; the tree is kept when present.
		const source = tree && tree.length > 0 ? tree : flat
		if (source) {
			const sorted = [...source].sort((a, b) => num((b as Obj)?.count) - num((a as Obj)?.count))
			facets.categoryTree = sorted.slice(0, topN).map((node) => compactCategory(node, topN, 1))
			if (sorted.length > topN) truncated.categoryTree = sorted.length - topN
		}
	}

	if (want.has('extended') && isObj(raw.extended)) {
		const extended: Obj = {}
		for (const [key, value] of Object.entries(raw.extended)) {
			if ((OPEN_ENDED_EXTENDED as readonly string[]).includes(key)) {
				const { top, omitted } = topEntries(value, topN)
				extended[key] = top
				if (omitted > 0) truncated[`extended.${key}`] = omitted
			} else {
				extended[key] = compact(value)
			}
		}
		facets.extended = extended
	}

	if (want.has('questionnaire') && raw.questionnaire !== undefined)
		facets.questionnaire = compact(raw.questionnaire)
	if (want.has('downloads') && raw.downloads !== undefined) facets.downloads = compact(raw.downloads)
	if (raw.total !== undefined) facets.total = raw.total

	return prune({
		scope: input.scope,
		stats: want.has('stats') && input.stats ? compact(input.stats) : undefined,
		facets: Object.keys(facets).length > 0 ? facets : undefined,
		topN,
		truncated: Object.keys(truncated).length > 0 ? truncated : undefined,
		note: input.note,
	})
}
