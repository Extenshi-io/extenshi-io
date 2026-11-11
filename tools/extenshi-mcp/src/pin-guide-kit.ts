/**
 * Pin guide kit — the pin guide packaged for a welcome page that ships INSIDE
 * the extension (`welcome/welcome.html` opened from `runtime.onInstalled`).
 *
 * The hosted welcome page draws the icon and the numbered badges as HTML
 * overlays on top of the illustration. An in-extension page has no such
 * renderer, works offline and runs under the extension CSP (no inline scripts),
 * so the kit "flattens" each step instead: the icon becomes an `<image>` and the
 * badge a circle + number INSIDE the SVG. What comes out is plain markup and
 * files an agent drops into the extension:
 *
 *   - `html`     — one `<section data-pin-guide-browser>` per browser, captions
 *                  in English marked with `data-i18n` keys. No scripts, no
 *                  event handlers, no inline styles: the extension CSP passes it.
 *   - `css`      — optional layout, plus the light/dark switch for `theme: 'auto'`.
 *   - `script`   — an ES module for a separate file: pick the user's browser,
 *                  apply `chrome.i18n` captions, and read whether the icon is
 *                  already pinned (`action.getUserSettings().isOnToolbar`).
 *   - `messages` — the captions in every requested language, in `chrome.i18n`
 *                  `messages.json` shape, ready to merge into `_locales`.
 *   - `steps`    — the flattened SVGs one by one, for `<img>` use.
 *
 * Same copy rules as ./pin-guide.ts: copied into @extenshi/mcp and
 * @extenshi/cli, see the header of ./pin-guide-strings.ts.
 */

import {
	buildPinGuideBlocks,
	PIN_GUIDE_BROWSER_LABELS,
	PIN_GUIDE_DEFAULT_ACCENT,
	type PinGuideBlock,
	type PinGuideBrowser,
} from './pin-guide.js'
import {
	PIN_GUIDE_LOCALES,
	PIN_GUIDE_STRINGS,
	type PinGuideLocale,
	pinGuideLocale,
} from './pin-guide-strings.js'

export const PIN_GUIDE_BROWSERS: readonly PinGuideBrowser[] = ['chrome', 'edge', 'firefox']

export type PinGuideKitTheme = 'light' | 'dark' | 'auto'

export interface PinGuideKitInput {
	extensionName: string
	/** Default: all three. */
	browsers?: readonly string[]
	/** BCP 47 tags; default: every supported locale. Unsupported tags are an error. */
	locales?: readonly string[]
	accentColor?: string
	/** `auto` emits a light and a dark copy of every step and lets CSS pick. Default `light`. */
	theme?: PinGuideKitTheme
	/**
	 * Where the illustrations load the icon from: a path inside the extension
	 * package relative to the page (`../icons/icon-48.png`), or a
	 * `data:image/png|jpeg|webp|svg+xml;base64,…` URI. Absent → a neutral tile.
	 */
	iconHref?: string | null
	/** Prefix of the `chrome.i18n` message names. Default `pinGuide`. */
	keyPrefix?: string
}

export interface PinGuideKitStep {
	n: number
	/** The flattened SVG, light theme (or dark when `theme: 'dark'`). */
	svg: string
	/** The dark copy, only with `theme: 'auto'`. */
	svgDark: string | null
	/**
	 * Message names of this step's captions; `body` is null for step 2. `menu`
	 * names the browser's menu item written inside the illustration (Firefox
	 * step 3, "Pin to Toolbar") and is null for every other step.
	 */
	keys: { title: string; body: string | null; alt: string; menu: string | null }
}

export interface PinGuideKitMessage {
	message: string
	description: string
}

export interface PinGuideKit {
	extensionName: string
	browsers: PinGuideBrowser[]
	locales: PinGuideLocale[]
	theme: PinGuideKitTheme
	steps: Partial<Record<PinGuideBrowser, PinGuideKitStep[]>>
	html: string
	css: string
	script: string
	/** Keyed by BCP 47 tag (`pt-BR`); `chromeLocaleDir` gives the `_locales` folder name. */
	messages: Partial<Record<PinGuideLocale, Record<string, PinGuideKitMessage>>>
}

export class PinGuideKitError extends Error {}

const ICON_DATA_URI = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/
/** A relative path inside the package: no scheme, no `//` host, no characters that end an attribute. */
const ICON_RELATIVE = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/\/)[A-Za-z0-9._~\-/@%+]+$/
/** `chrome.i18n` message names are ASCII letters, digits and underscores. */
const KEY_PREFIX = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/** `_locales` folder name for a BCP 47 tag: `pt-BR` → `pt_BR`. */
export function chromeLocaleDir(locale: PinGuideLocale): string {
	return locale.replace('-', '_')
}

function escAttr(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

function escText(s: string): string {
	return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function num(n: number): string {
	return String(Math.round(n * 1000) / 1000)
}

/** `$` starts a placeholder in `chrome.i18n`; a literal one is written `$$`. */
function i18nMessage(s: string): string {
	return s.replaceAll('$', '$$$$')
}

function resolveBrowsers(list: readonly string[] | undefined): PinGuideBrowser[] {
	if (!list || list.length === 0) return [...PIN_GUIDE_BROWSERS]
	const out: PinGuideBrowser[] = []
	for (const raw of list) {
		const b = raw.trim().toLowerCase()
		if (!(PIN_GUIDE_BROWSERS as readonly string[]).includes(b)) {
			throw new PinGuideKitError(`Unknown browser "${raw}". Use: ${PIN_GUIDE_BROWSERS.join(', ')}.`)
		}
		if (!out.includes(b as PinGuideBrowser)) out.push(b as PinGuideBrowser)
	}
	return out
}

function resolveLocales(list: readonly string[] | undefined): PinGuideLocale[] {
	if (!list || list.length === 0) return [...PIN_GUIDE_LOCALES]
	const out: PinGuideLocale[] = []
	for (const raw of list) {
		const l = pinGuideLocale(raw)
		// pinGuideLocale falls back to English; asking for e.g. Polish and silently
		// getting English captions would read as a translated kit that is not.
		if (l === 'en' && !/^en\b/i.test(raw.trim())) {
			throw new PinGuideKitError(
				`No pin guide captions for "${raw}". Supported: ${PIN_GUIDE_LOCALES.join(', ')}.`,
			)
		}
		if (!out.includes(l)) out.push(l)
	}
	// English is the fallback text inside the HTML, so it is always present.
	if (!out.includes('en')) out.unshift('en')
	return out
}

function resolveIconHref(href: string | null | undefined): string | null {
	const h = href?.trim()
	if (!h) return null
	if (ICON_DATA_URI.test(h) || ICON_RELATIVE.test(h)) return h
	throw new PinGuideKitError(
		'iconHref must be a path inside the extension package (e.g. ../icons/icon-48.png) or a ' +
			'data:image/png|jpeg|webp|svg+xml;base64 URI. Remote URLs are refused: the page has to work offline.',
	)
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Burn the icon and the numbered badge into a step's SVG. Geometry comes from
 * the block's own overlay/marker percentages, so the flattened picture is the
 * hosted one pixel for pixel. The badge matches the hosted marker: a 28 px
 * accent disc with a bold white number, at a 640-unit-wide frame.
 */
function flatten(block: PinGuideBlock, iconHref: string | null, accent: string): string {
	const svg = block.media.svg
	const box = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg)
	if (!box) throw new PinGuideKitError(`Step ${block.id} has no viewBox`)
	const w = Number(box[1])
	const h = Number(box[2])
	const parts: string[] = []
	const icon = block.media.icon
	if (icon && iconHref) {
		const size = (icon.size / 100) * w
		const x = (icon.x / 100) * w - size / 2
		const y = (icon.y / 100) * h - size / 2
		parts.push(
			`<image href="${escAttr(iconHref)}" x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" preserveAspectRatio="xMidYMid meet"/>`,
		)
	}
	for (const m of block.media.annotations) {
		const cx = (m.x / 100) * w
		const cy = (m.y / 100) * h
		parts.push(
			`<circle cx="${num(cx)}" cy="${num(cy)}" r="14" fill="${accent}"/>`,
			`<text x="${num(cx)}" y="${num(cy)}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${m.n}</text>`,
		)
	}
	return svg.replace(/<\/svg>$/, `${parts.join('')}</svg>`)
}

/**
 * Mark the menu item drawn inside a step so the script can translate it: the
 * picture carries the English label, and `data-i18n` swaps in the browser's
 * own wording like any other caption. The menu is the last thing drawn, so an
 * extension that happens to be called the same as the label is not touched.
 */
function tagMenuLabel(svg: string, label: string, key: string): string {
	const text = `>${escText(label)}</text>`
	const end = svg.lastIndexOf(text)
	const start = end < 0 ? -1 : svg.lastIndexOf('<text ', end)
	if (start < 0) throw new PinGuideKitError(`The menu item "${label}" is missing from the illustration`)
	return `${svg.slice(0, start)}<text data-i18n="${key}" ${svg.slice(start + '<text '.length)}`
}

/** Put the accessible name on an inline copy; standalone files get it from `<img alt>`. */
function inlineSvg(svg: string, alt: string, altKey: string, cls: string): string {
	return svg.replace(
		'<svg ',
		`<svg class="${cls}" aria-label="${escAttr(alt)}" data-i18n-aria-label="${altKey}" `,
	)
}

/**
 * Build the kit. Throws `PinGuideKitError` on input it cannot honour — an
 * unknown browser or language, an unsafe icon reference, a bad key prefix —
 * rather than producing something subtly wrong.
 */
export function buildPinGuideKit(input: PinGuideKitInput): PinGuideKit {
	const browsers = resolveBrowsers(input.browsers)
	const locales = resolveLocales(input.locales)
	const iconHref = resolveIconHref(input.iconHref)
	const theme: PinGuideKitTheme = input.theme ?? 'light'
	const prefix = input.keyPrefix?.trim() || 'pinGuide'
	if (!KEY_PREFIX.test(prefix)) {
		throw new PinGuideKitError(
			'keyPrefix must start with a letter and use only A-Z, a-z, 0-9 and _ (≤ 40 chars).',
		)
	}
	const accent =
		input.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(input.accentColor)
			? input.accentColor
			: PIN_GUIDE_DEFAULT_ACCENT
	const extensionName = input.extensionName.trim() || 'Your extension'

	const blocksFor = (browser: PinGuideBrowser, t: 'light' | 'dark', locale: PinGuideLocale) =>
		buildPinGuideBlocks({
			extensionName,
			browser,
			accentColor: accent,
			theme: t,
			// The overlay URL is only geometry here; flatten() writes the real href.
			iconUrl: iconHref ? 'icon' : null,
			locale,
		})

	const steps: PinGuideKit['steps'] = {}
	const messages: PinGuideKit['messages'] = {}
	const sections: string[] = []

	for (const [bi, browser] of browsers.entries()) {
		const label = PIN_GUIDE_BROWSER_LABELS[browser]
		const base = theme === 'dark' ? 'dark' : 'light'
		const en = blocksFor(browser, base, 'en')
		const dark = theme === 'auto' ? blocksFor(browser, 'dark', 'en') : null
		const key = (n: number, field: string) => `${prefix}${capitalize(browser)}${n}${field}`

		// Only Firefox writes a menu item into a picture: step 3, the opened ⋯ menu.
		const menuLabel = PIN_GUIDE_STRINGS.en.step3MenuItem
		const browserSteps: PinGuideKitStep[] = en.map((block, i) => {
			const n = i + 1
			const menu = browser === 'firefox' && n === 3 ? key(n, 'Menu') : null
			const picture = (b: PinGuideBlock) => {
				const flat = flatten(b, iconHref, accent)
				return menu ? tagMenuLabel(flat, menuLabel, menu) : flat
			}
			return {
				n,
				svg: picture(block),
				svgDark: dark?.[i] ? picture(dark[i]) : null,
				keys: {
					title: key(n, 'Title'),
					body: block.body === null ? null : key(n, 'Body'),
					alt: key(n, 'Alt'),
					menu,
				},
			}
		})
		steps[browser] = browserSteps

		for (const locale of locales) {
			const localized = locale === 'en' ? en : blocksFor(browser, base, locale)
			const out: Record<string, PinGuideKitMessage> = messages[locale] ?? {}
			messages[locale] = out
			for (const [i, block] of localized.entries()) {
				const s = browserSteps[i]
				if (!s) continue
				const where = `${label} pin guide, step ${s.n}`
				out[s.keys.title] = { message: i18nMessage(block.title), description: `${where}: title` }
				if (s.keys.body && block.body !== null) {
					out[s.keys.body] = { message: i18nMessage(block.body), description: `${where}: body` }
				}
				out[s.keys.alt] = {
					message: i18nMessage(block.media.alt),
					description: `${where}: alt text of the illustration`,
				}
				if (s.keys.menu) {
					out[s.keys.menu] = {
						message: i18nMessage(PIN_GUIDE_STRINGS[locale].step3MenuItem),
						description: `${where}: the browser's menu item, written inside the illustration`,
					}
				}
			}
		}

		const items = en
			.map((block, i) => {
				const s = browserSteps[i]
				if (!s) return ''
				const pictures =
					theme === 'auto' && s.svgDark
						? inlineSvg(s.svg, block.media.alt, s.keys.alt, 'xpg-svg xpg-svg-light') +
							inlineSvg(s.svgDark, block.media.alt, s.keys.alt, 'xpg-svg xpg-svg-dark')
						: inlineSvg(s.svg, block.media.alt, s.keys.alt, 'xpg-svg')
				const body =
					s.keys.body && block.body !== null
						? `<p class="xpg-body" data-i18n="${s.keys.body}">${escText(block.body)}</p>`
						: ''
				return `<li class="xpg-step">${pictures}<p class="xpg-title" data-i18n="${s.keys.title}">${escText(block.title)}</p>${body}</li>`
			})
			.join('\n')
		// The first browser stays visible without the script, so a page whose
		// module failed to load still shows a guide rather than nothing.
		const hidden = bi === 0 ? '' : ' hidden'
		sections.push(
			`<section class="xpg" data-pin-guide-browser="${browser}"${hidden}>\n<ol class="xpg-steps">\n${items}\n</ol>\n</section>`,
		)
	}

	return {
		extensionName,
		browsers,
		locales,
		theme,
		steps,
		html: `${sections.join('\n')}\n`,
		css: pinGuideCss(theme),
		script: PIN_GUIDE_SCRIPT,
		messages,
	}
}

function pinGuideCss(theme: PinGuideKitTheme): string {
	const lines = [
		'/* Pin guide — generated by Extenshi. Layout only; restyle freely. */',
		'.xpg-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 24px; }',
		'.xpg-svg { display: block; width: 100%; height: auto; }',
		'.xpg-title { margin: 10px 0 0; font-weight: 600; }',
		'.xpg-body { margin: 4px 0 0; opacity: 0.8; }',
	]
	if (theme === 'auto') {
		lines.push(
			'.xpg-svg-dark { display: none; }',
			'@media (prefers-color-scheme: dark) {',
			'  .xpg-svg-light { display: none; }',
			'  .xpg-svg-dark { display: block; }',
			'}',
		)
	}
	return `${lines.join('\n')}\n`
}

/**
 * Shipped as a separate file next to the page: the extension CSP forbids
 * inline scripts. Plain ES2020, no build step, works in Chrome, Edge and
 * Firefox. `chrome` and `browser` are both probed because Firefox exposes
 * `getBrowserInfo` only on `browser`.
 */
export const PIN_GUIDE_SCRIPT = `// Pin guide helpers — generated by Extenshi. Load with <script type="module">.

const ext = globalThis.browser ?? globalThis.chrome

/** 'chrome' | 'edge' | 'firefox' — which pin guide this user needs. */
export async function detectPinGuideBrowser() {
  try {
    const info = await globalThis.browser?.runtime?.getBrowserInfo?.()
    if (info && /firefox/i.test(info.name)) return 'firefox'
  } catch {}
  const nav = globalThis.navigator ?? {}
  if (/\\bFirefox\\//.test(nav.userAgent ?? '')) return 'firefox'
  const brands = nav.userAgentData?.brands ?? []
  if (brands.some((b) => /Microsoft Edge/i.test(b.brand)) || /\\bEdg\\//.test(nav.userAgent ?? '')) return 'edge'
  return 'chrome'
}

/** Show only the detected browser's section. Returns the browser it picked. */
export async function showPinGuide(root = document) {
  const browser = await detectPinGuideBrowser()
  const sections = [...root.querySelectorAll('[data-pin-guide-browser]')]
  if (sections.some((s) => s.dataset.pinGuideBrowser === browser)) {
    for (const s of sections) s.hidden = s.dataset.pinGuideBrowser !== browser
  }
  return browser
}

/** Replace the English captions with chrome.i18n messages where the extension has them. */
export function applyPinGuideMessages(root = document) {
  const i18n = ext?.i18n
  if (typeof i18n?.getMessage !== 'function') return
  for (const el of root.querySelectorAll('.xpg [data-i18n]')) {
    const text = i18n.getMessage(el.dataset.i18n)
    if (text) el.textContent = text
  }
  for (const el of root.querySelectorAll('.xpg [data-i18n-aria-label]')) {
    const text = i18n.getMessage(el.dataset.i18nAriaLabel)
    if (text) el.setAttribute('aria-label', text)
  }
}

/**
 * true / false when the browser can tell (action.getUserSettings: Chrome 91+,
 * Edge 91+, Firefox 116+), null when it cannot — then show the guide anyway.
 */
export async function isPinnedToToolbar() {
  const action = ext?.action ?? ext?.browserAction
  if (typeof action?.getUserSettings !== 'function') return null
  try {
    const settings = await action.getUserSettings()
    return typeof settings?.isOnToolbar === 'boolean' ? settings.isOnToolbar : null
  } catch {
    return null
  }
}

/**
 * Call back with the pinned state now and whenever it may have changed: on
 * action.onUserSettingsChanged where it exists (Chrome 130+, Firefox 142+), and
 * whenever the page regains focus or becomes visible — the user pins in the
 * toolbar, outside the page. Returns a function that stops listening.
 */
export function onPinnedChange(callback) {
  let last
  const check = async () => {
    const value = await isPinnedToToolbar()
    if (value !== last) {
      last = value
      callback(value)
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  const changed = (ext?.action ?? ext?.browserAction)?.onUserSettingsChanged
  changed?.addListener?.(check)
  globalThis.addEventListener('focus', check)
  document.addEventListener('visibilitychange', onVisible)
  check()
  return () => {
    changed?.removeListener?.(check)
    globalThis.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
`
