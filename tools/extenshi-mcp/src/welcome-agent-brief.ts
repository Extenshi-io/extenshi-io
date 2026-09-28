/**
 * Welcome-page goal presets + the AI-agent brief.
 *
 * SELF-CONTAINED ON PURPOSE — no imports, so it can be copied verbatim into the
 * published `@extenshi/mcp` package, which cannot depend on unpublished
 * workspace packages (same constraint and same solution as svg-scrub.ts).
 *
 * SINGLE SOURCE, TWO COPIES, byte-identical:
 *   shared-types/welcome-agent-brief.ts          (canonical — edit here)
 *   tools/extenshi-mcp/src/welcome-agent-brief.ts (synced copy for @extenshi/mcp)
 * after editing, run:
 *   cp shared-types/welcome-agent-brief.ts tools/extenshi-mcp/src/welcome-agent-brief.ts
 * A test in tools/extenshi-mcp/src/welcome-workflow.test.ts fails CI on drift.
 *
 * Why the sync is load-bearing rather than tidy: the brief tells an agent what
 * to build AND states the limits the save path enforces. If the MCP copy drifts,
 * an agent produces blocks against one spec and catalog-bff rejects them against
 * another — and the author sees a validation error for work they were told to do.
 */

// ── Caps (mirrored by the zod schemas in catalog-bff/src/lib/welcome-blocks.ts) ──

export const WELCOME_MAX_BLOCKS = 14
export const WELCOME_MAX_ANNOTATIONS = 8
export const WELCOME_TEXT_MAX_LEN = 600
export const WELCOME_TITLE_MAX_LEN = 120
export const WELCOME_ALT_MAX_LEN = 200
/** Inline SVG cap — an instructional diagram, not an embedded illustration set. */
export const WELCOME_SVG_MAX_LEN = 24_000
export const WELCOME_UPLOAD_MAX_BYTES = 2 * 1024 * 1024
export const WELCOME_DEFAULT_ACCENT = '#5e5ce6'

// ── Goal — what the page is trying to make the user DO ──────────────────────

/**
 * A welcome page exists to drive exactly one action. Naming that action is the
 * single highest-leverage input to both the default copy and the agent brief:
 * in ~90% of extensions the valuable action is "find and pin the extension",
 * but a new-tab replacement instead needs the user to accept the override, and
 * a content-script widget needs them to visit the target site and spot it.
 */
export type WelcomeGoal = 'PIN_EXTENSION' | 'NEW_TAB_OPT_IN' | 'VISIT_SITE' | 'CUSTOM'

export interface WelcomeGoalPreset {
	goal: WelcomeGoal
	label: string
	/** One-line description of the action, shown in the constructor. */
	summary: string
	defaultHeadline: string
	defaultMessage: string
	/** Starting checklist — the author edits these, they are not fixed. */
	defaultSteps: string[]
	/**
	 * What an illustration for this goal must actually show. Fed verbatim into
	 * the agent brief, so it has to describe pixels, not intent.
	 */
	illustrationTargets: string[]
}

export const WELCOME_GOAL_PRESETS: Record<WelcomeGoal, WelcomeGoalPreset> = {
	PIN_EXTENSION: {
		goal: 'PIN_EXTENSION',
		label: 'Pin the extension',
		summary: 'Get the user to find the extension in the toolbar puzzle menu and pin it.',
		defaultHeadline: "You're all set — pin it so it's always one click away",
		defaultMessage:
			'Chrome hides new extensions behind the puzzle icon. Pinning takes five seconds and means you never have to hunt for it again.',
		defaultSteps: [
			'Click the puzzle icon in the top-right of the browser toolbar',
			'Find this extension in the list that opens',
			'Click the pin icon next to it so it stays in the toolbar',
			'The icon now sits in your toolbar — click it any time to start',
		],
		illustrationTargets: [
			'The browser toolbar with the puzzle (Extensions) icon highlighted in the top-right.',
			"The open extensions dropdown with this extension's row highlighted.",
			'The same dropdown with the pin toggle beside that row highlighted.',
			'The toolbar after pinning, with the extension icon now visible next to the address bar.',
		],
	},
	NEW_TAB_OPT_IN: {
		goal: 'NEW_TAB_OPT_IN',
		label: 'Keep the new-tab change',
		summary: 'Get the user to accept the new-tab override prompt instead of reverting it.',
		defaultHeadline: 'One last step — keep your new tab',
		defaultMessage:
			'Your browser will ask whether to keep the new-tab page. Choose "Keep it" and the extension is ready to use.',
		defaultSteps: [
			'Open a new tab',
			'Your browser shows a "change back?" prompt in the top-right',
			'Click "Keep it" to confirm the new-tab page',
			'Open a new tab again to see it live',
		],
		illustrationTargets: [
			'A fresh browser window with the new-tab change confirmation dialog visible.',
			'The same dialog with the "Keep it" button highlighted.',
			'The new tab page rendering the extension after confirmation.',
		],
	},
	VISIT_SITE: {
		goal: 'VISIT_SITE',
		label: 'Use it on a site',
		summary: 'Send the user to the site where the extension injects its widget, and show them the widget.',
		defaultHeadline: "You're installed — here's where to find it",
		defaultMessage:
			'This extension works directly on the pages you already use. Open a supported page and the controls appear automatically.',
		defaultSteps: [
			'Open a supported page in a new tab',
			'Wait a second for the page to finish loading',
			'Look for the extension panel added to the page',
			'Click it to run the extension on that page',
		],
		illustrationTargets: [
			'The target website as it normally looks, before the extension acts.',
			'The same page with the injected extension widget highlighted in place.',
			'The widget expanded, showing the extension actually doing its job.',
		],
	},
	CUSTOM: {
		goal: 'CUSTOM',
		label: 'Something else',
		summary: 'A primary action the author defines; nothing is pre-filled.',
		defaultHeadline: '',
		defaultMessage: '',
		defaultSteps: [],
		illustrationTargets: [],
	},
}

export const WELCOME_GOALS: WelcomeGoal[] = ['PIN_EXTENSION', 'NEW_TAB_OPT_IN', 'VISIT_SITE', 'CUSTOM']

export function isWelcomeGoal(v: unknown): v is WelcomeGoal {
	return typeof v === 'string' && (WELCOME_GOALS as string[]).includes(v)
}

// ── The brief ───────────────────────────────────────────────────────────────

export interface WelcomeAgentBriefInput {
	extensionName: string
	goal: WelcomeGoal
	/** Free-text description of what the extension actually does. */
	whatItDoes?: string | null
	/** Site the extension acts on — required to make VISIT_SITE illustrations concrete. */
	targetSite?: string | null
	/** Store screenshot URLs we already host, offered as ready-made illustration material. */
	storeScreenshots?: string[]
	/** Steps the author has already written, if any. */
	existingSteps?: string[]
	accentColor?: string
	/** Where the finished blocks get pasted back. */
	constructorUrl?: string
}

/**
 * Render the welcome-page content specification for this config.
 *
 * An author who opens the constructor knows what their extension does but not
 * what a good welcome page contains; whoever produces the illustrations (the
 * author, a designer, or a coding tool the author uses) needs the goal, the
 * store assets we already hold, and the block JSON format the constructor
 * accepts. The spec states all three as neutral reference material — goal,
 * requirements, limits, file format — and is a pure function of the config (no
 * network, no key, no credits) so both dojo and the MCP server can render it.
 */
export function buildWelcomeAgentBrief(input: WelcomeAgentBriefInput): string {
	const preset = WELCOME_GOAL_PRESETS[input.goal] ?? WELCOME_GOAL_PRESETS.PIN_EXTENSION
	const name = input.extensionName.trim() || 'the extension'
	const accent = input.accentColor || WELCOME_DEFAULT_ACCENT
	const shots = input.storeScreenshots ?? []
	const steps = (input.existingSteps ?? []).filter((s) => s.trim())

	const out: string[] = []

	out.push(`# Welcome-page content specification for "${name}"`)
	out.push('')
	out.push(
		'Scope: the visual, step-by-step content of the page a user lands on the moment they',
		'install this browser extension. The deliverables are the image assets plus the block',
		'JSON described at the end, which the Extenshi welcome-page constructor imports as blocks.',
		'',
	)

	out.push('## Goal: the one action the page drives')
	out.push('')
	out.push(`**${preset.label}** — ${preset.summary}`)
	out.push('')
	out.push(
		'A welcome page that explains everything drives nothing. Each block serves that single',
		'action; content that does not serve it is left out.',
		'',
	)

	if (input.whatItDoes?.trim()) {
		out.push('## What the extension does')
		out.push('')
		out.push(input.whatItDoes.trim())
		out.push('')
	}

	if (input.goal === 'VISIT_SITE') {
		out.push('## Target site')
		out.push('')
		out.push(
			input.targetSite?.trim()
				? `The extension acts on: ${input.targetSite.trim()}. Illustrations show that real site, not a generic page.`
				: 'Target site: not supplied yet. The illustrations depend on it — a generic page teaches the user nothing — so the site the extension injects into is an open question for the developer.',
		)
		out.push('')
	}

	out.push('## Illustrations')
	out.push('')
	if (preset.illustrationTargets.length) {
		out.push('One image per step, in this order:')
		out.push('')
		preset.illustrationTargets.forEach((t, i) => {
			out.push(`${i + 1}. ${t}`)
		})
	} else {
		out.push(
			'No preset applies to this goal. The sequence is the shortest set of images that takes a',
			'brand-new user from "just installed" to having completed the action above, one image',
			'per step.',
		)
	}
	out.push('')

	out.push('### Image sources, in order of preference')
	out.push('')
	out.push(
		'1. **A screenshot of the real UI.** The extension loaded in a clean browser profile, at',
		'   the exact moment the step describes, captured as a browser-window screenshot. A real',
		'   screenshot beats a drawing because the user matches it against their own screen.',
		'2. **Cropped to the region that matters.** A full 1920px desktop capture renders',
		'   unreadably small in a page column. The crop covers the toolbar, the dropdown, or the',
		'   widget, with just enough surrounding context to locate it.',
		'3. **An SVG drawing when a screenshot is impossible or unsuitable** — an OS dialog that',
		'   cannot be reproduced reliably, a state that needs three preconditions, or anything',
		'   containing personal data. A clean vector mock of the browser chrome is better than a',
		'   cluttered real capture.',
		'',
	)

	if (shots.length) {
		out.push('### Hosted store screenshots')
		out.push('')
		out.push(
			`This extension has ${shots.length} store screenshot${shots.length === 1 ? '' : 's'} already`,
			'mirrored on Extenshi storage. They are approved store assets and go straight into a',
			'block with `"source": "store"` and the URL as-is — no upload step:',
			'',
		)
		for (const u of shots.slice(0, 10)) {
			out.push(`- ${u}`)
		}
		out.push('')
		out.push(
			'They suit "what the extension looks like / what it does" blocks. As marketing captures',
			'they usually do NOT show the install steps, which need their own captures or drawings.',
			'',
		)
	}

	out.push('## Annotations: where to click')
	out.push('')
	out.push(
		'An un-annotated screenshot makes the user hunt, so every image with a click target',
		'carries a marker. Markers are an overlay drawn by the constructor, not pixels burned into',
		'the image — that keeps them crisp, translatable and movable later.',
		'',
		'Markers are positioned as percentages of the image box:',
		'',
		'- `kind: "number"` — a numbered badge on the thing to click. For a step in an ordered',
		'  sequence, which is the common case.',
		'- `kind: "arrow"` — a pointer with an `angle` in degrees clockwise from pointing right',
		'  (0 = →, 90 = ↓, 180 = ←, 270 = ↑). For a small target or one near an edge, where a',
		'  badge would cover it.',
		"- `x` / `y` are 0–100 percentages of the image's own width/height, measured to the CENTRE",
		'  of the target. Percentages, not pixels: the page is responsive and the author may swap',
		'  in a re-captured screenshot at a different resolution.',
		`- At most ${WELCOME_MAX_ANNOTATIONS} markers per image. An image that needs more is doing`,
		'  too much and splits into two steps.',
		'',
	)

	out.push('## Limits enforced on save')
	out.push('')
	out.push(
		`- At most ${WELCOME_MAX_BLOCKS} blocks total.`,
		`- Step titles ≤ ${WELCOME_TITLE_MAX_LEN} chars; body text ≤ ${WELCOME_TEXT_MAX_LEN} chars.`,
		`- Every image has \`alt\` text (≤ ${WELCOME_ALT_MAX_LEN} chars) describing what is shown —`,
		'  it is what a screen-reader user gets instead of the illustration.',
		`- SVG: a single \`<svg>\` element, ≤ ${WELCOME_SVG_MAX_LEN} chars, flat shapes only. Scripts,`,
		'  event handlers, `<foreignObject>`, external references and embedded rasters are stripped',
		'  by the server sanitizer, so an image that relies on them renders broken.',
		`- Uploads: PNG / JPEG / WebP only, ≤ ${Math.round(WELCOME_UPLOAD_MAX_BYTES / 1024 / 1024)} MB each.`,
		`- Accent colour for this page: \`${accent}\`. Drawn illustrations use it so the page reads`,
		'  as one design.',
		'',
	)

	if (steps.length) {
		out.push('## Steps the author already wrote')
		out.push('')
		out.push('Their wording and intent stay; the illustrations are added to them, not a rewrite:')
		out.push('')
		steps.forEach((s, i) => {
			out.push(`${i + 1}. ${s}`)
		})
		out.push('')
	}

	out.push('## Block JSON format')
	out.push('')
	out.push('A JSON array of blocks in this shape:')
	out.push('')
	out.push('```json')
	out.push(
		JSON.stringify(
			[
				{
					kind: 'step',
					id: 'step-1',
					title: preset.defaultSteps[0] ?? 'First thing the user does',
					body: 'Optional one-sentence elaboration.',
					media: {
						source: 'svg',
						svg: '<svg viewBox="0 0 640 200">…</svg>',
						alt: 'Browser toolbar with the extensions puzzle icon at the top right',
						annotations: [{ x: 92.5, y: 18, kind: 'number', n: 1, label: 'Click here' }],
					},
				},
				{
					kind: 'image',
					id: 'shot-1',
					media: {
						source: 'store',
						url: shots[0] ?? 'https://…/screenshot.png',
						alt: 'The extension panel open on a supported page',
						annotations: [],
					},
					caption: 'What it looks like in use.',
				},
				{ kind: 'text', id: 'outro', title: 'Need help?', body: 'Short closing paragraph.' },
			],
			null,
			2,
		),
	)
	out.push('```')
	out.push('')
	out.push(
		'- `source: "svg"` → the markup goes in `svg`; `url` stays unset.',
		'- `source: "store"` → one of the hosted URLs above goes in `url`; `svg` stays unset.',
		'- `source: "upload"` → the author uploads the file in the constructor, which fills in the',
		'  URL; the block carries an empty `url` plus a note naming the local file that belongs in it.',
		'- `id` is unique within the page.',
		'',
	)

	out.push('## Import and review')
	out.push('')
	out.push(
		'1. Drawn or captured images are saved as files next to the project, ready for upload.',
		`2. In the constructor${input.constructorUrl ? ` (${input.constructorUrl})` : ''} the block JSON is pasted,`,
		'   local images are uploaded, and the live preview shows the result.',
		'3. The preview is also checked at a narrow width — annotations that read fine on desktop',
		'   can collide on a phone.',
	)

	return out.join('\n')
}
