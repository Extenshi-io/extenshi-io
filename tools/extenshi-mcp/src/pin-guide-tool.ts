/**
 * Static content for the free `generate_pin_guide` MCP tool.
 *
 * Like `generate_icon_workflow`, this spends ZERO Extenshi credits and touches
 * no Extenshi infrastructure: the kit is a pure function of its arguments
 * (./pin-guide-kit.ts, a synced copy of the shared-types generator the
 * Dojo pin-guide tool and the hosted welcome pages use), so it works offline
 * and on the remote connector alike.
 *
 * Size (directory policy 5B): a full kit for three browsers and eleven
 * languages is ~80 KB, far past a proportionate default. So the default
 * response is an overview — what the kit contains, how big each part is, how
 * it is wired — and each part (`html`, `messages`, `script`, `css`) comes back
 * only when asked for, narrowed by `browsers` / `locales`. The CLI writes the
 * whole kit to disk in one go.
 */

import {
	buildPinGuideKit,
	chromeLocaleDir,
	type PinGuideKit,
	type PinGuideKitTheme,
} from './pin-guide-kit.js'

export const PIN_GUIDE_PARTS = ['overview', 'html', 'messages', 'script', 'css'] as const
export type PinGuidePart = (typeof PIN_GUIDE_PARTS)[number]

export interface PinGuideToolArgs {
	extensionName?: string
	browsers?: string[]
	locales?: string[]
	theme?: PinGuideKitTheme
	iconHref?: string
	accentColor?: string
	keyPrefix?: string
	part?: PinGuidePart
}

function kb(s: string): string {
	const k = Buffer.byteLength(s, 'utf8') / 1024
	return k < 1 ? '<1 KB' : `${Math.round(k)} KB`
}

function messagesJson(kit: PinGuideKit): string {
	const byFolder: Record<string, unknown> = {}
	for (const l of kit.locales) byFolder[chromeLocaleDir(l)] = kit.messages[l]
	return JSON.stringify(byFolder, null, 2)
}

function shellQuote(s: string): string {
	return `'${s.replaceAll("'", "'\\''")}'`
}

function cliCommand(args: PinGuideToolArgs, kit: PinGuideKit): string {
	const parts = ['npx @extenshi/cli pin-guide', `--name ${shellQuote(kit.extensionName)}`]
	if (args.browsers?.length) parts.push(`--browsers ${kit.browsers.join(',')}`)
	if (args.locales?.length) parts.push(`--locales ${kit.locales.join(',')}`)
	if (args.theme) parts.push(`--theme ${args.theme}`)
	if (args.accentColor) parts.push(`--accent ${shellQuote(args.accentColor)}`)
	if (args.keyPrefix) parts.push(`--key-prefix ${args.keyPrefix}`)
	parts.push(args.iconHref ? `--icon-href ${shellQuote(args.iconHref)}` : '--icon <icon.png>')
	parts.push('--out welcome/pin-guide')
	return parts.join(' ')
}

/** Throws PinGuideKitError (an authored, user-facing message) on unusable input. */
export function renderPinGuide(args: PinGuideToolArgs): string {
	const kit = buildPinGuideKit({
		extensionName: args.extensionName ?? '',
		browsers: args.browsers,
		locales: args.locales,
		theme: args.theme,
		iconHref: args.iconHref,
		accentColor: args.accentColor,
		keyPrefix: args.keyPrefix,
	})

	switch (args.part ?? 'overview') {
		case 'html':
			return kit.html
		case 'messages':
			return messagesJson(kit)
		case 'script':
			return kit.script
		case 'css':
			return kit.css
		default:
			return renderOverview(args, kit)
	}
}

function renderOverview(args: PinGuideToolArgs, kit: PinGuideKit): string {
	const browserNames = kit.browsers.map((b) => b.charAt(0).toUpperCase() + b.slice(1)).join(', ')
	const prefix = args.keyPrefix?.trim() || 'pinGuide'
	const perLanguage = Object.keys(kit.messages.en ?? {}).length
	const icon = args.iconHref?.trim()
		? `\`${args.iconHref.trim().slice(0, 80)}${args.iconHref.trim().length > 80 ? '…' : ''}\``
		: 'none (a neutral tile is drawn in its place)'

	return [
		`# Pin guide kit for "${kit.extensionName}"`,
		'',
		`Browsers: ${browserNames}. Languages: ${kit.locales.join(', ')}. Theme: ${kit.theme}. Icon: ${icon}.`,
		'',
		'Four illustrated steps per browser: open the puzzle (extensions) menu, find the extension,',
		'pin it (a pushpin in Chrome, an eye in Edge, ⋯ → "Pin to Toolbar" in Firefox), see the icon',
		'in the toolbar. The icon and the numbered markers are drawn inside each SVG, so the pictures',
		'need no overlay renderer, no network access and no inline script — they suit a welcome page',
		'bundled in the extension package and running under its CSP. Firefox captions quote the',
		"menu label from Firefox's own translations.",
		'',
		'## Parts (`part` argument)',
		'',
		'| part | content | size |',
		'|---|---|---|',
		`| \`html\` | One \`<section data-pin-guide-browser>\` per browser with inline SVGs and English captions marked \`data-i18n\`. No scripts, event handlers or inline styles. The first browser is visible, the rest carry \`hidden\`. | ${kb(kit.html)} |`,
		`| \`messages\` | \`chrome.i18n\` entries per language, keyed by \`_locales\` folder (\`pt_BR\`, \`zh_CN\`), ready to merge into \`_locales/<folder>/messages.json\`. | ${kb(messagesJson(kit))} |`,
		`| \`script\` | ES module for a separate file next to the page (the extension CSP forbids inline scripts). | ${kb(kit.script)} |`,
		`| \`css\` | Layout${kit.theme === 'auto' ? ', plus the light/dark switch' : ''}. | ${kb(kit.css)} |`,
		'',
		'Narrowing `browsers` or `locales` shrinks `html` and `messages` proportionally.',
		'',
		'## Message names',
		'',
		`\`${prefix}<Browser><step><Title|Body|Alt>\`, e.g. \`${prefix}Chrome1Title\`; step 2 has no Body.`,
		`${perLanguage} names per language for this selection. \`$\` in the extension name is written \`$$\`,`,
		'as `chrome.i18n` requires.',
		'',
		'## Wiring in an extension page',
		'',
		'1. The `html` goes where the pin step sits on the welcome page; `css` loads with `<link>`,',
		'   `script` with `<script type="module">`.',
		'2. `showPinGuide()` unhides the section for the current browser (Firefox via',
		'   `runtime.getBrowserInfo`, Edge via `navigator.userAgentData.brands`, otherwise Chrome).',
		'   `applyPinGuideMessages()` swaps the English captions for `chrome.i18n` messages.',
		'3. `isPinnedToToolbar()` reads `action.getUserSettings().isOnToolbar` (Chrome and Edge 91+,',
		'   Firefox 116+) and returns `null` where the browser cannot tell — the guide then stays',
		'   visible. `onPinnedChange(callback)` re-checks on `action.onUserSettingsChanged` (Chrome',
		'   130+, Firefox 142+), on `focus` and on `visibilitychange`, so the step can collapse to a',
		'   "pinned" confirmation.',
		'',
		'## The same kit as files',
		'',
		'```bash',
		cliCommand(args, kit),
		'```',
		'',
		'writes `pin-guide.html`, `pin-guide.css`, `pin-guide.js`, `svg/<browser>-<n>.svg` (standalone',
		'pictures for `<img>`), `messages/<folder>.json` and `pin-guide.json`. `--icon <file>` embeds',
		'the icon as a data URI; `--icon-href` references the copy already in the package.',
	].join('\n')
}
