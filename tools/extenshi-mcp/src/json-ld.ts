/**
 * Schema.org SoftwareApplication JSON-LD for an extension's public site.
 *
 * Pure and dependency-free on purpose: the landing-page generator
 * (./landing-page.ts) embeds it, and that generator ships in three places —
 * dojo (through shared-types), the published @extenshi/mcp package and the
 * published @extenshi/cli package. Those two cannot import workspace
 * shared-types at runtime, so they carry copies of this file:
 *
 *   shared-types/json-ld.ts            (canonical — edit here)
 *   tools/extenshi-mcp/src/json-ld.ts  (byte-identical copy)
 *   tools/extenshi-cli/src/json-ld.ts  (byte-identical copy)
 *
 * `landing-page-sync.test.ts` in each package fails when a copy drifts. After
 * editing, run:
 *   cp shared-types/json-ld.ts tools/extenshi-mcp/src/json-ld.ts
 *   cp shared-types/json-ld.ts tools/extenshi-cli/src/json-ld.ts
 *
 * `shared-types/ai-visibility.ts` re-exports everything here, so existing
 * `shared-types/ai-visibility.js` imports keep working.
 */

export interface JsonLdInput {
	extensionName: string
	description: string
	websiteUrl?: string
	authorName?: string
	chromeUrl?: string
	firefoxUrl?: string
	edgeUrl?: string
	privacyPolicyUrl?: string
	/** Free (default) vs paid. Paid still omits a number — we are not the store. */
	offersPrice?: '0' | 'paid'
	/**
	 * Real prices (an Extenshi Pay offer bound to the page). When non-empty they
	 * replace the free offer: one Offer, or an AggregateOffer for several plans.
	 */
	paidOffers?: JsonLdPriceInput[]
	capabilities?: string[]
	/** ISO date; omitted when blank. */
	datePublished?: string
	/** Absolute https screenshot URLs; anything else is dropped. */
	screenshots?: string[]
}

export interface SoftwareApplicationJsonLd {
	'@context': 'https://schema.org'
	'@type': 'SoftwareApplication'
	name: string
	description?: string
	url?: string
	applicationCategory: 'BrowserApplication'
	operatingSystem?: string
	author?: { '@type': 'Organization'; name: string }
	offers?: JsonLdOffer | JsonLdAggregateOffer | JsonLdOffer[]
	installUrl?: string
	sameAs?: string[]
	featureList?: string[]
	privacyPolicy?: string
	screenshot?: string[]
}

export interface JsonLdPriceInput {
	name?: string
	/** Decimal amount in major units ("4.99"). */
	price: string
	/** ISO 4217 code, any case. */
	currency: string
	period?: 'month' | 'year' | 'one-time' | 'lifetime'
}

export interface JsonLdOffer {
	'@type': 'Offer'
	name?: string
	price: string
	priceCurrency: string
	priceSpecification?: {
		'@type': 'UnitPriceSpecification'
		price: string
		priceCurrency: string
		billingDuration: 'P1M' | 'P1Y'
	}
}

export interface JsonLdAggregateOffer {
	'@type': 'AggregateOffer'
	lowPrice: string
	highPrice: string
	priceCurrency: string
	offerCount: number
	offers: JsonLdOffer[]
}

const PRICE_RE = /^\d{1,9}(\.\d{1,4})?$/
const CURRENCY_RE = /^[A-Za-z]{3}$/

/**
 * Offers for real prices: one Offer, an AggregateOffer when every plan is in
 * one currency, else a list. Malformed entries are dropped; null when none is left.
 */
export function jsonLdOffers(
	list: readonly JsonLdPriceInput[],
): JsonLdOffer | JsonLdAggregateOffer | JsonLdOffer[] | null {
	const offers: JsonLdOffer[] = []
	for (const p of list) {
		const price = p.price.trim()
		const currency = p.currency.trim().toUpperCase()
		if (!PRICE_RE.test(price) || !CURRENCY_RE.test(currency)) continue
		const offer: JsonLdOffer = { '@type': 'Offer', price, priceCurrency: currency }
		const name = (p.name ?? '').trim()
		if (name) offer.name = name
		if (p.period === 'month' || p.period === 'year') {
			offer.priceSpecification = {
				'@type': 'UnitPriceSpecification',
				price,
				priceCurrency: currency,
				billingDuration: p.period === 'month' ? 'P1M' : 'P1Y',
			}
		}
		offers.push(offer)
	}
	const [first] = offers
	if (!first) return null
	if (offers.length === 1) return first
	if (offers.some((o) => o.priceCurrency !== first.priceCurrency)) return offers
	const prices = offers.map((o) => Number(o.price))
	const at = (n: number) => offers[prices.indexOf(n)]?.price ?? first.price
	return {
		'@type': 'AggregateOffer',
		lowPrice: at(Math.min(...prices)),
		highPrice: at(Math.max(...prices)),
		priceCurrency: first.priceCurrency,
		offerCount: offers.length,
		offers,
	}
}

function httpUrl(raw: string | undefined): string | null {
	const u = (raw ?? '').trim()
	return /^https?:\/\//i.test(u) ? u : null
}

const OS_FOR: Record<string, string> = {
	chrome: 'Chrome',
	firefox: 'Firefox',
	edge: 'Microsoft Edge',
}

/**
 * Schema.org SoftwareApplication. Only fields we have evidence for are emitted —
 * empty author / URL / install links are omitted rather than faked.
 */
export function generateJsonLd(input: JsonLdInput): SoftwareApplicationJsonLd {
	const name = input.extensionName.trim() || 'Extension'
	const description = input.description.trim()
	const site = httpUrl(input.websiteUrl)
	const author = (input.authorName ?? '').trim()
	const chrome = httpUrl(input.chromeUrl)
	const firefox = httpUrl(input.firefoxUrl)
	const edge = httpUrl(input.edgeUrl)
	const privacy = httpUrl(input.privacyPolicyUrl)
	const features = (input.capabilities ?? []).map((c) => c.trim()).filter(Boolean)
	const screenshots = (input.screenshots ?? []).map((s) => s.trim()).filter((s) => /^https:\/\/\S+$/i.test(s))
	const sameAs = [chrome, firefox, edge].filter((u): u is string => Boolean(u))
	const os = [
		chrome ? OS_FOR.chrome : null,
		firefox ? OS_FOR.firefox : null,
		edge ? OS_FOR.edge : null,
	].filter((x): x is string => Boolean(x))

	const json: SoftwareApplicationJsonLd = {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name,
		applicationCategory: 'BrowserApplication',
	}
	if (description) json.description = description
	if (site) json.url = site
	if (os.length > 0) json.operatingSystem = os.join(', ')
	if (author) json.author = { '@type': 'Organization', name: author }
	const paid = jsonLdOffers(input.paidOffers ?? [])
	if (paid) json.offers = paid
	else if (input.offersPrice !== 'paid') {
		json.offers = { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
	}
	if (sameAs[0]) json.installUrl = sameAs[0]
	if (sameAs.length > 0) json.sameAs = sameAs
	if (features.length > 0) json.featureList = features
	if (privacy) json.privacyPolicy = privacy
	if (screenshots.length > 0) json.screenshot = screenshots
	return json
}

export function generateJsonLdSnippet(input: JsonLdInput): string {
	return `${JSON.stringify(generateJsonLd(input), null, 2)}\n`
}

/**
 * A `<script type="application/ld+json">` tag safe to drop into HTML.
 * `<` is escaped so a description cannot close the script element.
 */
export function jsonLdScriptTag(input: JsonLdInput): string {
	const body = JSON.stringify(generateJsonLd(input)).replace(/</g, '\\u003c')
	return `<script type="application/ld+json">${body}</script>`
}

/** Map a landing-page form onto JSON-LD without a second source of truth. */
export function jsonLdFromLanding(input: {
	extensionName: string
	tagline: string
	description: string
	storeUrls: Partial<Record<'chrome' | 'firefox' | 'edge', string>>
	features: { title: string; description: string }[]
	privacyPolicyUrl: string
	/** Canonical URL of the landing page itself (JSON-LD `url`). */
	homepageUrl?: string
	/** Absolute https screenshot URLs (JSON-LD `screenshot`). */
	screenshots?: string[]
	/** `paid` drops the free offer when no real price is known. Default free. */
	offersPrice?: '0' | 'paid'
	/** Prices of the plans the page shows (bound Pay offers). */
	paidOffers?: JsonLdPriceInput[]
}): JsonLdInput {
	const capabilities = input.features
		.map((f) => {
			const title = f.title.trim()
			const desc = f.description.trim()
			if (!title) return ''
			return desc ? `${title}: ${desc}` : title
		})
		.filter(Boolean)
	const out: JsonLdInput = {
		extensionName: input.extensionName,
		description: input.description.trim() || input.tagline.trim(),
		chromeUrl: input.storeUrls.chrome,
		firefoxUrl: input.storeUrls.firefox,
		edgeUrl: input.storeUrls.edge,
		privacyPolicyUrl: input.privacyPolicyUrl,
		capabilities,
	}
	if (input.homepageUrl) out.websiteUrl = input.homepageUrl
	if (input.screenshots && input.screenshots.length > 0) out.screenshots = input.screenshots
	if (input.offersPrice) out.offersPrice = input.offersPrice
	if (input.paidOffers && input.paidOffers.length > 0) out.paidOffers = input.paidOffers
	return out
}
