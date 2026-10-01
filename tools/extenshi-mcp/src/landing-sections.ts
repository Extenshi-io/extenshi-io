/**
 * Page generator, schema v2: a full, declarative extension homepage.
 *
 * A v1 form (no `schemaVersion`) is still rendered by `buildLandingPage` in
 * landing-page.ts, unchanged and byte-identical — `renderLandingForm` below
 * only takes the v2 path when `schemaVersion === 2`. Everything v2 adds is an
 * optional field on the same LandingForm, so an old row, an old client and an
 * old server all keep working (see landing-page-v2.test.ts).
 *
 * What v2 adds, all declarative data — never markup:
 *   - ordered sections with `hidden` (hero, about, features, screenshots,
 *     how-it-works, pricing, faq, testimonials, store-badges, changelog, links);
 *   - theme tokens: palette per light/dark (or `auto` = both, by
 *     prefers-color-scheme), fonts from LANDING_FONTS, radius, width;
 *   - per-locale content (`locales`) rendered as one page per locale with
 *     hreflang alternates;
 *   - SEO / Open Graph fields and JSON-LD (SoftwareApplication + FAQPage).
 *
 * Output rules are the v1 rules: no JavaScript, every string HTML-escaped,
 * links scheme-clamped (safeHref), images clamped (safeImageSrc), CSS built
 * only from allowlists and validated hex colours. The hosted CSP
 * (`default-src 'none'`, inline styles only) therefore holds unchanged.
 *
 * Testimonials must be attributed: a quote without an author and a public
 * https source is refused, never rendered. Drafting tools never write
 * testimonials — only the developer supplies them.
 *
 * SINGLE SOURCE, THREE COPIES — same scheme as landing-page.ts:
 *   shared-types/landing-sections.ts            (canonical — edit here)
 *   tools/extenshi-mcp/src/landing-sections.ts  (copy)
 *   tools/extenshi-cli/src/landing-sections.ts  (copy)
 * After editing, run:
 *   sed "s#from 'shared-types\/#from './#" shared-types/landing-sections.ts > tools/extenshi-mcp/src/landing-sections.ts
 *   sed "s#from 'shared-types\/#from './#" shared-types/landing-sections.ts > tools/extenshi-cli/src/landing-sections.ts
 */

import { generateJsonLd, jsonLdFromLanding } from './json-ld.js'
import {
	absoluteImageUrl,
	buildLandingPage,
	canonicalUrl,
	esc,
	HEX_COLOR,
	type LandingBrowser,
	type LandingForm,
	landingFormToInput,
	landingLogoSvgProblem,
	landingPageWarnings,
	safeHref,
	safeImageSrc,
	safeSupportHref,
	str,
} from './landing-page.js'

export const LANDING_SCHEMA_VERSION = 2 as const

export const LANDING_SECTION_TYPES = [
	'hero',
	'about',
	'features',
	'screenshots',
	'how-it-works',
	'pricing',
	'faq',
	'testimonials',
	'store-badges',
	'changelog',
	'links',
] as const
export type LandingSectionType = (typeof LANDING_SECTION_TYPES)[number]

export const LANDING_V2_LIMITS = {
	sections: 20,
	sectionId: 40,
	title: 120,
	intro: 600,
	body: 6000,
	items: 24,
	screenshots: 12,
	steps: 8,
	plans: 6,
	planFeatures: 12,
	faq: 20,
	testimonials: 12,
	quote: 600,
	changelog: 20,
	changelogNotes: 12,
	links: 12,
	shortText: 120,
	text: 500,
	locales: 10,
	seoTitle: 70,
	seoDescription: 300,
} as const

/** A section id: lowercase slug, used as the HTML id and as the locale override key. */
export const LANDING_SECTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

interface SectionBase<T extends LandingSectionType> {
	id: string
	type: T
	/** Kept in the form, left out of the page. */
	hidden?: boolean
	/** Section heading; each type has a default (LANDING_UI_DEFAULTS). */
	title?: string
	intro?: string
}

export interface LandingHeroSection extends SectionBase<'hero'> {
	/** Defaults to extensionName. */
	headline?: string
	/** Defaults to tagline. */
	subheadline?: string
	/** Store buttons under the headline. Default true. */
	showBadges?: boolean
}

export interface LandingAboutSection extends SectionBase<'about'> {
	/** Plain text; blank lines separate paragraphs. */
	body: string
}

export interface LandingFeaturesSection extends SectionBase<'features'> {
	items: { title: string; description?: string }[]
}

export interface LandingScreenshotsSection extends SectionBase<'screenshots'> {
	items: { url: string; alt?: string; caption?: string }[]
}

export interface LandingHowItWorksSection extends SectionBase<'how-it-works'> {
	steps: { title: string; description?: string }[]
}

export type LandingPlanPeriod = 'one-time' | 'month' | 'year' | 'lifetime'

export interface LandingPricingPlan {
	name?: string
	/** Display price ("$4.99", "Free"). Overwritten from the Pay offer when offerSku is set. */
	price?: string
	period?: LandingPlanPeriod
	description?: string
	features?: string[]
	highlighted?: boolean
	/**
	 * SKU of an Extenshi Pay offer of this project. When set, the hosted page
	 * takes price, period and — when not given here — name, description and
	 * features from the live offer, so the page cannot advertise a price the
	 * checkout does not charge.
	 */
	offerSku?: string
	ctaLabel?: string
	/** Where the plan button goes. Default: the first store listing. */
	ctaUrl?: string
}

export interface LandingPricingSection extends SectionBase<'pricing'> {
	plans: LandingPricingPlan[]
	note?: string
}

export interface LandingFaqSection extends SectionBase<'faq'> {
	items: { question: string; answer: string }[]
}

export interface LandingTestimonial {
	quote: string
	/** The person's name as published at the source. Required. */
	author: string
	role?: string
	/** Public https URL where they said it (store review, post). Required. */
	sourceUrl: string
	sourceLabel?: string
}

export interface LandingTestimonialsSection extends SectionBase<'testimonials'> {
	items: LandingTestimonial[]
}

export interface LandingStoreBadgesSection extends SectionBase<'store-badges'> {
	/** Order and subset of stores; default every store with a URL. */
	browsers?: LandingBrowser[]
}

export interface LandingChangelogSection extends SectionBase<'changelog'> {
	entries: { version: string; date?: string; notes: string[] }[]
}

export interface LandingLinksSection extends SectionBase<'links'> {
	items?: { label: string; url: string }[]
	/** Also list privacy / support / feedback / terms from the form. Default true. */
	includeProjectLinks?: boolean
}

export type LandingSection =
	| LandingHeroSection
	| LandingAboutSection
	| LandingFeaturesSection
	| LandingScreenshotsSection
	| LandingHowItWorksSection
	| LandingPricingSection
	| LandingFaqSection
	| LandingTestimonialsSection
	| LandingStoreBadgesSection
	| LandingChangelogSection
	| LandingLinksSection

/**
 * System font stacks only (after modern-font-stacks, CC0). A web font would
 * need a font-src exception in the hosted CSP and a third-party request from
 * every visitor; a stack renders instantly and requests nothing.
 */
export const LANDING_FONTS = {
	default: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	'system-ui': 'system-ui, sans-serif',
	'neo-grotesque': 'Inter, Roboto, "Helvetica Neue", "Arial Nova", "Nimbus Sans", Arial, sans-serif',
	humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
	'geometric-humanist': 'Avenir, Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif',
	'classical-humanist': 'Optima, Candara, "Noto Sans", source-sans-pro, sans-serif',
	'rounded-sans':
		'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT", "Arial Rounded MT Bold", Calibri, source-sans-pro, sans-serif',
	hyperlegible: '"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", Lexend, Verdana, Tahoma, sans-serif',
	industrial:
		'Bahnschrift, "DIN Alternate", "Franklin Gothic Medium", "Nimbus Sans Narrow", sans-serif-condensed, sans-serif',
	transitional: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif',
	'old-style': '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, serif',
	'slab-serif': 'Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", "Sitka Small", serif',
	didone: 'Didot, "Bodoni MT", "Noto Serif Display", "URW Palladio L", P052, Sylfaen, serif',
	monospace:
		'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace',
} as const
export type LandingFontId = keyof typeof LANDING_FONTS

export interface LandingPalette {
	accent?: string
	/** Text on accent-coloured buttons. */
	accentText?: string
	background?: string
	surface?: string
	text?: string
	muted?: string
	border?: string
}

export interface LandingThemeTokens {
	/** `auto` ships both palettes and follows prefers-color-scheme. Default: form.theme. */
	mode?: 'light' | 'dark' | 'auto'
	light?: LandingPalette
	dark?: LandingPalette
	headingFont?: LandingFontId
	bodyFont?: LandingFontId
	radius?: 'none' | 'small' | 'medium' | 'large'
	width?: 'narrow' | 'normal' | 'wide'
}

export interface LandingSeo {
	/** <title> and og:title. Default "{name} — {tagline}". */
	title?: string
	/** meta description and og:description. Default description or tagline. */
	description?: string
	/** og:image; default the first screenshot. https only. */
	ogImageUrl?: string
	/** Twitter/X handle for twitter:site. */
	twitterSite?: string
	/** Publisher name for JSON-LD author. */
	authorName?: string
	/** Adds robots noindex — for a page that must stay out of search. */
	noindex?: boolean
}

export const LANDING_UI_DEFAULTS = {
	addToChrome: 'Add to Chrome',
	getForFirefox: 'Get for Firefox',
	getForEdge: 'Get for Edge',
	screenshots: 'Screenshots',
	features: 'Features',
	howItWorks: 'How it works',
	pricing: 'Pricing',
	faq: 'Frequently asked questions',
	testimonials: 'What people say',
	storeBadges: 'Get it for your browser',
	changelog: 'Changelog',
	links: 'Links',
	privacy: 'Privacy policy',
	support: 'Support',
	feedback: 'Share feedback',
	terms: 'License & refunds',
	install: 'Install',
	popular: 'Most popular',
	perMonth: '/ month',
	perYear: '/ year',
	oneTime: 'one-time',
	lifetime: 'lifetime',
	source: 'Source',
	languages: 'Languages',
} as const
export type LandingUiKey = keyof typeof LANDING_UI_DEFAULTS

export interface LandingLocaleContent {
	extensionName?: string
	tagline?: string
	description?: string
	seo?: { title?: string; description?: string; ogImageUrl?: string }
	ui?: Partial<Record<LandingUiKey, string>>
	/**
	 * Per-section overrides keyed by section id, in the section's own shape.
	 * Only string values are taken (arrays merge by index), so a translation
	 * can change words and localized screenshot URLs, never structure.
	 */
	sections?: Record<string, Record<string, unknown>>
}

/** The optional fields v2 adds to LandingForm. */
export interface LandingV2Fields {
	schemaVersion?: 2
	sections?: LandingSection[]
	tokens?: LandingThemeTokens
	seo?: LandingSeo
	/** Locale of the base content. Default `en`. */
	defaultLocale?: string
	locales?: Record<string, LandingLocaleContent>
	ui?: Partial<Record<LandingUiKey, string>>
	/** Hosted uninstall-feedback form (extenshi hosted artifact). */
	uninstallUrl?: string
	/** License terms & refunds page (Extenshi Pay hosted artifact). */
	termsUrl?: string
}

export interface LandingProblem {
	/** JSON path into the form, e.g. `sections[3].items[0].sourceUrl`. */
	path: string
	severity: 'error' | 'warning'
	message: string
	/** What to change to fix it. */
	fix: string
}

// ─── Locales ────────────────────────────────────────────────────────────────

const LOCALE_RE = /^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{4}))?(?:[-_]([a-zA-Z]{2}|\d{3}))?$/

/**
 * `pt_BR`, `pt-br`, `PT-BR` → `pt-BR` (BCP 47, as hreflang and <html lang>
 * want it). Accepts the Chrome `_locales` spelling used by the localization
 * workflow. Null when the value is not a language tag.
 */
export function normalizeLandingLocale(raw: unknown): string | null {
	const m = LOCALE_RE.exec(str(raw))
	if (!m) return null
	const [, lang, script, region] = m
	let tag = (lang as string).toLowerCase()
	if (script) tag += `-${script.charAt(0).toUpperCase()}${script.slice(1).toLowerCase()}`
	if (region) tag += `-${region.toUpperCase()}`
	return tag
}

/** URL path segment for a locale: lowercase BCP 47 (`pt-br`). */
export function landingLocaleSlug(locale: string): string {
	return (normalizeLandingLocale(locale) ?? locale).toLowerCase()
}

export function landingDefaultLocale(form: LandingForm): string {
	return normalizeLandingLocale(form.defaultLocale) ?? 'en'
}

/** Default locale first, then every valid translated locale (deduplicated, capped). */
export function landingLocales(form: LandingForm): string[] {
	const def = landingDefaultLocale(form)
	const out = [def]
	if (form.schemaVersion !== 2 || !form.locales || typeof form.locales !== 'object') return out
	for (const key of Object.keys(form.locales)) {
		const tag = normalizeLandingLocale(key)
		if (tag && !out.includes(tag) && out.length <= LANDING_V2_LIMITS.locales) out.push(tag)
	}
	return out
}

/** Absolute URL of a locale's page: the default locale lives at `base`, others at `base/{slug}`. */
export function landingLocaleUrl(base: string, locale: string, defaultLocale: string): string {
	if (!base) return ''
	if (landingLocaleSlug(locale) === landingLocaleSlug(defaultLocale)) return base
	return `${base.replace(/\/+$/, '')}/${landingLocaleSlug(locale)}`
}

function localeEntry(form: LandingForm, locale: string): LandingLocaleContent | null {
	if (!form.locales) return null
	for (const [key, value] of Object.entries(form.locales)) {
		if (normalizeLandingLocale(key) === locale && value && typeof value === 'object') return value
	}
	return null
}

/** Strings from `over` replace strings in `base`; arrays merge by index; structure comes from `base`. */
function mergeText(base: unknown, over: unknown): unknown {
	if (typeof base === 'string') return typeof over === 'string' ? over : base
	if (Array.isArray(base)) return Array.isArray(over) ? base.map((b, i) => mergeText(b, over[i])) : base
	if (base && typeof base === 'object') {
		if (!over || typeof over !== 'object' || Array.isArray(over)) return base
		const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
		for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
			if (key === 'id' || key === 'type') continue
			if (key in out) out[key] = mergeText(out[key], value)
			else if (typeof value === 'string') out[key] = value
		}
		return out
	}
	return base
}

/** The form as it reads in `locale` (the base form for the default locale). */
export function localizeLandingForm(form: LandingForm, locale: string): LandingForm {
	const tag = normalizeLandingLocale(locale)
	if (!tag || tag === landingDefaultLocale(form)) return form
	const entry = localeEntry(form, tag)
	if (!entry) return form
	const out: LandingForm = { ...form }
	for (const key of ['extensionName', 'tagline', 'description'] as const) {
		if (typeof entry[key] === 'string' && str(entry[key])) out[key] = entry[key] as string
	}
	if (entry.seo)
		out.seo = mergeText({ title: '', description: '', ogImageUrl: '', ...form.seo }, entry.seo) as LandingSeo
	if (entry.ui) out.ui = { ...form.ui, ...pickStrings(entry.ui) }
	if (entry.sections && Array.isArray(form.sections)) {
		out.sections = form.sections.map((s) =>
			s && entry.sections?.[s.id] ? (mergeText(s, entry.sections[s.id]) as LandingSection) : s,
		)
	}
	return out
}

function pickStrings(o: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(o)) if (typeof v === 'string') out[k] = v
	return out
}

// ─── Colours ────────────────────────────────────────────────────────────────

const PALETTES: Record<'light' | 'dark', Required<LandingPalette>> = {
	light: {
		accent: '#5e5ce6',
		accentText: '#ffffff',
		background: '#ffffff',
		surface: '#f6f7fa',
		text: '#1f2430',
		muted: '#5b6372',
		border: '#e5e8ef',
	},
	dark: {
		accent: '#5e5ce6',
		accentText: '#ffffff',
		background: '#0f1115',
		surface: '#171a21',
		text: '#e8eaf0',
		muted: '#9aa1b2',
		border: '#262b36',
	},
}

function hexRgb(hex: string): [number, number, number] | null {
	if (!HEX_COLOR.test(hex)) return null
	let h = hex.slice(1)
	if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('')
	else if (h.length === 8) h = h.slice(0, 6)
	else if (h.length !== 6) return null
	return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG 2 contrast ratio of two hex colours, or null when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
	const lum = (hex: string) => {
		const rgb = hexRgb(hex)
		if (!rgb) return null
		const [r, g, bl] = rgb.map((v) => {
			const c = v / 255
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
		}) as [number, number, number]
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const la = lum(a)
	const lb = lum(b)
	if (la === null || lb === null) return null
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function resolvePalette(form: LandingForm, mode: 'light' | 'dark'): Required<LandingPalette> {
	const base = { ...PALETTES[mode] }
	const accent = str(form.accentColor)
	if (HEX_COLOR.test(accent)) base.accent = accent
	const custom = form.tokens?.[mode]
	if (custom && typeof custom === 'object') {
		for (const key of Object.keys(base) as (keyof LandingPalette)[]) {
			const v = str(custom[key])
			if (HEX_COLOR.test(v)) base[key] = v
		}
	}
	return base
}

function themeMode(form: LandingForm): 'light' | 'dark' | 'auto' {
	const m = form.tokens?.mode
	if (m === 'light' || m === 'dark' || m === 'auto') return m
	return form.theme === 'light' ? 'light' : 'dark'
}

/** Own-property check (Object.hasOwn needs lib es2022, which not every consumer compiles with). */
function hasOwn(o: object, key: PropertyKey): boolean {
	return Object.hasOwn(o, key)
}

const RADIUS = { none: '0', small: '6px', medium: '12px', large: '20px' } as const
const WIDTH = { narrow: '720px', normal: '880px', wide: '1080px' } as const

function font(id: unknown): string {
	return typeof id === 'string' && hasOwn(LANDING_FONTS, id)
		? LANDING_FONTS[id as LandingFontId]
		: LANDING_FONTS.default
}

// ─── Validation ─────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TWITTER_RE = /^@?[A-Za-z0-9_]{1,15}$/
const HTTPS_RE = /^https:\/\/[^\s"'<>\\]+$/i
const HTTP_RE = /^https?:\/\/[^\s"'<>\\]+$/i

const SECTION_TITLE_KEY: Partial<Record<LandingSectionType, LandingUiKey>> = {
	features: 'features',
	screenshots: 'screenshots',
	'how-it-works': 'howItWorks',
	pricing: 'pricing',
	faq: 'faq',
	testimonials: 'testimonials',
	'store-badges': 'storeBadges',
	changelog: 'changelog',
	links: 'links',
}

/**
 * Everything wrong with a form, as actionable problems. `error` means the
 * hosted publish refuses the form; `warning` means it renders but something
 * was dropped, defaulted or is likely unintended. For a v1 form this is
 * landingPageWarnings() as warnings — v1 validation is unchanged.
 */
export function landingFormProblems(form: LandingForm): LandingProblem[] {
	const out: LandingProblem[] = []
	const err = (path: string, message: string, fix: string) =>
		out.push({ path, severity: 'error', message, fix })
	const warn = (path: string, message: string, fix: string) =>
		out.push({ path, severity: 'warning', message, fix })

	for (const message of landingPageWarnings(landingFormToInput(form))) {
		out.push({ path: warningPath(message), severity: 'warning', message, fix: 'See the message.' })
	}
	const hasV2 =
		form.sections !== undefined ||
		form.tokens !== undefined ||
		form.locales !== undefined ||
		form.seo !== undefined
	if (form.schemaVersion !== 2) {
		if (hasV2) {
			err(
				'schemaVersion',
				'sections, tokens, seo and locales are only read when schemaVersion is 2',
				'Set "schemaVersion": 2.',
			)
		}
		return out
	}

	const sections = form.sections
	if (sections !== undefined && !Array.isArray(sections)) {
		err('sections', 'sections must be an array', 'Pass an ordered array of section objects.')
	}
	const list = Array.isArray(sections) ? sections : []
	if (list.length === 0) {
		warn(
			'sections',
			'no sections — the page renders only the hero defaults',
			'Add sections, e.g. from draft_landing_page.',
		)
	}
	if (list.length > LANDING_V2_LIMITS.sections) {
		err('sections', `more than ${LANDING_V2_LIMITS.sections} sections`, 'Merge or remove sections.')
	}
	if (list.length > 0 && !list.some((s) => s && typeof s === 'object' && s.type === 'hero' && !s.hidden)) {
		warn(
			'sections',
			'no visible hero section — the page has no <h1> and no top install button',
			'Add { "id": "hero", "type": "hero" } first.',
		)
	}
	const ids = new Set<string>()
	for (const [i, raw] of list.entries()) {
		const p = `sections[${i}]`
		if (!raw || typeof raw !== 'object') {
			err(p, 'a section must be an object', 'Replace it with { "id": "...", "type": "..." }.')
			continue
		}
		const s = raw as LandingSection
		if (!(LANDING_SECTION_TYPES as readonly string[]).includes(s.type)) {
			err(
				`${p}.type`,
				`unknown section type "${String(s.type)}"`,
				`Use one of: ${LANDING_SECTION_TYPES.join(', ')}.`,
			)
			continue
		}
		if (typeof s.id !== 'string' || !LANDING_SECTION_ID.test(s.id)) {
			err(`${p}.id`, 'id must be a lowercase slug (a-z, 0-9, -; up to 40 chars)', `Use e.g. "${s.type}".`)
		} else if (ids.has(s.id)) {
			err(`${p}.id`, `duplicate section id "${s.id}"`, 'Give every section a unique id.')
		} else ids.add(s.id)
		textLimit(out, `${p}.title`, s.title, LANDING_V2_LIMITS.title)
		textLimit(out, `${p}.intro`, s.intro, LANDING_V2_LIMITS.intro)
		sectionProblems(s, p, err, warn, form)
	}

	const tokens = form.tokens
	if (tokens && typeof tokens === 'object') {
		if (tokens.mode !== undefined && !['light', 'dark', 'auto'].includes(tokens.mode)) {
			err('tokens.mode', `unknown mode "${String(tokens.mode)}"`, 'Use light, dark or auto.')
		}
		for (const key of ['headingFont', 'bodyFont'] as const) {
			const v = tokens[key]
			if (v !== undefined && !(typeof v === 'string' && hasOwn(LANDING_FONTS, v))) {
				err(
					`tokens.${key}`,
					`font "${String(v)}" is not in the allowlist`,
					`Use one of: ${Object.keys(LANDING_FONTS).join(', ')}.`,
				)
			}
		}
		if (tokens.radius !== undefined && !hasOwn(RADIUS, tokens.radius)) {
			err('tokens.radius', `unknown radius "${String(tokens.radius)}"`, 'Use none, small, medium or large.')
		}
		if (tokens.width !== undefined && !hasOwn(WIDTH, tokens.width)) {
			err('tokens.width', `unknown width "${String(tokens.width)}"`, 'Use narrow, normal or wide.')
		}
		for (const mode of ['light', 'dark'] as const) {
			const pal = tokens[mode]
			if (!pal) continue
			for (const [key, value] of Object.entries(pal)) {
				if (value !== undefined && !HEX_COLOR.test(str(value))) {
					err(`tokens.${mode}.${key}`, `"${String(value)}" is not a hex colour`, 'Use #rgb or #rrggbb.')
				}
			}
		}
	}
	const mode = themeMode(form)
	for (const pmode of mode === 'auto' ? (['light', 'dark'] as const) : [mode]) {
		const pal = resolvePalette(form, pmode)
		const body = contrastRatio(pal.text, pal.background) ?? 21
		if (body < 4.5) {
			warn(
				`tokens.${pmode}.text`,
				`text on background contrast is ${body.toFixed(2)}:1 (WCAG AA needs 4.5:1)`,
				'Darken the text or lighten the background (or the reverse).',
			)
		}
		const button = contrastRatio(pal.accentText, pal.accent) ?? 21
		if (button < 4.5) {
			warn(
				`tokens.${pmode}.accentText`,
				`button text on accent contrast is ${button.toFixed(2)}:1 (WCAG AA needs 4.5:1)`,
				'Set accentText to #000000 or #ffffff, whichever contrasts with the accent.',
			)
		}
	}

	const seo = form.seo
	if (seo && typeof seo === 'object') {
		textLimit(out, 'seo.title', seo.title, LANDING_V2_LIMITS.seoTitle)
		textLimit(out, 'seo.description', seo.description, LANDING_V2_LIMITS.seoDescription)
		if (str(seo.title).length > 60)
			warn('seo.title', 'titles over 60 characters are usually cut in search results', 'Shorten it.')
		if (str(seo.description).length > 160)
			warn(
				'seo.description',
				'descriptions over 160 characters are usually cut in search results',
				'Shorten it.',
			)
		if (str(seo.ogImageUrl) && !HTTPS_RE.test(str(seo.ogImageUrl))) {
			err(
				'seo.ogImageUrl',
				'og:image must be an absolute https URL',
				'Upload it with upload_project_media and use the returned URL.',
			)
		}
		if (str(seo.twitterSite) && !TWITTER_RE.test(str(seo.twitterSite))) {
			err('seo.twitterSite', 'not a Twitter/X handle', 'Use e.g. "@extenshi".')
		}
	}

	for (const key of ['uninstallUrl', 'termsUrl'] as const) {
		const v = str(form[key])
		if (v && !HTTP_RE.test(v))
			err(key, 'must be an http(s) URL', 'Use the hosted artifact URL from get_project_state.')
	}
	uiProblems(out, 'ui', form.ui)

	const def = form.defaultLocale
	if (def !== undefined && !normalizeLandingLocale(def)) {
		err('defaultLocale', `"${String(def)}" is not a language tag`, 'Use e.g. "en" or "pt-BR".')
	}
	const locales = form.locales
	if (locales !== undefined) {
		if (!locales || typeof locales !== 'object' || Array.isArray(locales)) {
			err('locales', 'locales must be an object keyed by locale', 'Use { "de": { ... }, "pt-BR": { ... } }.')
		} else {
			const keys = Object.keys(locales)
			if (keys.length > LANDING_V2_LIMITS.locales) {
				err('locales', `more than ${LANDING_V2_LIMITS.locales} locales`, 'Host the most-used locales only.')
			}
			const seen = new Set<string>([landingDefaultLocale(form)])
			for (const key of keys) {
				const p = `locales.${key}`
				const tag = normalizeLandingLocale(key)
				if (!tag) {
					err(p, `"${key}" is not a language tag`, 'Use e.g. "de", "pt-BR" or "pt_BR".')
					continue
				}
				if (seen.has(tag)) {
					err(
						p,
						`locale ${tag} is listed twice (or is the default locale)`,
						'Keep one entry per locale; the base content is the default locale.',
					)
					continue
				}
				seen.add(tag)
				const entry = locales[key]
				if (!entry || typeof entry !== 'object') {
					err(p, 'a locale entry must be an object', 'Use { "tagline": "...", "sections": { ... } }.')
					continue
				}
				uiProblems(out, `${p}.ui`, entry.ui)
				for (const id of Object.keys(entry.sections ?? {})) {
					if (!ids.has(id))
						err(
							`${p}.sections.${id}`,
							`no section with id "${id}"`,
							`Use one of: ${[...ids].join(', ') || '(no sections)'}.`,
						)
				}
				for (const s of list) {
					if (!s || s.hidden || !ids.has(s.id)) continue
					const titleKey = SECTION_TITLE_KEY[s.type]
					if (!titleKey) continue
					const translated = entry.sections?.[s.id]?.title
					if (!str(s.title) && typeof translated !== 'string' && !str(entry.ui?.[titleKey])) {
						warn(
							`${p}.sections.${s.id}.title`,
							`section "${s.id}" shows the default English heading "${LANDING_UI_DEFAULTS[titleKey]}" on the ${tag} page`,
							`Set locales.${key}.ui.${titleKey} (or locales.${key}.sections.${s.id}.title).`,
						)
					}
				}
			}
		}
	}
	return out
}

function warningPath(message: string): string {
	const m = /^([a-z][A-Za-z]*(?:\[\d+\])?(?:\.[A-Za-z]+)?) (?:is|was) /.exec(message)
	return m?.[1] ?? '(form)'
}

function textLimit(out: LandingProblem[], path: string, value: unknown, max: number) {
	if (value === undefined) return
	if (typeof value !== 'string') {
		out.push({ path, severity: 'error', message: 'must be a string', fix: 'Pass plain text.' })
	} else if (value.length > max) {
		out.push({ path, severity: 'error', message: `longer than ${max} characters`, fix: 'Shorten it.' })
	}
}

function uiProblems(out: LandingProblem[], path: string, ui: unknown) {
	if (ui === undefined) return
	if (!ui || typeof ui !== 'object') {
		out.push({
			path,
			severity: 'error',
			message: 'ui must be an object',
			fix: 'Use { "install": "Installer" }.',
		})
		return
	}
	for (const [key, value] of Object.entries(ui)) {
		if (!hasOwn(LANDING_UI_DEFAULTS, key)) {
			out.push({
				path: `${path}.${key}`,
				severity: 'error',
				message: `unknown ui string "${key}"`,
				fix: `Use one of: ${Object.keys(LANDING_UI_DEFAULTS).join(', ')}.`,
			})
		} else textLimit(out, `${path}.${key}`, value, LANDING_V2_LIMITS.shortText)
	}
}

function itemsArray(
	value: unknown,
	path: string,
	max: number,
	err: (p: string, m: string, f: string) => void,
	required = true,
): unknown[] {
	if (value === undefined && !required) return []
	if (!Array.isArray(value)) {
		err(path, 'must be an array', 'Pass a list (it may be empty).')
		return []
	}
	if (value.length > max) err(path, `more than ${max} entries`, `Keep the first ${max}.`)
	return value
}

function sectionProblems(
	s: LandingSection,
	p: string,
	err: (p: string, m: string, f: string) => void,
	warn: (p: string, m: string, f: string) => void,
	form: LandingForm,
) {
	const L = LANDING_V2_LIMITS
	const sub: LandingProblem[] = []
	const t = (path: string, v: unknown, max: number) => textLimit(sub, path, v, max)
	switch (s.type) {
		case 'hero':
			t(`${p}.headline`, s.headline, L.title)
			t(`${p}.subheadline`, s.subheadline, L.text)
			break
		case 'about':
			if (!str(s.body))
				err(`${p}.body`, 'about needs a body', 'Write a few sentences, or remove the section.')
			t(`${p}.body`, s.body, L.body)
			break
		case 'features':
			for (const [i, item] of itemsArray(s.items, `${p}.items`, L.items, err).entries()) {
				const it = item as { title?: unknown; description?: unknown }
				if (!str(it?.title))
					err(`${p}.items[${i}].title`, 'feature needs a title', 'Add a title or remove the item.')
				t(`${p}.items[${i}].title`, it?.title, L.shortText)
				t(`${p}.items[${i}].description`, it?.description, L.text)
			}
			break
		case 'screenshots':
			for (const [i, item] of itemsArray(s.items, `${p}.items`, L.screenshots, err).entries()) {
				const it = item as { url?: unknown; alt?: unknown; caption?: unknown }
				if (!safeImageSrc(it?.url)) {
					err(
						`${p}.items[${i}].url`,
						'not an https URL, relative path or raster data: image',
						'Upload the image with upload_project_media and use the returned URL.',
					)
				}
				t(`${p}.items[${i}].alt`, it?.alt, 200)
				t(`${p}.items[${i}].caption`, it?.caption, L.text)
				if (!str(it?.alt))
					warn(`${p}.items[${i}].alt`, 'screenshot has no alt text', 'Describe what the screenshot shows.')
			}
			break
		case 'how-it-works':
			for (const [i, item] of itemsArray(s.steps, `${p}.steps`, L.steps, err).entries()) {
				const it = item as { title?: unknown; description?: unknown }
				if (!str(it?.title))
					err(`${p}.steps[${i}].title`, 'step needs a title', 'Add a title or remove the step.')
				t(`${p}.steps[${i}].title`, it?.title, L.shortText)
				t(`${p}.steps[${i}].description`, it?.description, L.text)
			}
			break
		case 'pricing':
			t(`${p}.note`, s.note, L.text)
			for (const [i, item] of itemsArray(s.plans, `${p}.plans`, L.plans, err).entries()) {
				const plan = item as LandingPricingPlan
				const pp = `${p}.plans[${i}]`
				if (!str(plan?.offerSku) && !str(plan?.name))
					err(`${pp}.name`, 'plan needs a name', 'Set name, or offerSku to take it from the Pay offer.')
				if (!str(plan?.offerSku) && !str(plan?.price))
					err(
						`${pp}.price`,
						'plan needs a price',
						'Set price (e.g. "Free", "$4.99"), or offerSku to take it from the Pay offer.',
					)
				if (plan?.period !== undefined && !['one-time', 'month', 'year', 'lifetime'].includes(plan.period)) {
					err(
						`${pp}.period`,
						`unknown period "${String(plan.period)}"`,
						'Use one-time, month, year or lifetime.',
					)
				}
				t(`${pp}.name`, plan?.name, L.shortText)
				t(`${pp}.price`, plan?.price, 40)
				t(`${pp}.description`, plan?.description, L.text)
				t(`${pp}.ctaLabel`, plan?.ctaLabel, 60)
				if (str(plan?.ctaUrl) && !HTTP_RE.test(str(plan?.ctaUrl)))
					err(`${pp}.ctaUrl`, 'must be an http(s) URL', 'Remove it to link the store listing.')
				for (const [j, f] of itemsArray(
					plan?.features,
					`${pp}.features`,
					L.planFeatures,
					err,
					false,
				).entries()) {
					t(`${pp}.features[${j}]`, f, L.shortText)
				}
			}
			break
		case 'faq':
			for (const [i, item] of itemsArray(s.items, `${p}.items`, L.faq, err).entries()) {
				const it = item as { question?: unknown; answer?: unknown }
				if (!str(it?.question) || !str(it?.answer))
					err(
						`${p}.items[${i}]`,
						'FAQ entry needs a question and an answer',
						'Fill both or remove the entry.',
					)
				t(`${p}.items[${i}].question`, it?.question, L.title)
				t(`${p}.items[${i}].answer`, it?.answer, L.body / 4)
			}
			break
		case 'testimonials':
			for (const [i, item] of itemsArray(s.items, `${p}.items`, L.testimonials, err).entries()) {
				const it = item as Partial<LandingTestimonial>
				const tp = `${p}.items[${i}]`
				const refuse =
					'Testimonials must be real and attributed: add who said it and the public https page where they said it (a store review, a post), or remove it. Never invent one.'
				if (!str(it?.quote)) err(`${tp}.quote`, 'testimonial has no quote', refuse)
				if (!str(it?.author)) err(`${tp}.author`, 'testimonial has no author', refuse)
				if (!HTTPS_RE.test(str(it?.sourceUrl)))
					err(`${tp}.sourceUrl`, 'testimonial has no public https source', refuse)
				t(`${tp}.quote`, it?.quote, L.quote)
				t(`${tp}.author`, it?.author, L.shortText)
				t(`${tp}.role`, it?.role, L.shortText)
				t(`${tp}.sourceLabel`, it?.sourceLabel, L.shortText)
			}
			break
		case 'store-badges': {
			const browsers = s.browsers ?? []
			if (!Array.isArray(browsers) || browsers.some((b) => !['chrome', 'firefox', 'edge'].includes(b))) {
				err(`${p}.browsers`, 'browsers must list chrome, firefox or edge', 'Use e.g. ["chrome", "firefox"].')
			}
			const any = (['chrome', 'firefox', 'edge'] as const).some((b) => str(form[`${b}Url`]))
			if (!any)
				warn(
					p,
					'no store URL is set, so this section renders nothing',
					'Set chromeUrl, firefoxUrl or edgeUrl.',
				)
			break
		}
		case 'changelog':
			for (const [i, item] of itemsArray(s.entries, `${p}.entries`, L.changelog, err).entries()) {
				const e = item as { version?: unknown; date?: unknown; notes?: unknown }
				const ep = `${p}.entries[${i}]`
				if (!str(e?.version)) err(`${ep}.version`, 'changelog entry needs a version', 'Set e.g. "1.2.0".')
				t(`${ep}.version`, e?.version, 40)
				if (e?.date !== undefined && !DATE_RE.test(str(e.date)))
					err(`${ep}.date`, 'date must be YYYY-MM-DD', 'Use e.g. "2026-09-28".')
				for (const [j, n] of itemsArray(e?.notes, `${ep}.notes`, L.changelogNotes, err).entries())
					t(`${ep}.notes[${j}]`, n, L.text)
			}
			break
		case 'links':
			for (const [i, item] of itemsArray(s.items, `${p}.items`, L.links, err, false).entries()) {
				const it = item as { label?: unknown; url?: unknown }
				if (!str(it?.label)) err(`${p}.items[${i}].label`, 'link needs a label', 'Add a label.')
				if (!HTTP_RE.test(str(it?.url)))
					err(`${p}.items[${i}].url`, 'link must be an http(s) URL', 'Use an absolute URL.')
				t(`${p}.items[${i}].label`, it?.label, L.shortText)
			}
			break
	}
	for (const problem of sub) err(problem.path, problem.message, problem.fix)
}

// ─── Rendering ──────────────────────────────────────────────────────────────

const STORE_ORDER: LandingBrowser[] = ['chrome', 'firefox', 'edge']
const STORE_UI: Record<LandingBrowser, LandingUiKey> = {
	chrome: 'addToChrome',
	firefox: 'getForFirefox',
	edge: 'getForEdge',
}
const BROWSER_NAMES: Record<LandingBrowser, string> = {
	chrome: 'Google Chrome',
	firefox: 'Mozilla Firefox',
	edge: 'Microsoft Edge',
}

function storeUrl(form: LandingForm, b: LandingBrowser): string {
	return str(b === 'chrome' ? form.chromeUrl : b === 'firefox' ? form.firefoxUrl : form.edgeUrl)
}

/** Paragraphs from plain text: blank lines split, single newlines become <br>. */
function paragraphs(text: string): string {
	return text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => `<p>${esc(p).replace(/\n/g, '<br />')}</p>`)
		.join('\n')
}

function arr<T>(v: unknown, max: number): T[] {
	return Array.isArray(v) ? (v.slice(0, max) as T[]) : []
}

export interface RenderLandingOptions {
	/** Locale to render; default the form's default locale. */
	locale?: string
}

/**
 * The one entry point every surface calls (dojo preview, BFF hosting, MCP and
 * CLI generate). A v1 form goes to buildLandingPage untouched.
 */
export function renderLandingForm(form: LandingForm, opts: RenderLandingOptions = {}): string {
	if (form.schemaVersion !== 2) return buildLandingPage(landingFormToInput(form))
	const def = landingDefaultLocale(form)
	const locales = landingLocales(form)
	const requested = normalizeLandingLocale(opts.locale)
	const locale = requested && locales.includes(requested) ? requested : def
	return renderV2(localizeLandingForm(form, locale), form, locale, locales, def)
}

function renderV2(
	form: LandingForm,
	base: LandingForm,
	locale: string,
	locales: string[],
	def: string,
): string {
	const ui = (key: LandingUiKey) => str(form.ui?.[key]) || LANDING_UI_DEFAULTS[key]
	const rawName = str(form.extensionName) || 'My Extension'
	const name = esc(rawName)
	const tagline = str(form.tagline)
	const description = str(form.description)
	const homeBase = canonicalUrl(base.homepageUrl)
	const pageUrl = homeBase ? landingLocaleUrl(homeBase, locale, def) : ''
	const mode = themeMode(form)
	const t = form.tokens ?? {}
	const radius = RADIUS[t.radius as keyof typeof RADIUS] ?? RADIUS.medium
	const width = WIDTH[t.width as keyof typeof WIDTH] ?? WIDTH.normal
	const sections = arr<LandingSection>(form.sections, LANDING_V2_LIMITS.sections).filter(
		(s) =>
			s &&
			typeof s === 'object' &&
			!s.hidden &&
			(LANDING_SECTION_TYPES as readonly string[]).includes(s.type),
	)
	const stores = STORE_ORDER.filter((b) => storeUrl(form, b))
	const primaryStore = stores[0] ? safeHref(storeUrl(form, stores[0])) : ''

	const badges = (browsers: LandingBrowser[]) =>
		browsers
			.filter((b) => storeUrl(form, b))
			.map(
				(b, i) =>
					`<a class="cta${i === 0 ? ' primary' : ''}" href="${safeHref(storeUrl(form, b))}" rel="noopener">${esc(ui(STORE_UI[b]))}<span class="cta-sub">${esc(BROWSER_NAMES[b])}</span></a>`,
			)
			.join('\n')

	const svg = str(form.logoSvg)
	const logoSrc =
		svg && !landingLogoSvgProblem(svg)
			? `data:image/svg+xml,${encodeURIComponent(svg)}`
			: safeImageSrc(form.logoUrl)
	const logo = logoSrc
		? `<div class="logo"><img src="${logoSrc}" alt="${name} logo" width="64" height="64" /></div>`
		: `<div class="logo monogram" aria-hidden="true">${esc(rawName.charAt(0).toUpperCase() || 'E')}</div>`

	const heading = (s: LandingSection, key?: LandingUiKey) => {
		const title = str(s.title) || (key ? ui(key) : '')
		const intro = str(s.intro)
		return `${title ? `<h2>${esc(title)}</h2>` : ''}${intro ? `\n<p class="intro">${esc(intro)}</p>` : ''}`
	}
	const section = (s: LandingSection, cls: string, inner: string) =>
		inner ? `<section id="${esc(s.id)}" class="${cls}">\n${inner}\n</section>` : ''

	const shotUrls: string[] = []
	const faqs: { q: string; a: string }[] = []
	const featureTitles: { title: string; description: string }[] = []

	const blocks = sections.map((s) => {
		switch (s.type) {
			case 'hero': {
				const headline = esc(str(s.headline) || rawName)
				const sub = str(s.subheadline) || tagline
				const cta = s.showBadges === false ? '' : badges(stores)
				return `<header id="${esc(s.id)}" class="hero">\n${logo}\n<h1>${headline}</h1>${sub ? `\n<p class="tagline">${esc(sub)}</p>` : ''}${cta ? `\n<div class="ctas">\n${cta}\n</div>` : ''}\n</header>`
			}
			case 'about':
				return section(s, 'about', str(s.body) ? `${heading(s)}\n${paragraphs(str(s.body))}` : '')
			case 'features': {
				const items = arr<{ title?: string; description?: string }>(s.items, LANDING_V2_LIMITS.items).filter(
					(f) => str(f?.title),
				)
				for (const f of items) featureTitles.push({ title: str(f.title), description: str(f.description) })
				const cards = items.map(
					(f) =>
						`<div class="card"><h3>${esc(str(f.title))}</h3>${str(f.description) ? `<p>${esc(str(f.description))}</p>` : ''}</div>`,
				)
				return section(
					s,
					'features',
					cards.length ? `${heading(s, 'features')}\n<div class="grid">\n${cards.join('\n')}\n</div>` : '',
				)
			}
			case 'screenshots': {
				const items = arr<{ url?: string; alt?: string; caption?: string }>(
					s.items,
					LANDING_V2_LIMITS.screenshots,
				)
					.map((shot, i) => ({
						url: str(shot?.url),
						src: safeImageSrc(shot?.url),
						alt: str(shot?.alt).slice(0, 200) || `${rawName} screenshot ${i + 1}`,
						caption: str(shot?.caption),
					}))
					.filter((shot) => shot.src)
				for (const shot of items) {
					const abs = absoluteImageUrl(shot.url, homeBase)
					if (abs) shotUrls.push(abs)
				}
				const figs = items.map(
					(shot) =>
						`<figure class="shot"><img src="${shot.src}" alt="${esc(shot.alt)}" loading="lazy" />${shot.caption ? `<figcaption>${esc(shot.caption)}</figcaption>` : ''}</figure>`,
				)
				return section(
					s,
					'shots',
					figs.length
						? `${heading(s, 'screenshots')}\n<div class="shot-grid">\n${figs.join('\n')}\n</div>`
						: '',
				)
			}
			case 'how-it-works': {
				const steps = arr<{ title?: string; description?: string }>(s.steps, LANDING_V2_LIMITS.steps).filter(
					(x) => str(x?.title),
				)
				const lis = steps.map(
					(x) =>
						`<li><h3>${esc(str(x.title))}</h3>${str(x.description) ? `<p>${esc(str(x.description))}</p>` : ''}</li>`,
				)
				return section(
					s,
					'steps',
					lis.length ? `${heading(s, 'howItWorks')}\n<ol class="step-list">\n${lis.join('\n')}\n</ol>` : '',
				)
			}
			case 'pricing': {
				const plans = arr<LandingPricingPlan>(s.plans, LANDING_V2_LIMITS.plans).filter(
					(pl) => str(pl?.name) && str(pl?.price),
				)
				const period = (pl: LandingPricingPlan) =>
					pl.period === 'month'
						? ui('perMonth')
						: pl.period === 'year'
							? ui('perYear')
							: pl.period === 'one-time'
								? ui('oneTime')
								: pl.period === 'lifetime'
									? ui('lifetime')
									: ''
				const cards = plans.map((pl) => {
					const href = str(pl.ctaUrl) ? safeHref(str(pl.ctaUrl)) : primaryStore
					const feats = arr<string>(pl.features, LANDING_V2_LIMITS.planFeatures).map(str).filter(Boolean)
					return `<div class="card plan${pl.highlighted ? ' highlighted' : ''}">${pl.highlighted ? `<p class="badge">${esc(ui('popular'))}</p>` : ''}<h3>${esc(str(pl.name))}</h3><p class="price">${esc(str(pl.price))}${period(pl) ? ` <span class="period">${esc(period(pl))}</span>` : ''}</p>${str(pl.description) ? `<p>${esc(str(pl.description))}</p>` : ''}${feats.length ? `<ul>${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}${href ? `<a class="cta${pl.highlighted ? ' primary' : ''}" href="${href}" rel="noopener">${esc(str(pl.ctaLabel) || ui('install'))}</a>` : ''}</div>`
				})
				const note = str(s.note)
				return section(
					s,
					'pricing',
					cards.length
						? `${heading(s, 'pricing')}\n<div class="grid plans">\n${cards.join('\n')}\n</div>${note ? `\n<p class="note">${esc(note)}</p>` : ''}`
						: '',
				)
			}
			case 'faq': {
				const items = arr<{ question?: string; answer?: string }>(s.items, LANDING_V2_LIMITS.faq).filter(
					(x) => str(x?.question) && str(x?.answer),
				)
				for (const x of items) faqs.push({ q: str(x.question), a: str(x.answer) })
				const det = items.map(
					(x) =>
						`<details><summary>${esc(str(x.question))}</summary>\n${paragraphs(str(x.answer))}\n</details>`,
				)
				return section(s, 'faq', det.length ? `${heading(s, 'faq')}\n${det.join('\n')}` : '')
			}
			case 'testimonials': {
				const items = arr<LandingTestimonial>(s.items, LANDING_V2_LIMITS.testimonials).filter(
					(x) => str(x?.quote) && str(x?.author) && HTTPS_RE.test(str(x?.sourceUrl)),
				)
				const quotes = items.map((x) => {
					let label = str(x.sourceLabel)
					if (!label) {
						try {
							label = new URL(str(x.sourceUrl)).hostname
						} catch {
							label = ui('source')
						}
					}
					return `<figure class="card quote"><blockquote>${paragraphs(str(x.quote))}</blockquote><figcaption><strong>${esc(str(x.author))}</strong>${str(x.role) ? `, ${esc(str(x.role))}` : ''} · <a href="${safeHref(str(x.sourceUrl))}" rel="nofollow noopener">${esc(label)}</a></figcaption></figure>`
				})
				return section(
					s,
					'testimonials',
					quotes.length
						? `${heading(s, 'testimonials')}\n<div class="grid">\n${quotes.join('\n')}\n</div>`
						: '',
				)
			}
			case 'store-badges': {
				const wanted =
					Array.isArray(s.browsers) && s.browsers.length
						? s.browsers.filter((b) => STORE_ORDER.includes(b))
						: stores
				const cta = badges(wanted)
				return section(
					s,
					'badges',
					cta ? `${heading(s, 'storeBadges')}\n<div class="ctas">\n${cta}\n</div>` : '',
				)
			}
			case 'changelog': {
				const entries = arr<{ version?: string; date?: string; notes?: string[] }>(
					s.entries,
					LANDING_V2_LIMITS.changelog,
				).filter((e) => str(e?.version))
				const items = entries.map((e) => {
					const date = DATE_RE.test(str(e.date))
						? ` <time datetime="${esc(str(e.date))}">${esc(str(e.date))}</time>`
						: ''
					const notes = arr<string>(e.notes, LANDING_V2_LIMITS.changelogNotes).map(str).filter(Boolean)
					return `<li><h3>${esc(str(e.version))}${date}</h3>${notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</li>`
				})
				return section(
					s,
					'changelog',
					items.length ? `${heading(s, 'changelog')}\n<ol class="releases">\n${items.join('\n')}\n</ol>` : '',
				)
			}
			case 'links': {
				const links = arr<{ label?: string; url?: string }>(s.items, LANDING_V2_LIMITS.links)
					.filter((l) => str(l?.label) && HTTP_RE.test(str(l?.url)))
					.map((l) => `<li><a href="${safeHref(str(l.url))}" rel="noopener">${esc(str(l.label))}</a></li>`)
				if (s.includeProjectLinks !== false) links.push(...projectLinks(form, ui).map((a) => `<li>${a}</li>`))
				return section(
					s,
					'links',
					links.length ? `${heading(s, 'links')}\n<ul class="link-list">\n${links.join('\n')}\n</ul>` : '',
				)
			}
		}
		return ''
	})

	const languageNav =
		locales.length > 1
			? `<nav class="langs" aria-label="${esc(ui('languages'))}">${locales
					.map((l) => {
						const href = homeBase
							? esc(landingLocaleUrl(homeBase, l, def))
							: l === def
								? './'
								: `./${landingLocaleSlug(l)}/`
						return l === locale
							? `<span lang="${esc(l)}" aria-current="true">${esc(l)}</span>`
							: `<a href="${href}" hreflang="${esc(l)}" lang="${esc(l)}">${esc(l)}</a>`
					})
					.join(' ')}</nav>`
			: ''

	// ── head ──
	const seo = form.seo ?? {}
	const titleText = str(seo.title) || `${rawName}${tagline ? ` — ${tagline}` : ''}`
	const metaDescription = str(seo.description) || description || tagline
	const ogImage = HTTPS_RE.test(str(seo.ogImageUrl)) ? str(seo.ogImageUrl) : (shotUrls[0] ?? '')
	const twitter = TWITTER_RE.test(str(seo.twitterSite)) ? `@${str(seo.twitterSite).replace(/^@/, '')}` : ''
	const alternates =
		homeBase && locales.length > 1
			? [
					...locales.map(
						(l) =>
							`<link rel="alternate" hreflang="${esc(l)}" href="${esc(landingLocaleUrl(homeBase, l, def))}" />`,
					),
					`<link rel="alternate" hreflang="x-default" href="${esc(homeBase)}" />`,
				]
			: []

	const app = generateJsonLd(
		jsonLdFromLanding({
			extensionName: rawName,
			tagline,
			description: metaDescription,
			storeUrls: { chrome: form.chromeUrl, firefox: form.firefoxUrl, edge: form.edgeUrl },
			features: featureTitles.length
				? featureTitles
				: arr<{ title: string; description: string }>(form.features, 24).filter((f) => str(f?.title)),
			privacyPolicyUrl: str(form.privacyPolicyUrl),
			homepageUrl: pageUrl || undefined,
			screenshots: shotUrls,
		}),
	) as ReturnType<typeof generateJsonLd> & { inLanguage?: string }
	if (str(seo.authorName)) app.author = { '@type': 'Organization', name: str(seo.authorName) }
	app.inLanguage = locale
	const ld: object[] = [app]
	if (faqs.length) {
		ld.push({
			'@context': 'https://schema.org',
			'@type': 'FAQPage',
			inLanguage: locale,
			mainEntity: faqs.map((f) => ({
				'@type': 'Question',
				name: f.q,
				acceptedAnswer: { '@type': 'Answer', text: f.a },
			})),
		})
	}
	const ldTags = ld.map(
		(o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`,
	)

	const head = [
		`<title>${esc(titleText)}</title>`,
		metaDescription ? `<meta name="description" content="${esc(metaDescription)}" />` : '',
		seo.noindex === true ? '<meta name="robots" content="noindex" />' : '',
		`<meta name="color-scheme" content="${mode === 'auto' ? 'light dark' : mode}" />`,
		pageUrl ? `<link rel="canonical" href="${esc(pageUrl)}" />` : '',
		...alternates,
		'<meta property="og:type" content="website" />',
		`<meta property="og:title" content="${esc(titleText)}" />`,
		metaDescription ? `<meta property="og:description" content="${esc(metaDescription)}" />` : '',
		pageUrl ? `<meta property="og:url" content="${esc(pageUrl)}" />` : '',
		`<meta property="og:locale" content="${esc(locale.replace('-', '_'))}" />`,
		ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : '',
		`<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`,
		twitter ? `<meta name="twitter:site" content="${esc(twitter)}" />` : '',
		...ldTags,
	]
		.filter(Boolean)
		.join('\n')

	const vars = (p: Required<LandingPalette>) =>
		`--accent: ${p.accent}; --accent-text: ${p.accentText}; --bg: ${p.background}; --surface: ${p.surface}; --fg: ${p.text}; --muted: ${p.muted}; --border: ${p.border};`
	const palette =
		mode === 'auto'
			? `:root { ${vars(resolvePalette(form, 'light'))} }\n\t@media (prefers-color-scheme: dark) { :root { ${vars(resolvePalette(form, 'dark'))} } }`
			: `:root { ${vars(resolvePalette(form, mode))} }`

	const footer = projectLinks(form, ui)
	const bodyFont = font(t.bodyFont)
	const headingFont = t.headingFont ? font(t.headingFont) : bodyFont

	return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${head}
<style>
	${palette}
	:root { --radius: ${radius}; --width: ${width}; --font-body: ${bodyFont}; --font-heading: ${headingFont}; }
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body { font-family: var(--font-body); background: var(--bg); color: var(--fg); line-height: 1.6; }
	h1, h2, h3 { font-family: var(--font-heading); line-height: 1.2; }
	a { color: var(--accent); }
	.wrap { max-width: var(--width); margin: 0 auto; padding: 0 24px; }
	.langs { padding: 16px 0 0; text-align: right; font-size: 0.85rem; color: var(--muted); }
	.langs a, .langs span { margin-left: 10px; }
	.hero { padding: 88px 0 56px; text-align: center; }
	.logo { width: 88px; height: 88px; margin: 0 auto 28px; border-radius: calc(var(--radius) * 1.8); display: flex; align-items: center; justify-content: center; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
	.logo img { width: 64px; height: 64px; object-fit: contain; }
	.logo.monogram { font-size: 2.4rem; font-weight: 700; color: var(--accent); }
	h1 { font-size: 2.6rem; letter-spacing: -0.02em; }
	.tagline { margin-top: 14px; font-size: 1.25rem; color: var(--muted); }
	.ctas { margin-top: 36px; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
	.cta { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 26px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--fg); text-decoration: none; font-weight: 600; }
	.cta.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
	.cta-sub { font-size: 0.72rem; font-weight: 400; opacity: 0.75; }
	section { padding: 40px 0; }
	section h2 { font-size: 1.6rem; margin-bottom: 18px; text-align: center; }
	.intro { max-width: 640px; margin: -6px auto 22px; text-align: center; color: var(--muted); }
	.about p { max-width: 680px; margin: 0 auto 14px; color: var(--muted); }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
	.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px; }
	.card h3 { font-size: 1.02rem; margin-bottom: 8px; }
	.card p, .card li { font-size: 0.92rem; color: var(--muted); }
	.shot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
	.shot img { display: block; width: 100%; height: auto; border-radius: var(--radius); border: 1px solid var(--border); }
	.shot figcaption { margin-top: 8px; font-size: 0.85rem; color: var(--muted); text-align: center; }
	.step-list { list-style: none; counter-reset: step; display: grid; gap: 14px; max-width: 680px; margin: 0 auto; }
	.step-list li { counter-increment: step; position: relative; padding: 18px 18px 18px 64px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
	.step-list li::before { content: counter(step); position: absolute; left: 18px; top: 18px; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--accent-text); font-weight: 700; display: flex; align-items: center; justify-content: center; }
	.step-list p { color: var(--muted); font-size: 0.92rem; }
	.plan { display: flex; flex-direction: column; gap: 10px; }
	.plan.highlighted { border-color: var(--accent); }
	.plan .badge { font-size: 0.75rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em; }
	.plan .price { font-size: 1.6rem; font-weight: 700; color: var(--fg); }
	.plan .period { font-size: 0.9rem; font-weight: 400; color: var(--muted); }
	.plan ul { padding-left: 18px; }
	.plan .cta { margin-top: auto; }
	.note { margin-top: 16px; text-align: center; font-size: 0.85rem; color: var(--muted); }
	.faq details { max-width: 720px; margin: 0 auto 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 18px; }
	.faq summary { cursor: pointer; font-weight: 600; }
	.faq details p { margin-top: 10px; color: var(--muted); }
	.quote blockquote p { font-size: 1rem; color: var(--fg); }
	.quote figcaption { margin-top: 12px; font-size: 0.85rem; color: var(--muted); }
	.releases { list-style: none; max-width: 720px; margin: 0 auto; }
	.releases > li { padding: 14px 0; border-bottom: 1px solid var(--border); }
	.releases time { font-size: 0.85rem; font-weight: 400; color: var(--muted); margin-left: 8px; }
	.releases ul { padding-left: 18px; color: var(--muted); }
	.link-list { list-style: none; display: flex; flex-wrap: wrap; gap: 10px 22px; justify-content: center; }
	footer { border-top: 1px solid var(--border); margin-top: 24px; padding: 28px 0 48px; text-align: center; font-size: 0.85rem; color: var(--muted); }
	footer a { color: var(--muted); margin: 0 10px; }
</style>
</head>
<body>
<div class="wrap">
${[languageNav, ...blocks].filter(Boolean).join('\n')}
<footer>
${footer.join('\n')}
<div>© ${name}</div>
</footer>
</div>
</body>
</html>
`
}

function projectLinks(form: LandingForm, ui: (k: LandingUiKey) => string): string[] {
	const links: [string, string][] = [
		[str(form.privacyPolicyUrl) ? safeHref(str(form.privacyPolicyUrl)) : '', ui('privacy')],
		[str(form.supportUrl) ? safeSupportHref(str(form.supportUrl)) : '', ui('support')],
		[str(form.termsUrl) ? safeHref(str(form.termsUrl)) : '', ui('terms')],
		[str(form.uninstallUrl) ? safeHref(str(form.uninstallUrl)) : '', ui('feedback')],
	]
	// One page registered for two roles (support = the feedback form) is listed once.
	const seen = new Set<string>()
	const out: string[] = []
	for (const [href, label] of links) {
		if (!href || (href !== '#' && seen.has(href))) continue
		seen.add(href)
		out.push(`<a href="${href}">${esc(label)}</a>`)
	}
	return out
}

/** Every locale's page: `[{ locale, path, html }]`, default locale first (path ''). */
export function renderLandingLocales(form: LandingForm): { locale: string; slug: string; html: string }[] {
	const def = landingDefaultLocale(form)
	return landingLocales(form).map((locale) => ({
		locale,
		slug: locale === def ? '' : landingLocaleSlug(locale),
		html: renderLandingForm(form, { locale }),
	}))
}

/** Format a Pay offer amount for a pricing card ("$4.99", "4,99 €"). */
export function formatLandingPrice(amountMinor: number, currency: string, locale: string): string {
	try {
		return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(
			amountMinor / 100,
		)
	} catch {
		return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`
	}
}
