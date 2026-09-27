/**
 * Cross-store filter validation for `search_extensions`.
 *
 * Some catalog filters are backed by STORE-SPECIFIC metrics, so combining them
 * with a `stores` filter that excludes every store reporting that metric yields
 * a silently-empty (or misleading) result set. We reject those combinations up
 * front with an actionable message instead of letting the caller "search half
 * the catalog and wonder why nothing matched".
 *
 * Field population (source of truth: catalog/scraper/src):
 *   - weeklyDownloads → Firefox ONLY (`addon.weekly_downloads`). Chrome reports
 *     install counts via `usersNumeric`; Edge via `activeInstallCount`; neither
 *     sets weeklyDownloads. There is no server-side min-usersNumeric filter, so
 *     for Chrome/Edge popularity the only lever is `sortBy: 'popular'`.
 *
 * Kept free of any `fastmcp` import so it stays unit-testable in isolation; the
 * caller (index.ts) turns a returned message into a `UserError`.
 */

export type StoreType = 'CHROME' | 'FIREFOX' | 'EDGE'

interface StoreSpecificFilter {
	/** The arg key whose presence triggers the check. */
	field: string
	/** Stores whose snapshots actually populate the metric this filter needs. */
	supportedStores: readonly StoreType[]
	/** Actionable guidance appended to the conflict message. */
	hint: string
}

export const STORE_SPECIFIC_FILTERS: readonly StoreSpecificFilter[] = [
	{
		field: 'minWeeklyDownloads',
		supportedStores: ['FIREFOX'],
		hint:
			'`minWeeklyDownloads` is a Firefox-only metric — Chrome and Edge do not report weekly ' +
			'downloads (they report install counts). Include FIREFOX in `stores`, drop the `stores` ' +
			'filter, or rank by installs across stores with `sortBy: "popular"` instead.',
	},
]

/**
 * One-line, model-facing summary of every store-specific constraint, derived
 * from the SAME table that enforces them. Injected into the `search_extensions`
 * tool description so the constraint is known BEFORE a call is made — this lets
 * the model avoid composing a request that would only be rejected (and, once
 * read-enforcement is on, would still burn a read credit at the backend). The
 * description (advertised limit) and validateSearchFilters (runtime rejection)
 * can never drift because both read STORE_SPECIFIC_FILTERS.
 */
export function describeStoreConstraints(): string {
	const lines = STORE_SPECIFIC_FILTERS.map(
		(f) =>
			`\`${f.field}\` only applies to ${f.supportedStores.join('/')}; combining it with a \`stores\` filter that excludes those stores is rejected`,
	)
	return `Store-specific constraints (validated client-side, before any request): ${lines.join('; ')}.`
}

/**
 * Returns a human-readable conflict message when the args combine a
 * store-specific filter with a `stores` set that supports none of it; otherwise
 * null. A missing/empty `stores` filter never conflicts (the metric simply
 * narrows results to the stores that report it).
 */
export function validateSearchFilters(args: Record<string, unknown>): string | null {
	const stores = Array.isArray(args.stores) ? (args.stores as string[]) : null
	if (!stores || stores.length === 0) return null
	for (const f of STORE_SPECIFIC_FILTERS) {
		if (args[f.field] === undefined || args[f.field] === null) continue
		const supported = f.supportedStores.some((s) => stores.includes(s))
		if (!supported) {
			return `Filter conflict: ${f.hint} (requested stores: ${stores.join(', ')})`
		}
	}
	return null
}
