/**
 * Page Generator: an extension's landing / homepage as ONE static HTML file.
 *
 * No JavaScript in the output — pure HTML/CSS, so it deploys anywhere
 * (GitHub Pages, Netlify, S3) and trivially passes CSP. Store CTAs render
 * only for the stores the developer actually filled in.
 *
 * Every user-supplied string is HTML-escaped, every link is scheme-clamped
 * (safeHref: http(s) only; the support link may also be a single mailto:
 * address) and every image source is clamped to https, a
 * relative path or a raster `data:image/…;base64` URL (safeImageSrc). An
 * inline SVG logo is validated (landingLogoSvgProblem) and then embedded
 * through `<img src="data:image/svg+xml,…">`, where browsers never run
 * scripts or fetch external resources — so even a validator miss cannot
 * script the page.
 *
 * SINGLE SOURCE, THREE COPIES:
 *   shared-types/landing-page.ts            (canonical — edit here; dojo re-exports it)
 *   tools/extenshi-mcp/src/landing-page.ts  (copy for the published @extenshi/mcp)
 *   tools/extenshi-cli/src/landing-page.ts  (copy for the published @extenshi/cli)
 * The published packages cannot import workspace shared-types at runtime.
 * The copies differ from this file ONLY in the json-ld import specifier
 * (`./json-ld.js` there, the package specifier here — see
 * module-specifiers.test.ts for why shared-types may not use relative ones).
 * `landing-page-sync.test.ts` in both packages fails when a copy drifts.
 * After editing, run:
 *   sed '/^import/s#shared-types/#./#' shared-types/landing-page.ts > tools/extenshi-mcp/src/landing-page.ts
 *   sed '/^import/s#shared-types/#./#' shared-types/landing-page.ts > tools/extenshi-cli/src/landing-page.ts
 */

import { jsonLdFromLanding, jsonLdScriptTag } from './json-ld.js'

export type LandingBrowser = 'chrome' | 'firefox' | 'edge'

export interface LandingFeature {
	title: string
	description: string
}

export interface LandingScreenshot {
	/** https URL, or a path relative to the page (e.g. `screenshots/popup.png`). */
	url: string
	alt: string
}

/**
 * Serializable form persisted as `page-generator` tool state (`{ form }`).
 * The optional fields were added later; rows saved before them still hydrate.
 */
export interface LandingForm {
	extensionName: string
	tagline: string
	description: string
	accentColor: string
	theme: 'light' | 'dark'
	chromeUrl: string
	firefoxUrl: string
	edgeUrl: string
	privacyPolicyUrl: string
	supportUrl: string
	features: LandingFeature[]
	/** Public https URL the page will live at: canonical link, og:url, JSON-LD url. */
	homepageUrl?: string
	/** Logo image: https URL, relative path, or `data:image/(png|jpeg|gif|webp);base64,…`. */
	logoUrl?: string
	/** Inline SVG logo source; wins over logoUrl when it passes validation. */
	logoSvg?: string
	screenshots?: LandingScreenshot[]
}

/** Input limits shared by the MCP tool and CLI schemas. */
export const LANDING_LIMITS = {
	extensionName: 120,
	tagline: 200,
	description: 2000,
	url: 2000,
	features: 12,
	featureTitle: 120,
	featureDescription: 500,
	screenshots: 8,
	screenshotAlt: 200,
	logoSvgBytes: 100_000,
	logoUrl: 400_000,
} as const

export const DEFAULT_LANDING_FORM: LandingForm = {
	extensionName: '',
	tagline: '',
	description: '',
	accentColor: '#5e5ce6',
	theme: 'dark',
	chromeUrl: '',
	firefoxUrl: '',
	edgeUrl: '',
	privacyPolicyUrl: '',
	supportUrl: '',
	features: [
		{ title: '', description: '' },
		{ title: '', description: '' },
		{ title: '', description: '' },
	],
}

export interface LandingPageInput {
	extensionName: string
	tagline: string
	description: string
	accentColor: string
	theme: 'light' | 'dark'
	storeUrls: Partial<Record<LandingBrowser, string>>
	features: LandingFeature[]
	privacyPolicyUrl: string
	supportUrl: string
	/**
	 * Optional inline SVG logo. Validated with landingLogoSvgProblem() and
	 * embedded as an `<img>` data URI; a rejected SVG falls back to logoUrl,
	 * then to a monogram.
	 */
	logoSvg?: string
	logoUrl?: string
	homepageUrl?: string
	screenshots?: LandingScreenshot[]
}

/**
 * Rebuild the editor form from a saved `page-generator` row (or the project
 * name when nothing is saved). Called during render — not in an effect —
 * so the live preview iframe mounts with this payload, not the empty default.
 * An older row that predates `features` (or the optional fields) still yields
 * a full form.
 */
export function hydrateLandingForm(
	saved: { form?: Partial<LandingForm> } | null | undefined,
	projectName?: string | null,
): LandingForm {
	if (saved?.form) {
		const features = Array.isArray(saved.form.features) ? saved.form.features : DEFAULT_LANDING_FORM.features
		const { screenshots, ...rest } = saved.form
		const form: LandingForm = { ...DEFAULT_LANDING_FORM, ...rest, features }
		if (Array.isArray(screenshots)) form.screenshots = screenshots
		return form
	}
	const name = projectName?.trim()
	if (name) return { ...DEFAULT_LANDING_FORM, extensionName: name }
	return { ...DEFAULT_LANDING_FORM, features: [...DEFAULT_LANDING_FORM.features] }
}

export function landingFormToInput(form: LandingForm, logoSvg?: string): LandingPageInput {
	return {
		extensionName: form.extensionName,
		tagline: form.tagline,
		description: form.description,
		accentColor: form.accentColor,
		theme: form.theme,
		storeUrls: { chrome: form.chromeUrl, firefox: form.firefoxUrl, edge: form.edgeUrl },
		features: form.features,
		privacyPolicyUrl: form.privacyPolicyUrl,
		supportUrl: form.supportUrl,
		logoSvg: logoSvg ?? form.logoSvg ?? '',
		logoUrl: form.logoUrl ?? '',
		homepageUrl: form.homepageUrl ?? '',
		screenshots: form.screenshots ?? [],
	}
}

/** Tolerates non-strings from hand-edited JSON or an old saved row. */
function str(v: unknown): string {
	return typeof v === 'string' ? v.trim() : ''
}

function esc(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

// HTML-escape AND scheme-clamp a user-supplied URL before it lands in an
// href="". esc() alone stops attribute-breakout but not a `javascript:`/`data:`
// scheme, so a value like `javascript:alert(1)` would survive into the
// downloaded page the developer publishes for their own users. Only http(s)
// URLs are emitted verbatim; anything else collapses to "#".
function safeHref(raw: string): string {
	const u = raw.trim()
	return /^https?:\/\//i.test(u) ? esc(u) : '#'
}

// One plain address, optionally `?subject=` with a percent-encoded value.
// No `&` (a second header such as bcc/body), no raw or encoded CR/LF, no
// whitespace, and the address itself admits no `%` — so
// `mailto:a@b.c%0d%0aBcc:x` and `mailto:javascript:` are both refused.
const MAILTO =
	/^mailto:[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\?subject=(?:[A-Za-z0-9._~-]|%(?![01][0-9a-f]|7f)[0-9a-f]{2})+)?$/i

/** safeHref() for the support link only: http(s), or a validated mailto: address. */
function safeSupportHref(raw: string): string {
	const u = raw.trim()
	return MAILTO.test(u) ? esc(u) : safeHref(u)
}

const HTTPS_URL = /^https:\/\/[^\s"'<>\\]+$/i
const DATA_IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/
// A path relative to the page: no scheme (`javascript:`, `data:`, `http:`), not
// protocol-relative (`//host`, `\\host` — browsers treat `\` as `/`), and no
// whitespace or quotes that could smuggle a second attribute.
const RELATIVE_PATH = /^(?![a-z][a-z0-9+.-]*:)(?![/\\]{2})[^\s"'<>\\]+$/i

/** Image src clamp: https, relative path, or raster data URI; '' when unsafe. */
function safeImageSrc(raw: unknown): string {
	const u = str(raw)
	if (!u) return ''
	if (HTTPS_URL.test(u) || RELATIVE_PATH.test(u)) return esc(u)
	if (DATA_IMAGE_URL.test(u)) return u
	return ''
}

function canonicalUrl(raw: unknown): string {
	const u = str(raw)
	return HTTPS_URL.test(u) ? u : ''
}

/** Absolute https form of an image URL (for og:image / JSON-LD), or ''. */
function absoluteImageUrl(raw: unknown, base: string): string {
	const u = str(raw)
	if (HTTPS_URL.test(u)) return u
	if (!base || !RELATIVE_PATH.test(u)) return ''
	try {
		const resolved = new URL(u, base).href
		return HTTPS_URL.test(resolved) ? resolved : ''
	} catch {
		return ''
	}
}

const SVG_FORBIDDEN: [RegExp, string][] = [
	[/<!DOCTYPE|<!ENTITY/i, 'DOCTYPE/ENTITY declarations are not allowed'],
	[
		/<\s*(script|foreignObject|iframe|object|embed|applet|form|input|textarea|select|button|animate|animateTransform|animateMotion|set|handler|listener)\b/i,
		'script, foreignObject, embedded documents, form controls and animation elements are not allowed',
	],
	[/\son[a-z]+\s*=/i, 'event-handler attributes (on*) are not allowed'],
	[/(javascript|vbscript)\s*:/i, 'script URLs are not allowed'],
	[/&#/, 'numeric character references are not allowed'],
	[/@import|expression\s*\(/i, 'CSS @import / expression() is not allowed'],
	[
		// Quote handled by alternation, not `["']?`, so backtracking cannot skip
		// the quote and let `(?!#)` look at it instead of the value.
		/\s(?:xlink:)?href\s*=\s*(?:"\s*|'\s*|)(?!["'#\s]|data:image\/(?:png|jpeg|gif|webp);)/i,
		'href values other than #fragments or raster data: images are not allowed',
	],
]

/**
 * Why an inline SVG logo is refused, or null when it is acceptable. A refusal
 * never throws: buildLandingPage falls back to logoUrl / the monogram, and the
 * MCP tool and CLI surface the reason instead of silently dropping the logo.
 */
export function landingLogoSvgProblem(svg: string): string | null {
	const s = str(svg)
	if (!s) return 'the SVG is empty'
	if (new TextEncoder().encode(s).length > LANDING_LIMITS.logoSvgBytes) {
		return `the SVG exceeds ${LANDING_LIMITS.logoSvgBytes} bytes`
	}
	if (!/^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) {
		return 'the logo is not a single <svg>…</svg> document'
	}
	for (const [pattern, reason] of SVG_FORBIDDEN) if (pattern.test(s)) return reason
	return null
}

const BROWSER_LABELS: Record<LandingBrowser, string> = {
	chrome: 'Google Chrome',
	firefox: 'Mozilla Firefox',
	edge: 'Microsoft Edge',
}

const STORE_CTA_LABELS: Record<LandingBrowser, string> = {
	chrome: 'Add to Chrome',
	firefox: 'Get for Firefox',
	edge: 'Get for Edge',
}

const DEFAULT_ACCENT = '#5e5ce6'
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

/**
 * Human-readable notes about input the page silently corrected (a link clamped
 * to "#", an unsafe image dropped, a refused logo). Same rules as the builder,
 * so agents and the CLI can report exactly what did not make it into the page.
 */
export function landingPageWarnings(input: LandingPageInput): string[] {
	const out: string[] = []
	const links: [string, unknown][] = [
		['chromeUrl', input.storeUrls.chrome],
		['firefoxUrl', input.storeUrls.firefox],
		['edgeUrl', input.storeUrls.edge],
		['privacyPolicyUrl', input.privacyPolicyUrl],
	]
	for (const [field, value] of links) {
		const v = str(value)
		if (v && safeHref(v) === '#') out.push(`${field} is not an http(s) URL; its link points to "#".`)
	}
	const support = str(input.supportUrl)
	if (support && safeSupportHref(support) === '#') {
		out.push('supportUrl is not an http(s) URL or a single mailto: address; its link points to "#".')
	}
	if (!(Object.keys(STORE_CTA_LABELS) as LandingBrowser[]).some((b) => str(input.storeUrls[b]))) {
		out.push('No store URL is set, so the page has no install button.')
	}
	if (str(input.accentColor) && !HEX_COLOR.test(str(input.accentColor))) {
		out.push(`accentColor is not a hex colour; ${DEFAULT_ACCENT} is used.`)
	}
	const homepage = canonicalUrl(input.homepageUrl)
	if (str(input.homepageUrl) && !homepage) {
		out.push('homepageUrl is not an https URL; canonical, og:url and JSON-LD url are omitted.')
	}
	const svg = str(input.logoSvg)
	const svgProblem = svg ? landingLogoSvgProblem(svg) : null
	if (svgProblem) out.push(`logoSvg was refused (${svgProblem}); the fallback logo is shown.`)
	if (str(input.logoUrl) && !safeImageSrc(input.logoUrl)) {
		out.push('logoUrl is not an https URL, relative path or raster data: image; it is omitted.')
	}
	const shots = Array.isArray(input.screenshots) ? input.screenshots : []
	let relativeShots = 0
	for (const [i, shot] of shots.slice(0, LANDING_LIMITS.screenshots).entries()) {
		const url = str(shot?.url)
		if (!safeImageSrc(url))
			out.push(`screenshots[${i}].url is not an https URL or relative path; it is omitted.`)
		else if (!HTTPS_URL.test(url) && !DATA_IMAGE_URL.test(url)) relativeShots++
	}
	if (shots.length > LANDING_LIMITS.screenshots) {
		out.push(`Only the first ${LANDING_LIMITS.screenshots} screenshots are used.`)
	}
	if (relativeShots > 0 && !homepage) {
		out.push('Relative screenshot paths need an https homepageUrl to appear in og:image and JSON-LD.')
	}
	return out
}

export function buildLandingPage(input: LandingPageInput): string {
	const rawName = str(input.extensionName) || 'My Extension'
	const name = esc(rawName)
	const tagline = esc(str(input.tagline))
	const description = str(input.description)
	const accent = HEX_COLOR.test(str(input.accentColor)) ? str(input.accentColor) : DEFAULT_ACCENT
	const dark = input.theme === 'dark'

	const bg = dark ? '#0f1115' : '#ffffff'
	const fg = dark ? '#e8eaf0' : '#1f2430'
	const muted = dark ? '#9aa1b2' : '#5b6372'
	const cardBg = dark ? '#171a21' : '#f6f7fa'
	const border = dark ? '#262b36' : '#e5e8ef'

	const homepage = canonicalUrl(input.homepageUrl)

	const monogram = rawName.charAt(0).toUpperCase() || 'E'
	const svg = str(input.logoSvg)
	const logoSrc =
		svg && !landingLogoSvgProblem(svg)
			? `data:image/svg+xml,${encodeURIComponent(svg)}`
			: safeImageSrc(input.logoUrl)
	const logo = logoSrc
		? `<div class="logo"><img src="${logoSrc}" alt="${name} logo" width="64" height="64" /></div>`
		: `<div class="logo monogram" aria-hidden="true">${esc(monogram)}</div>`

	const ctas = (Object.keys(STORE_CTA_LABELS) as LandingBrowser[])
		.filter((b) => str(input.storeUrls[b]))
		.map(
			(b) =>
				`<a class="cta${b === 'chrome' ? ' primary' : ''}" href="${safeHref(str(input.storeUrls[b]))}" rel="noopener">${STORE_CTA_LABELS[b]}<span class="cta-sub">${esc(BROWSER_LABELS[b])}</span></a>`,
		)
		.join('\n\t\t\t')

	const featureList = Array.isArray(input.features) ? input.features : []
	const features = featureList
		.filter((f) => str(f?.title))
		.map(
			(f) => `<div class="feature">
				<h3>${esc(str(f.title))}</h3>
				<p>${esc(str(f.description))}</p>
			</div>`,
		)
		.join('\n\t\t\t')

	const shots = (Array.isArray(input.screenshots) ? input.screenshots : [])
		.slice(0, LANDING_LIMITS.screenshots)
		.map((shot, i) => ({
			url: str(shot?.url),
			src: safeImageSrc(shot?.url),
			alt: str(shot?.alt).slice(0, LANDING_LIMITS.screenshotAlt) || `${rawName} screenshot ${i + 1}`,
		}))
		.filter((shot) => shot.src)
	const screenshots = shots
		.map(
			(shot) =>
				`<figure class="shot"><img src="${shot.src}" alt="${esc(shot.alt)}" loading="lazy" /></figure>`,
		)
		.join('\n\t\t\t')
	const absoluteShots = shots.map((shot) => absoluteImageUrl(shot.url, homepage)).filter(Boolean)

	const footerLinks: string[] = []
	if (str(input.privacyPolicyUrl)) {
		footerLinks.push(`<a href="${safeHref(str(input.privacyPolicyUrl))}">Privacy policy</a>`)
	}
	if (str(input.supportUrl)) {
		footerLinks.push(`<a href="${safeSupportHref(str(input.supportUrl))}">Support</a>`)
	}

	const jsonLd = jsonLdScriptTag(
		jsonLdFromLanding({
			extensionName: rawName,
			tagline: str(input.tagline),
			description,
			storeUrls: input.storeUrls,
			features: featureList
				.filter((f) => str(f?.title))
				.map((f) => ({ title: str(f.title), description: str(f.description) })),
			privacyPolicyUrl: str(input.privacyPolicyUrl),
			homepageUrl: homepage || undefined,
			screenshots: absoluteShots,
		}),
	)

	const metaDescription = esc(description || str(input.tagline))
	const ogImage = absoluteShots[0] ?? ''
	const head = [
		`<title>${name}${tagline ? ` — ${tagline}` : ''}</title>`,
		`<meta name="description" content="${metaDescription}" />`,
		homepage ? `<link rel="canonical" href="${esc(homepage)}" />` : '',
		'<meta property="og:type" content="website" />',
		`<meta property="og:title" content="${name}" />`,
		metaDescription ? `<meta property="og:description" content="${metaDescription}" />` : '',
		homepage ? `<meta property="og:url" content="${esc(homepage)}" />` : '',
		ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : '',
		`<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`,
		jsonLd,
	]
		.filter(Boolean)
		.join('\n')

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${head}
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${bg}; color: ${fg}; line-height: 1.6; }
	.wrap { max-width: 880px; margin: 0 auto; padding: 0 24px; }
	header { padding: 88px 0 56px; text-align: center; }
	.logo { width: 88px; height: 88px; margin: 0 auto 28px; border-radius: 22px; display: flex; align-items: center; justify-content: center; background: ${cardBg}; border: 1px solid ${border}; overflow: hidden; }
	.logo img { width: 64px; height: 64px; object-fit: contain; }
	.logo.monogram { font-size: 2.4rem; font-weight: 700; color: ${accent}; }
	h1 { font-size: 2.6rem; letter-spacing: -0.02em; line-height: 1.15; }
	.tagline { margin-top: 14px; font-size: 1.25rem; color: ${muted}; }
	.ctas { margin-top: 36px; display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
	.cta { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 26px; border-radius: 12px; border: 1px solid ${border}; background: ${cardBg}; color: ${fg}; text-decoration: none; font-weight: 600; transition: transform 0.12s ease; }
	.cta:hover { transform: translateY(-2px); }
	.cta.primary { background: ${accent}; border-color: ${accent}; color: #fff; }
	.cta-sub { font-size: 0.72rem; font-weight: 400; opacity: 0.75; }
	.about { padding: 8px 0 24px; text-align: center; }
	.about p { max-width: 640px; margin: 0 auto; color: ${muted}; }
	.shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; padding: 24px 0 8px; }
	.shot img { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid ${border}; }
	.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; padding: 40px 0 64px; }
	.feature { background: ${cardBg}; border: 1px solid ${border}; border-radius: 14px; padding: 22px; }
	.feature h3 { font-size: 1.02rem; margin-bottom: 8px; }
	.feature p { font-size: 0.92rem; color: ${muted}; }
	footer { border-top: 1px solid ${border}; padding: 28px 0 48px; text-align: center; font-size: 0.85rem; color: ${muted}; }
	footer a { color: ${muted}; margin: 0 10px; }
</style>
</head>
<body>
	<div class="wrap">
		<header>
			${logo}
			<h1>${name}</h1>
			${tagline ? `<p class="tagline">${tagline}</p>` : ''}
			${ctas ? `<div class="ctas">\n\t\t\t${ctas}\n\t\t\t</div>` : ''}
		</header>
		${description ? `<section class="about"><p>${esc(description)}</p></section>` : ''}
		${screenshots ? `<section class="shots">\n\t\t\t${screenshots}\n\t\t</section>` : ''}
		${features ? `<section class="features">\n\t\t\t${features}\n\t\t</section>` : ''}
		<footer>
			${footerLinks.join('\n\t\t\t')}
			<div>© ${name}</div>
		</footer>
	</div>
</body>
</html>
`
}
