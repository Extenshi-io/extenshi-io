/**
 * Pin guide — the templated "find the extension and pin it to the toolbar"
 * illustration sequence.
 *
 * This is the single highest-value thing a welcome page can teach: a new user
 * who never finds the toolbar button churns silently. The steps are the same
 * for every Chromium extension on earth, so they are TEMPLATES, not something
 * an author (or a model) should redraw each time — the only per-extension part
 * is the icon, which rides in as an overlay.
 *
 * Output is `WelcomeBlock[]`, i.e. the same block model the constructor, the
 * renderer and the agent brief already speak. That is what lets this generator
 * be BOTH a standalone tool and a section inside the welcome-page builder
 * without a second implementation.
 *
 * The SVG is written to survive `scrubSvgMarkup` untouched: flat shapes, no
 * script/style/animation, no external or `data:` references. Anything that
 * would be stripped is deliberately absent rather than "sanitized later".
 *
 * Fidelity matters here more than it looks. The guide's whole job is that a
 * user recognises the drawing as their own toolbar, so the browser chrome is
 * modelled (tab strip, back/forward/reload/home, omnibox with lock and star,
 * app menu) and the extensions button uses the real jigsaw glyph rather than a
 * hand-rolled approximation. The per-row control differs by browser and is
 * drawn as what that browser actually shows: a pushpin in Chrome, an eye in
 * Edge, a ⋯ overflow menu in Firefox.
 *
 * SELF-CONTAINED ON PURPOSE — its only import is the sibling captions file, so
 * the pair (plus pin-guide-kit.ts) can be copied into the published `@extenshi/mcp`
 * and `@extenshi/cli` packages. The copy procedure and the drift
 * tests are described at the top of ./pin-guide-strings.ts. The block types
 * below are structural stand-ins for `WelcomeBlock` (shared-types/onboarding-page.ts):
 * every value this file returns is assignable to it, which the welcome builder
 * and the BFF tests rely on.
 */

import type { PinGuideLocale } from './pin-guide-strings.js'
import { PIN_GUIDE_STRINGS, pinGuideLocale, pinGuideText } from './pin-guide-strings.js'

export type PinGuideBrowser = 'chrome' | 'edge' | 'firefox'

/** Same value as WELCOME_DEFAULT_ACCENT (shared-types/welcome-agent-brief.ts), pinned by a test. */
export const PIN_GUIDE_DEFAULT_ACCENT = '#5e5ce6'

/** The extension's icon drawn over an illustration, in percent of the frame. */
export interface PinGuideIconOverlay {
	url: string
	x: number
	y: number
	size: number
}

/** A numbered badge, in percent of the frame. */
export interface PinGuideMarker {
	x: number
	y: number
	kind: 'number'
	n: number
	label: null
}

export interface PinGuideBlock {
	kind: 'step'
	id: string
	title: string
	body: string | null
	media: {
		source: 'svg'
		svg: string
		alt: string
		annotations: PinGuideMarker[]
		icon: PinGuideIconOverlay | null
	}
}

export const PIN_GUIDE_BROWSER_LABELS: Record<PinGuideBrowser, string> = {
	chrome: 'Chrome',
	edge: 'Edge',
	firefox: 'Firefox',
}

export interface PinGuideInput {
	extensionName: string
	browser: PinGuideBrowser
	/** Accent used for highlight rings, matching the page's accent. */
	accentColor: string
	/**
	 * The extension's icon. When absent the illustration falls back to a neutral
	 * placeholder tile — still useful, just less recognisable.
	 */
	iconUrl?: string | null
	/** Light/dark chrome, so the mock matches the page it sits on. */
	theme?: 'light' | 'dark'
	/**
	 * Caption language. Unknown tags fall back to English, which is also the
	 * default — and the English output is what hosted pages have always shown.
	 */
	locale?: PinGuideLocale | string
}

const VIEW_W = 640
/**
 * Frames are as short as their content allows rather than a single tall canvas:
 * a toolbar-only step padded out to the height of the open-menu step is mostly
 * empty page, which reads as a rendering bug rather than as breathing room.
 */
const H_TOOLBAR = 168
const H_MENU = 240

/** Toolbar band: everything above is the tab strip, everything below is the page. */
const TOOLBAR_Y = 38
const TOOLBAR_H = 44
const CONTENT_Y = TOOLBAR_Y + TOOLBAR_H
const ICON_CY = TOOLBAR_Y + TOOLBAR_H / 2

interface Palette {
	chromeBg: string
	toolbarBg: string
	urlBg: string
	stroke: string
	text: string
	pageBg: string
	panelBg: string
	rowBg: string
}

function palette(theme: 'light' | 'dark'): Palette {
	return theme === 'dark'
		? {
				chromeBg: '#202124',
				toolbarBg: '#292a2d',
				urlBg: '#35363a',
				stroke: '#585b60',
				text: '#c4c7cb',
				pageBg: '#1b1c1f',
				panelBg: '#303134',
				rowBg: '#3c3d40',
			}
		: {
				chromeBg: '#dee1e6',
				toolbarBg: '#ffffff',
				urlBg: '#f1f3f4',
				stroke: '#bfc4cc',
				text: '#5f6368',
				pageBg: '#f8f9fa',
				panelBg: '#ffffff',
				rowBg: '#eef1f5',
			}
}

/**
 * Per-browser UI facts. Only the extensions button is shared — every browser
 * has settled on the same jigsaw glyph for it (Firefox since its unified
 * extensions button landed), but what you click *inside* the panel to pin has
 * not converged, and naming the wrong control is exactly the kind of detail
 * that makes a user give up on the guide.
 */
interface BrowserUi {
	/** The per-row control that pins the extension. Its wording lives in ./pin-guide-strings.ts. */
	toggle: 'pin' | 'eye' | 'more'
	/** The browser's own app menu, at the far right of the toolbar. */
	appMenu: 'kebab' | 'ellipsis' | 'hamburger'
}

const BROWSER_UI: Record<PinGuideBrowser, BrowserUi> = {
	chrome: { toggle: 'pin', appMenu: 'kebab' },
	edge: { toggle: 'eye', appMenu: 'ellipsis' },
	firefox: { toggle: 'more', appMenu: 'hamburger' },
}

/** Escape text that goes inside an SVG text node. */
function esc(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

/** Truncate a display name so it cannot overflow the mocked menu row. */
function clip(s: string, max = 22): string {
	const t = s.trim()
	return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

function num(n: number): string {
	return String(Math.round(n * 1000) / 1000)
}

/**
 * Material-style 24×24 glyphs, placed by translate+scale.
 *
 * These are the real icon outlines the browsers ship, not approximations: a
 * blocky stand-in reads as "some square button" and the user never matches it
 * against their own toolbar, which defeats the illustration.
 */
const GLYPH_24 = {
	// The jigsaw "extension" piece — Chrome, Edge and Firefox all use this shape
	// for the extensions button.
	puzzle:
		'<path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/>',
	// Pushpin, as shown beside each row in the Chrome extensions panel.
	pin: '<path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>',
	// Eye — Edge's "Show in toolbar" toggle.
	eye: '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
	// Horizontal ⋯ — Firefox's per-extension overflow button.
	more: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
} as const

function glyph(inner: string, x: number, y: number, size: number, fill: string): string {
	return `<g transform="translate(${num(x)} ${num(y)}) scale(${num(size / 24)})" fill="${fill}">${inner}</g>`
}

/**
 * Draw a callout: the accent ring on the target, plus the leader towards its
 * badge. Emitted together so a frame can never carry one without the other.
 *
 * The ring comes first in the markup, which is also the order the tests look for
 * it: the badge-outside-ring invariant reads the first accent-stroked rect.
 */
function drawCallout(c: Callout, accent: string): string {
	const { box, leader } = c
	const rx = Math.min(box.w, box.h) / 2
	return (
		`<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${num(rx)}" fill="none" stroke="${accent}" stroke-width="3"/>` +
		`<path d="M ${num(leader[0])} ${num(leader[1])} L ${num(leader[2])} ${num(leader[3])}" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`
	)
}

/** A list row. `rx` is carried per row rather than derived: the zoomed frame is
 *  drawn at a different scale, and its roundness was tuned by eye. */
interface RowBox {
	x: number
	y: number
	w: number
	h: number
	rx: number
}

// ── Toolbar geometry ──────────────────────────────────────────────────────────
/** The extensions (puzzle) button. */
const MENU_BTN = { x: 526, y: 48, w: 28, h: 24 }
/** Where a pinned extension icon lands: between the omnibox and the puzzle. */
const PINNED = { x: 500, y: 50, size: 20 }
/** The dropped-down extensions panel. */
const PANEL = { x: 364, y: 92, w: 260, h: 130 }
/** Our extension's row inside that panel, and the two controls on it. */
const ROW: RowBox = { x: 374, y: 120, w: 240, h: 34, rx: 8 }
const ICON_IN_ROW = { x: 384, y: 128, size: 18 }
const TOGGLE = { x: 586, y: 128, size: 18 }
/** The greyed filler row, its contents, and the panel's header/footer bars. */
const ROW_2: RowBox = { x: 374, y: 160, w: 240, h: 34, rx: 8 }
const ICON_IN_ROW_2 = { x: 384, y: 168, size: 18 }
const TOGGLE_2 = { x: 586, y: 168, size: 18 }
const ROW_2_TEXT = { x: 410, y: 173, w: 86, h: 6 }
const PANEL_HEADER = { x: 380, y: 104, w: 72, h: 7 }
const PANEL_FOOTER = { x: 384, y: 204, w: 104, h: 6 }

// ── Step-3 zoom geometry ──────────────────────────────────────────────────────
// Step 3 zooms the row so the control it is about is not an 18px speck. Named
// out in full, like the toolbar above: the frame has to stay internally
// consistent when any one of these moves.
const ZOOM_PANEL = { x: 90, y: 24, w: 460, h: 192 }
const ZOOM_HEADER = { x: 118, y: 50, w: 120, h: 10 }
const ZOOM_ROW: RowBox = { x: 106, y: 76, w: 428, h: 58, rx: 12 }
const ZOOM_ICON = { x: 126, y: 90, size: 30 }
const ZOOM_TOGGLE = { x: 484, y: 90, size: 30 }
const ZOOM_ROW_2: RowBox = { x: 106, y: 146, w: 428, h: 48, rx: 12 }
const ZOOM_ICON_2 = { x: 126, y: 158, size: 24 }
const ZOOM_TOGGLE_2 = { x: 487, y: 158, size: 24 }
const ZOOM_ROW_2_TEXT = { x: 166, y: 168, w: 120, h: 8 }
/** Where the extension's name sits in each row. */
const ROW_TEXT_ANCHOR = { x: 410, y: 141, size: 13 }
const ZOOM_TEXT_ANCHOR = { x: 172, y: 113, size: 20 }

// ── Callouts: the ring, its leader, and where the badge lands ─────────────────
/**
 * A callout is one padded box around a click target. The drawn ring, the accent
 * leader and the numbered badge's anchor are all derived from that single box,
 * so nudging a target moves all three together — the badge cannot drift back
 * onto the control, and it cannot drift so far that it points at nothing.
 *
 * Offsets are shared by every frame. They were per-frame before, which is only
 * why the badge anchors used to be unexplainable literals: the value fell out of
 * whatever ring padding that step happened to use.
 */
const LEADER_GAP = 4
const LEADER_LEN = 12
/** Clearance from the leader's end to the badge's CENTRE. The badge is a
 *  fixed-pixel overlay ~14px in radius, so this has to leave room for it. */
const BADGE_GAP = 20

interface Callout {
	/** The padded box, i.e. exactly what the accent ring is drawn on. */
	box: { x: number; y: number; w: number; h: number }
	/** Leader endpoints, from just outside the ring towards the badge. */
	leader: [number, number, number, number]
	/** Badge centre, in viewBox units. */
	badge: [number, number]
}

type CalloutDir = 'down' | 'left' | 'right'

/**
 * Build a callout around a target box.
 *
 * `len` overrides the leader length for the one frame (step 3's zoom) drawn at a
 * different scale, where the shared length reads as a stub.
 */
function callout(
	target: { x: number; y: number; w: number; h: number },
	dir: CalloutDir,
	pad: number,
	len = LEADER_LEN,
): Callout {
	const box = { x: target.x - pad, y: target.y - pad, w: target.w + pad * 2, h: target.h + pad * 2 }
	const cx = box.x + box.w / 2
	const cy = box.y + box.h / 2

	if (dir === 'down') {
		const from = box.y + box.h + LEADER_GAP
		const to = from + len
		return { box, leader: [cx, from, cx, to], badge: [cx, to + BADGE_GAP] }
	}
	if (dir === 'right') {
		const from = box.x + box.w + LEADER_GAP
		const to = from + len
		return { box, leader: [from, cy, to, cy], badge: [to + BADGE_GAP, cy] }
	}
	const from = box.x - LEADER_GAP
	const to = from - len
	return { box, leader: [from, cy, to, cy], badge: [to - BADGE_GAP, cy] }
}

/** A square target box, for the icon-sized controls. */
function square(t: { x: number; y: number; size: number }) {
	return { x: t.x, y: t.y, w: t.size, h: t.size }
}

function appMenu(kind: BrowserUi['appMenu'], p: Palette): string {
	const cx = 604
	if (kind === 'hamburger') {
		return `<path d="M ${cx - 7} ${ICON_CY - 5} h 14 M ${cx - 7} ${ICON_CY} h 14 M ${cx - 7} ${ICON_CY + 5} h 14" stroke="${p.text}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`
	}
	// Typed as tuples so destructuring yields `number`, not `number | undefined`:
	// a bare `number[][]` needed casts that would have survived a shape change.
	const dots: [number, number][] =
		kind === 'ellipsis'
			? [
					[cx - 6, ICON_CY],
					[cx, ICON_CY],
					[cx + 6, ICON_CY],
				]
			: [
					[cx, ICON_CY - 6],
					[cx, ICON_CY],
					[cx, ICON_CY + 6],
				]
	return dots.map(([x, y]) => `<circle cx="${num(x)}" cy="${num(y)}" r="1.8" fill="${p.text}"/>`).join('')
}

/**
 * The window: tab strip, navigation controls, omnibox, toolbar buttons, page.
 *
 * Everything here is chrome the user sees every day; the closer it is, the more
 * the highlighted control reads as "that thing on my screen".
 */
function browserFrame(p: Palette, ui: BrowserUi, h: number): string {
	const nav = `stroke="${p.text}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"`
	return [
		// Window + tab strip.
		`<rect x="0" y="0" width="${VIEW_W}" height="${h}" rx="12" fill="${p.chromeBg}"/>`,
		`<circle cx="22" cy="23" r="5" fill="#ff5f57"/>`,
		`<circle cx="38" cy="23" r="5" fill="#febc2e"/>`,
		`<circle cx="54" cy="23" r="5" fill="#28c840"/>`,
		`<rect x="72" y="8" width="200" height="30" rx="8" fill="${p.toolbarBg}"/>`,
		`<circle cx="92" cy="23" r="6" fill="${p.stroke}"/>`,
		`<rect x="106" y="20" width="118" height="6" rx="3" fill="${p.stroke}"/>`,
		`<path d="M 246 20 l 6 6 M 252 20 l -6 6" stroke="${p.stroke}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
		`<path d="M 290 17 v 12 M 284 23 h 12" stroke="${p.text}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,

		// Toolbar band + page.
		`<rect x="0" y="${TOOLBAR_Y}" width="${VIEW_W}" height="${TOOLBAR_H}" fill="${p.toolbarBg}"/>`,
		`<path d="M 0 ${CONTENT_Y} H ${VIEW_W} V ${h - 12} a 12 12 0 0 1 -12 12 H 12 a 12 12 0 0 1 -12 -12 Z" fill="${p.pageBg}"/>`,

		// Back / forward (forward greyed, as it is on a fresh tab) / reload / home.
		`<path d="M 36 60 H 25 M 30 55 L 25 60 L 30 65" ${nav}/>`,
		`<path d="M 52 60 H 63 M 58 55 L 63 60 L 58 65" stroke="${p.stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
		`<path d="M 89.9 55.4 A 6 6 0 1 1 84 54.4" ${nav}/>`,
		`<path d="M 81.5 51.4 L 87 55 L 81.8 57.6 Z" fill="${p.text}"/>`,
		`<path d="M 106.5 60.5 L 114 54 L 121.5 60.5 M 109 58.5 V 66.5 H 119 V 58.5" ${nav}/>`,

		// Omnibox: lock, url text, bookmark star (which lives inside it).
		`<rect x="132" y="48" width="358" height="24" rx="12" fill="${p.urlBg}"/>`,
		`<rect x="144" y="58" width="9" height="7" rx="1.5" fill="${p.text}"/>`,
		`<path d="M 146 58 v -2 a 2.5 2.5 0 0 1 5 0 v 2" stroke="${p.text}" stroke-width="1.4" fill="none"/>`,
		`<rect x="163" y="57" width="186" height="6" rx="3" fill="${p.stroke}"/>`,
		`<path d="M 476 53.5 L 477.65 57.74 L 482.18 57.99 L 478.66 60.87 L 479.82 65.26 L 476 62.8 L 472.18 65.26 L 473.34 60.87 L 469.82 57.99 L 474.35 57.74 Z" stroke="${p.stroke}" stroke-width="1.4" stroke-linejoin="round" fill="none"/>`,

		// Profile avatar + the browser's own menu.
		`<circle cx="574" cy="${ICON_CY}" r="9" fill="${p.stroke}"/>`,
		appMenu(ui.appMenu, p),
	].join('')
}

/** The extensions button glyph. Its callout, when it has one, is drawn by the step. */
function menuButton(p: Palette): string {
	return glyph(GLYPH_24.puzzle, MENU_BTN.x + 6, MENU_BTN.y + 4, 16, p.text)
}

/** A grey rounded bar — the stand-in for text we do not spell out in the mock. */
function bar(b: { x: number; y: number; w: number; h: number }, p: Palette): string {
	return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="${num(b.h / 2)}" fill="${p.stroke}"/>`
}

/** One list row: filled when it is ours, outlined when it is filler. */
function row(r: RowBox, fill: string | null, p: Palette): string {
	const paint = fill ? `fill="${fill}"` : `fill="none" stroke="${p.stroke}"`
	return `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" rx="${num(r.rx)}" ${paint}/>`
}

/** The extension's name, drawn into a row. */
function rowText(anchor: { x: number; y: number; size: number }, name: string, p: Palette): string {
	return `<text x="${num(anchor.x)}" y="${num(anchor.y)}" font-family="system-ui, sans-serif" font-size="${num(anchor.size)}" fill="${p.text}">${esc(name)}</text>`
}

/** Placeholder tile drawn only when the author has no icon yet. */
function iconPlaceholder(x: number, y: number, size: number, p: Palette): string {
	return `<rect x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" rx="${num(size / 3.5)}" fill="${p.stroke}"/>`
}

function svgDoc(body: string, h: number): string {
	return `<svg viewBox="0 0 ${VIEW_W} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">${body}</svg>`
}

/** Convert a pixel box in the mock's viewBox into overlay percentages. */
function overlay(url: string, xPx: number, yPx: number, sizePx: number, h: number): PinGuideIconOverlay {
	return {
		url,
		x: ((xPx + sizePx / 2) / VIEW_W) * 100,
		y: ((yPx + sizePx / 2) / h) * 100,
		size: (sizePx / VIEW_W) * 100,
	}
}

/**
 * A numbered marker, positioned in percent of the frame.
 *
 * Takes a callout's badge anchor rather than loose coordinates, so a marker
 * cannot be placed anywhere the ring and leader are not already pointing.
 */
function marker(badge: readonly [number, number], n: number, h: number): PinGuideMarker {
	return { x: (badge[0] / VIEW_W) * 100, y: (badge[1] / h) * 100, kind: 'number', n, label: null }
}

/**
 * Build the four-step pin sequence.
 *
 * Step 3 (the pin toggle) is the one users actually miss, so it gets its own
 * frame rather than being folded into step 2 — the whole point of the guide is
 * that clicking the row is not the same as pinning it — and that frame is a
 * zoom of the row, because at toolbar scale the control is 18px wide and the
 * numbered badge that points at it is larger than the thing it points at.
 *
 * Badges are deliberately placed OFF the target with a short accent leader
 * running back to the ring. The badge is a fixed-pixel HTML overlay while the
 * illustration scales with the column, so a badge centred on its target covers
 * it outright at every width the preview is ever rendered at.
 */
export function buildPinGuideBlocks(input: PinGuideInput): PinGuideBlock[] {
	const theme = input.theme ?? 'light'
	const p = palette(theme)
	// Validated here, not just at the call sites: this function is exported and
	// the value lands unquoted inside SVG attributes, so a caller passing
	// `#fff" onload="…` would be writing markup rather than a colour. The
	// scrubber would strip the handler afterwards, but the illustration would
	// still be corrupt — and `buildWelcomeHtml` already guards its own accent the
	// same way, so leaving this path unguarded was simply inconsistent.
	const accent = /^#[0-9a-fA-F]{3,8}$/.test(input.accentColor) ? input.accentColor : PIN_GUIDE_DEFAULT_ACCENT
	const ui = BROWSER_UI[input.browser]
	const name = clip(input.extensionName || 'Your extension')
	const browserLabel = PIN_GUIDE_BROWSER_LABELS[input.browser]
	const toggleGlyph = GLYPH_24[ui.toggle]
	const t = PIN_GUIDE_STRINGS[pinGuideLocale(input.locale)]
	const fill = (template: string) => pinGuideText(template, { name, browser: browserLabel })

	// ── Step 1: locate the extensions button ────────────────────────────────
	const call1 = callout(MENU_BTN, 'down', 5)
	const step1 = svgDoc(
		`${browserFrame(p, ui, H_TOOLBAR)}${menuButton(p)}${drawCallout(call1, accent)}`,
		H_TOOLBAR,
	)

	// ── Step 2: the open panel, with our row highlighted ────────────────────
	const panel = [
		`<rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" rx="12" fill="${p.panelBg}" stroke="${p.stroke}"/>`,
		bar(PANEL_HEADER, p),
		row(ROW, p.rowBg, p),
		rowText(ROW_TEXT_ANCHOR, name, p),
		glyph(toggleGlyph, TOGGLE.x, TOGGLE.y, TOGGLE.size, p.text),
		// A second, greyed row so the panel reads as a list rather than one card.
		row(ROW_2, null, p),
		iconPlaceholder(ICON_IN_ROW_2.x, ICON_IN_ROW_2.y, ICON_IN_ROW_2.size, p),
		bar(ROW_2_TEXT, p),
		glyph(toggleGlyph, TOGGLE_2.x, TOGGLE_2.y, TOGGLE_2.size, p.stroke),
		bar(PANEL_FOOTER, p),
	].join('')

	const rowIconPlaceholder = input.iconUrl
		? ''
		: iconPlaceholder(ICON_IN_ROW.x, ICON_IN_ROW.y, ICON_IN_ROW.size, p)

	const call2 = callout(ROW, 'left', 5)
	const step2 = svgDoc(
		`${browserFrame(p, ui, H_MENU)}${menuButton(p)}${panel}${rowIconPlaceholder}${drawCallout(call2, accent)}`,
		H_MENU,
	)

	// ── Step 3: a close-up of the row, so the toggle is a real target ───────
	const zoomIconPlaceholder = input.iconUrl
		? ''
		: iconPlaceholder(ZOOM_ICON.x, ZOOM_ICON.y, ZOOM_ICON.size, p)

	// The zoom is drawn at ~1.7x the toolbar frame, so the shared leader length
	// reads as a stub here; 22 keeps it proportional to the ring it leaves.
	const call3 = callout(square(ZOOM_TOGGLE), 'right', 10, 22)
	const step3 = svgDoc(
		[
			`<rect x="0" y="0" width="${VIEW_W}" height="${H_MENU}" rx="12" fill="${p.pageBg}"/>`,
			`<rect x="${ZOOM_PANEL.x}" y="${ZOOM_PANEL.y}" width="${ZOOM_PANEL.w}" height="${ZOOM_PANEL.h}" rx="16" fill="${p.panelBg}" stroke="${p.stroke}"/>`,
			bar(ZOOM_HEADER, p),
			row(ZOOM_ROW, p.rowBg, p),
			zoomIconPlaceholder,
			rowText(ZOOM_TEXT_ANCHOR, name, p),
			glyph(toggleGlyph, ZOOM_TOGGLE.x, ZOOM_TOGGLE.y, ZOOM_TOGGLE.size, p.text),
			row(ZOOM_ROW_2, null, p),
			iconPlaceholder(ZOOM_ICON_2.x, ZOOM_ICON_2.y, ZOOM_ICON_2.size, p),
			bar(ZOOM_ROW_2_TEXT, p),
			glyph(toggleGlyph, ZOOM_TOGGLE_2.x, ZOOM_TOGGLE_2.y, ZOOM_TOGGLE_2.size, p.stroke),
			drawCallout(call3, accent),
		].join(''),
		H_MENU,
	)

	// ── Step 4: pinned in the toolbar ───────────────────────────────────────
	const pinnedPlaceholder = input.iconUrl ? '' : iconPlaceholder(PINNED.x, PINNED.y, PINNED.size, p)
	const call4 = callout(square(PINNED), 'down', 6)
	const step4 = svgDoc(
		`${browserFrame(p, ui, H_TOOLBAR)}${menuButton(p)}${pinnedPlaceholder}${drawCallout(call4, accent)}`,
		H_TOOLBAR,
	)

	const icon = (xPx: number, yPx: number, sizePx: number, h: number): PinGuideIconOverlay | null =>
		input.iconUrl ? overlay(input.iconUrl, xPx, yPx, sizePx, h) : null

	return [
		{
			kind: 'step',
			id: 'pin-1',
			title: fill(t.step1Title),
			body: fill(t.step1Body),
			media: {
				source: 'svg',
				svg: step1,
				alt: fill(t.step1Alt),
				annotations: [marker(call1.badge, 1, H_TOOLBAR)],
				icon: null,
			},
		},
		{
			kind: 'step',
			id: 'pin-2',
			title: fill(t.step2Title),
			body: null,
			media: {
				source: 'svg',
				svg: step2,
				alt: fill(t.step2Alt),
				annotations: [marker(call2.badge, 2, H_MENU)],
				icon: icon(ICON_IN_ROW.x, ICON_IN_ROW.y, ICON_IN_ROW.size, H_MENU),
			},
		},
		{
			kind: 'step',
			id: 'pin-3',
			title: fill(t.step3Title[input.browser]),
			body: fill(t.step3Body[input.browser]),
			media: {
				source: 'svg',
				svg: step3,
				alt: fill(t.step3Alt[input.browser]),
				annotations: [marker(call3.badge, 3, H_MENU)],
				icon: icon(ZOOM_ICON.x, ZOOM_ICON.y, ZOOM_ICON.size, H_MENU),
			},
		},
		{
			kind: 'step',
			id: 'pin-4',
			title: fill(t.step4Title),
			body: fill(t.step4Body),
			media: {
				source: 'svg',
				svg: step4,
				alt: fill(t.step4Alt),
				annotations: [marker(call4.badge, 4, H_TOOLBAR)],
				icon: icon(PINNED.x, PINNED.y, PINNED.size, H_TOOLBAR),
			},
		},
	]
}
