/**
 * Body of the free `generate_landing_page` MCP tool.
 *
 * Pure function of its arguments — no API key, no network, no credits — so it
 * is registered under the `docs` capability and works on both the local stdio
 * server and the hosted connector. The HTML comes from ./landing-page.ts, a
 * synced copy of shared-types/landing-page.ts: the page an agent generates here
 * is byte-for-byte what the cabinet Page generator downloads for the same form.
 *
 * Extenshi does not host the page. The returned `nextSteps` describe hosting it
 * on any HTTPS origin and registering the URL with `upsert_hosted_page`, which
 * is what feeds HOMEPAGE_URL in the generated integration config.
 */

import {
	DEFAULT_LANDING_FORM,
	type LandingForm,
	type LandingScreenshot,
	landingFormToInput,
	landingPageWarnings,
} from './landing-page.js'
import {
	type LandingProblem,
	type LandingV2Fields,
	landingFormProblems,
	renderLandingLocales,
} from './landing-sections.js'

export interface LandingPageArgs {
	extensionName: string
	tagline?: string
	description?: string
	accentColor?: string
	theme?: 'light' | 'dark'
	chromeUrl?: string
	firefoxUrl?: string
	edgeUrl?: string
	privacyPolicyUrl?: string
	supportUrl?: string
	homepageUrl?: string
	features?: { title: string; description?: string }[]
	screenshots?: { url: string; alt?: string }[]
	logoSvg?: string
	logoUrl?: string
	// Schema v2 (sections, theme tokens, SEO, locales) — landing-sections.ts.
	schemaVersion?: 2
	sections?: Record<string, unknown>[]
	tokens?: Record<string, unknown>
	seo?: Record<string, unknown>
	defaultLocale?: string
	locales?: Record<string, Record<string, unknown>>
	ui?: Record<string, string>
	uninstallUrl?: string
	termsUrl?: string
}

export interface GeneratedLandingPage {
	html: string
	bytes: number
	warnings: string[]
	/** Schema v2: every problem with its path and fix (errors mean a hosted publish would refuse it). */
	problems?: LandingProblem[]
	/** Schema v2 with locales: the other locales' pages and where to save them. */
	localePages?: { locale: string; path: string; html: string }[]
	nextSteps: string[]
}

const V2_KEYS = [
	'sections',
	'tokens',
	'seo',
	'defaultLocale',
	'locales',
	'ui',
	'uninstallUrl',
	'termsUrl',
] as const

export function landingFormFromArgs(args: LandingPageArgs): LandingForm {
	const form: LandingForm = {
		...DEFAULT_LANDING_FORM,
		extensionName: args.extensionName,
		tagline: args.tagline ?? '',
		description: args.description ?? '',
		accentColor: args.accentColor ?? DEFAULT_LANDING_FORM.accentColor,
		theme: args.theme ?? DEFAULT_LANDING_FORM.theme,
		chromeUrl: args.chromeUrl ?? '',
		firefoxUrl: args.firefoxUrl ?? '',
		edgeUrl: args.edgeUrl ?? '',
		privacyPolicyUrl: args.privacyPolicyUrl ?? '',
		supportUrl: args.supportUrl ?? '',
		features: (args.features ?? []).map((f) => ({ title: f.title, description: f.description ?? '' })),
	}
	if (args.homepageUrl) form.homepageUrl = args.homepageUrl
	if (args.logoUrl) form.logoUrl = args.logoUrl
	if (args.logoSvg) form.logoSvg = args.logoSvg
	if (args.screenshots?.length) {
		form.screenshots = args.screenshots.map((s): LandingScreenshot => ({ url: s.url, alt: s.alt ?? '' }))
	}
	if (args.schemaVersion === 2) form.schemaVersion = 2
	// Passed through as given — landingFormProblems reports anything malformed,
	// including v2 keys sent without schemaVersion 2.
	for (const key of V2_KEYS) {
		if (args[key] !== undefined) (form as unknown as Record<string, unknown>)[key] = args[key]
	}
	return form as LandingForm & LandingV2Fields
}

export function landingNextSteps(homepageUrl?: string): string[] {
	return [
		'Save `html` verbatim as index.html. Put any relative screenshot or logo paths next to it at the same relative locations.',
		'Host the file on a public HTTPS origin — for example GitHub Pages (commit index.html to the repository, then Settings → Pages → deploy from the branch and folder), Cloudflare Pages, Netlify or any static host. The page has no JavaScript, so it needs no build step or CSP changes.',
		homepageUrl
			? `Confirm the page loads at ${homepageUrl} (the canonical/og:url tags already point there).`
			: 'Once the final URL is known, regenerate with homepageUrl set to it so the canonical, og:url and JSON-LD url tags are filled in, and re-upload.',
		'Register the URL on the project: upsert_hosted_page {projectId, kind: "homepage", url} (needs identity and hosted.write; the server fetches the public page and hashes it, so it has to be publicly reachable). CLI equivalent: npx @extenshi/cli@latest page register --project <id> --url <https-url>.',
		'Re-read get_project_state and write integration.file verbatim to integration.path — the regenerated config carries the new HOMEPAGE_URL.',
		'After later edits to the hosted page, verify_hosted_artifact {projectId, kind: "homepage"} reports whether the live page still matches the registered hash.',
	]
}

export function renderGenerateLandingPage(args: LandingPageArgs): GeneratedLandingPage {
	const form = landingFormFromArgs(args)
	const input = landingFormToInput(form)
	const pages = renderLandingLocales(form)
	const html = pages[0]?.html ?? ''
	const homepage = /^https:\/\/\S+$/i.test(input.homepageUrl ?? '') ? input.homepageUrl : undefined
	const nextSteps = landingNextSteps(homepage)
	if (form.schemaVersion !== 2) {
		const problems = landingFormProblems(form).filter((p) => p.severity === 'error')
		return {
			html,
			bytes: new TextEncoder().encode(html).length,
			warnings: landingPageWarnings(input),
			...(problems.length ? { problems } : {}),
			nextSteps,
		}
	}
	const problems = landingFormProblems(form)
	const localePages = pages
		.slice(1)
		.map((p) => ({ locale: p.locale, path: `${p.slug}/index.html`, html: p.html }))
	if (localePages.length) {
		nextSteps.splice(
			1,
			0,
			`Save each localePages[].html at its path (${localePages.map((p) => p.path).join(', ')}) next to index.html — hreflang links point at those URLs.`,
		)
	}
	if (problems.some((p) => p.severity === 'error')) {
		nextSteps.unshift(
			'Fix the problems with severity "error" first: a hosted publish refuses them, and the page drops those parts.',
		)
	}
	return {
		html,
		bytes: new TextEncoder().encode(html).length,
		warnings: problems.filter((p) => p.severity === 'warning').map((p) => `${p.path}: ${p.message}`),
		problems,
		...(localePages.length ? { localePages } : {}),
		nextSteps,
	}
}

/** Follow-ups after publish_landing_page, from the fields the BFF returned. */
export function hostedLandingNextSteps(result: Record<string, unknown>): string[] {
	const homepage = (result.homepage ?? {}) as { registered?: boolean; previousUrl?: string | null }
	const steps = [
		`The page is live at ${String(result.url)}; the same URL keeps serving every later version.`,
		homepage.registered
			? 'It is now the project homepage. Re-read get_project_state and write integration.file verbatim to integration.path so HOMEPAGE_URL uses it.'
			: 'The homepage registration was left unchanged (registerAsHomepage: false).',
		'verify_hosted_artifact {projectId, kind: "homepage"} confirms the public URL serves the published bytes (the hash is contentHash).',
	]
	if (homepage.previousUrl)
		steps.push(`This replaced the previously registered homepage ${homepage.previousUrl}.`)
	const warnings = Array.isArray(result.warnings) ? result.warnings : []
	if (warnings.length)
		steps.push('Review warnings: those values were clamped or dropped in the rendered page.')
	const locales = Array.isArray(result.locales) ? (result.locales as { locale: string; url: string }[]) : []
	if (locales.length > 1)
		steps.push(`Locale pages: ${locales.map((l) => `${l.locale} ${l.url}`).join(', ')}.`)
	if (typeof result.llmsTxtUrl === 'string') steps.push(`llms.txt is served at ${result.llmsTxtUrl}.`)
	steps.push(
		'Every publish is a new version: list_landing_page_versions shows the history and rollback_landing_page restores one. set_custom_domain serves this page at your own domain root (Pro).',
	)
	return steps
}
