/**
 * Compact reads of the hosted landing page (DX report 2026-10-10 §2 row 15).
 *
 * `get_landing_page` returns the form the live version was rendered from. With
 * eleven locales and an inline logo that form is ~80 KB — more than an MCP
 * response carries. So the tool answers with a summary by default (what is
 * live, which locales and sections exist, how big each part is) and returns
 * the form only on request, optionally narrowed to some top-level fields and
 * some translations.
 *
 * Shaped here, from the response the BFF already sends, rather than in the BFF:
 * every BFF version returns the same full form, so this works against an old
 * BFF and a new one alike, and the BFF contract does not change.
 */

import { z } from 'zod'
import { normalizeLandingLocale } from './landing-sections.js'

export const LANDING_READ_VIEWS = ['summary', 'full'] as const
export type LandingReadView = (typeof LANDING_READ_VIEWS)[number]

/** get_landing_page parameters besides projectId. */
export const LANDING_READ_SHAPE = {
	view: z
		.enum(LANDING_READ_VIEWS)
		.optional()
		.describe(
			'"summary" (default): what is live and how big each part of the form is. "full": the form itself.',
		),
	fields: z
		.array(z.string().max(40))
		.max(40)
		.optional()
		.describe(
			'With view "full": top-level form keys to return, e.g. ["sections", "seo"] (names and sizes are in formSummary.fields). Default: all.',
		),
	locales: z
		.array(z.string().max(35))
		.max(100)
		.optional()
		.describe(
			'With view "full": translations to keep in form.locales, e.g. ["de"]; [] drops them all. The base content is part of every full read.',
		),
}

export interface LandingReadOptions {
	view?: LandingReadView
	/** Top-level form keys to keep in a full read (e.g. `sections`, `seo`). */
	fields?: readonly string[]
	/** Translations to keep in `form.locales` in a full read (`de`, `pt-BR`). The base content is always kept. */
	locales?: readonly string[]
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const bytesOf = (value: unknown): number =>
	value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length

const LINK_FIELDS = [
	'homepageUrl',
	'chromeUrl',
	'firefoxUrl',
	'edgeUrl',
	'privacyPolicyUrl',
	'supportUrl',
	'uninstallUrl',
	'termsUrl',
] as const

/** `bytes` is measured like every other size here: the field as JSON (quotes included). */
function logoOf(form: Json): { kind: 'svg' | 'data-url' | 'url' | 'none'; bytes: number } {
	if (typeof form.logoSvg === 'string' && form.logoSvg) return { kind: 'svg', bytes: bytesOf(form.logoSvg) }
	if (typeof form.logoUrl === 'string' && form.logoUrl)
		return { kind: form.logoUrl.startsWith('data:') ? 'data-url' : 'url', bytes: bytesOf(form.logoUrl) }
	return { kind: 'none', bytes: 0 }
}

/** What an agent decides from before asking for the form itself. */
export function summarizeLandingForm(form: Json) {
	const sections = Array.isArray(form.sections) ? form.sections : []
	const locales = isObject(form.locales) ? form.locales : {}
	const links = Object.fromEntries(
		LINK_FIELDS.flatMap((key) => (typeof form[key] === 'string' && form[key] ? [[key, form[key]]] : [])),
	)
	return {
		bytes: bytesOf(form),
		schemaVersion: form.schemaVersion ?? 1,
		extensionName: form.extensionName,
		tagline: form.tagline,
		theme: form.theme,
		accentColor: form.accentColor,
		defaultLocale: normalizeLandingLocale(form.defaultLocale) ?? 'en',
		translations: Object.entries(locales).map(([locale, content]) => ({ locale, bytes: bytesOf(content) })),
		sections: sections.map((section, index) => {
			const s = isObject(section) ? section : {}
			return {
				index,
				id: s.id,
				type: s.type,
				...(s.hidden ? { hidden: true } : {}),
				bytes: bytesOf(section),
			}
		}),
		links,
		logo: logoOf(form),
		features: Array.isArray(form.features) ? form.features.length : 0,
		screenshots: Array.isArray(form.screenshots) ? form.screenshots.length : 0,
		// Largest first: the parts worth leaving out of a full read.
		fields: Object.keys(form)
			.map((field) => ({ field, bytes: bytesOf(form[field]) }))
			.sort((a, b) => b.bytes - a.bytes),
	}
}

function narrowForm(
	form: Json,
	fields: readonly string[] | undefined,
	locales: readonly string[] | undefined,
) {
	let out: Json = form
	if (fields?.length) {
		// schemaVersion decides how the rest reads, so it always comes along; asking
		// for translations by `locales` keeps `locales` even when `fields` omits it.
		const keep = new Set([...fields, 'schemaVersion', ...(locales ? ['locales'] : [])])
		out = Object.fromEntries(Object.entries(out).filter(([key]) => keep.has(key)))
	}
	if (locales && isObject(out.locales)) {
		const wanted = new Set(locales.map((l) => normalizeLandingLocale(l) ?? l))
		out = {
			...out,
			locales: Object.fromEntries(
				Object.entries(out.locales).filter(([key]) => wanted.has(normalizeLandingLocale(key) ?? key)),
			),
		}
	}
	return out
}

/**
 * Shape a `getLandingPage` response for the agent. Anything that is not the
 * expected `{ page, url, form }` object passes through untouched.
 */
export function shapeLandingRead(result: unknown, options: LandingReadOptions = {}): unknown {
	if (!isObject(result) || !('form' in result)) return result
	const form = isObject(result.form) ? result.form : null
	if ((options.view ?? 'summary') === 'full') {
		const narrowed = form ? narrowForm(form, options.fields, options.locales) : result.form
		return {
			...result,
			form: narrowed,
			...(form && narrowed !== form
				? { formBytes: { full: bytesOf(form), returned: bytesOf(narrowed) } }
				: {}),
		}
	}
	const { form: _form, ...rest } = result
	return {
		...rest,
		view: 'summary',
		formSummary: form ? summarizeLandingForm(form) : null,
		...(form
			? {
					next: 'Pass view "full" for the form; add fields (top-level keys from formSummary.fields) and locales to read only part of it.',
				}
			: {}),
	}
}
