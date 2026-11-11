/**
 * The build map page `extenshi map` serves (plan 2026-11-03-extension-build-map
 * §4, §6.6). One self-contained HTML document — no network, no fonts to fetch —
 * drawn from the static graph inlined here and the live snapshot the local
 * server pushes over SSE (`/events`). Phase 1 is read-only, with three
 * exceptions, all posted with the page token (build-map-server.ts):
 *   - a task only the author can do outside extenshi (`confirm` in the graph,
 *     such as a store account) gets a "Mark as done" button (/api/confirm);
 *   - a step the author can do themselves or skip (`manual` / `skip` in the
 *     graph) gets a form with what to give, and a skip button (/api/route).
 *     The store submits show what an upload by hand needs: the package on
 *     disk, the dashboard, the values to paste, the steps left to do there;
 *   - a step that spends credits (`credits` in the graph) shows what is left
 *     of its pool, and to an author with no account a sign-in for the free
 *     credits (/api/login) with the pairing code to check (phase 1g). Its own
 *     mark opens only once the free credits of that pool are spent.
 * The header also offers an Update button while a newer @extenshi/cli is out
 * (snap.update): it restarts the map on that release (/api/update), and the
 * page reloads when the new server answers on the same port.
 *
 * The same page is the map in a chat (plan phase 4): the local MCP server
 * (@extenshi/mcp, which keeps a byte-identical copy of this file) serves it as
 * an MCP Apps resource with `app: true`. There it has no server to fetch from:
 * it talks to the host over postMessage (JSON-RPC, MCP Apps 2026-01-26), reads
 * the snapshot through the app-only tool `build_map_view` every few seconds,
 * writes the author's answers through `build_map_answer` and loads variant
 * thumbnails through `build_map_file`. Links open through the host. Sign-in
 * stays on the browser map, which runs the pairing.
 *
 * Look and interaction follow the prototype in
 * internal-docs/prototypes/extension-progress-map/index.html (catalog design
 * tokens, both themes, pan/zoom, inspector). Everything the project or an agent
 * wrote (extension name, fact sentences, log lines) reaches the DOM through
 * textContent or `esc()`, never as markup.
 *
 * The client script is plain ES2017 inside a template literal: it must not
 * contain backticks or `${`, so it concatenates strings.
 */

import { BUILD_CLUSTERS, BUILD_MAP_REVIEWS, BUILD_NODES, BUILD_WORLD } from '@extenshi/contracts'
import { MAP_PROTOCOL } from './build-map-store.js'

/** Line icons (24×24 path data) the nodes and the inspector draw. */
const ICONS: Record<string, string> = {
	idea: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
	layers: 'M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
	globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
	target:
		'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
	tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
	search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
	sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
	folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
	file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
	key: 'M7.5 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3',
	cpu: 'M4 4h16v16H4zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
	code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
	window: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M7 6h.01',
	settings:
		'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
	sidebar: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM15 3v18',
	lang: 'M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
	box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7 12 12l8.7-5M12 22V12',
	shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
	image:
		'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5L5 21',
	grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
	link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
	camera:
		'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
	megaphone: 'm3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6',
	text: 'M17 6.1H3M21 12.1H3M15.1 18H3',
	db: 'M12 2c5 0 9 1.3 9 3s-4 3-9 3-9-1.3-9-3 4-3 9-3zM21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5',
	shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
	clipboard:
		'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4',
	scale: 'M16 16.5 19 7l3 9.5a4 4 0 0 1-6 0zM2 16.5 5 7l3 9.5a4 4 0 0 1-6 0zM7 21h10M12 3v18M3 7h18',
	filecheck: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4',
	activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
	bug: 'M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1M12 20v-9M6.5 9A6 6 0 0 0 6 11.5v3A6 6 0 0 0 18 14.5v-3A6 6 0 0 0 17.5 9zM3 13h3M18 13h3M4 20l2.5-2M20 20l-2.5-2M4 7l2.5 2M20 7l-2.5 2',
	message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
	logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
	spark:
		'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
	coins: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM18.1 8.7a6 6 0 1 1-7.4 7.4M7 6h1v4M16.7 13.1l.7.7-2.8 2.8',
	card: 'M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM1 10h22M6 15h4',
	lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
	flask: 'M9 3h6M10 3v6L4 20a1 1 0 0 0 1 1.5h14a1 1 0 0 0 1-1.5L14 9V3M7 15h10',
	monitor: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4',
	scan: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01',
	wrench:
		'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z',
	git: 'M6 3v12M18 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 12a9 9 0 0 1-9 9',
	user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
	checks: 'm3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8',
	zip: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
	upload: 'M12 19V5M5 12l7-7 7 7',
	eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
	live: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9 12l2 2 4-4',
	check: 'm5 12 4 4L19 7',
	lockS: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
	redo: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
}

/** JSON safe to embed in a <script> element: no `</script>`, no HTML comment openers. */
function scriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

/**
 * `token` authorises the page's writes (/api/confirm); without it, as in a
 * saved copy, the page shows no write buttons. The token belongs to one server
 * run, so `instance` names that run: when the page reconnects to a server
 * restarted on the same port, the stream's hello carries another instance and
 * the page reloads for the new token. `protocol` does the same when a newer
 * server takes over the port.
 *
 * `app` makes it the map in a chat (see the top of this file): no token, no
 * stream; the host and the MCP server's app-only tools stand in for both.
 */
export function buildMapPage(options: {
	nonce: string
	token?: string
	instance?: string
	app?: { version: string }
}): string {
	const graph = scriptJson({
		clusters: BUILD_CLUSTERS,
		nodes: BUILD_NODES,
		world: BUILD_WORLD,
		icons: ICONS,
		mapReviews: BUILD_MAP_REVIEWS,
	})
	const session = scriptJson({
		token: options.token ?? null,
		instance: options.instance ?? null,
		protocol: MAP_PROTOCOL,
		...(options.app ? { app: options.app } : {}),
	})
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Extension Build Map</title>
<style>${STYLE}</style>
</head>
<body>
${BODY}
<script type="application/json" id="graph">${graph}</script>
<script type="application/json" id="session">${session}</script>
<script nonce="${options.nonce}">${CLIENT}</script>
</body>
</html>
`
}

/**
 * Dark tokens: the browser map follows the system; the map in a chat (MCP Apps) is
 * told the host's theme and sets `data-theme`, which wins over the system.
 */
const DARK_TOKENS = `
	--bg: oklch(0.1377 0.0167 150.77); --bg-2: oklch(0.17 0.018 150); --panel: oklch(0.165 0.017 150);
	--fg: oklch(0.9423 0.0097 72.6); --fg-2: oklch(0.74 0.015 90); --fg-3: oklch(0.55 0.015 120);
	--line: oklch(0.27 0.02 150); --line-2: oklch(0.34 0.025 150);
	--primary: oklch(0.6731 0.1624 144.2); --primary-soft: oklch(0.3 0.06 145); --primary-fg: oklch(0.12 0.02 150);
	--ok: oklch(0.72 0.15 145); --ok-soft: oklch(0.28 0.06 145); --warn: oklch(0.8 0.15 75); --warn-soft: oklch(0.32 0.07 75);
	--run: oklch(0.74 0.11 240); --run-soft: oklch(0.28 0.05 245);
	--node-fill: oklch(0.21 0.02 150); --node-locked: oklch(0.18 0.015 150);
	--c-found: oklch(0.78 0.12 60); --c-scaf: oklch(0.74 0.11 240); --c-vis: oklch(0.76 0.13 340); --c-comp: oklch(0.74 0.14 145);
	--c-tele: oklch(0.72 0.14 300); --c-money: oklch(0.8 0.14 90); --c-qa: oklch(0.74 0.11 200); --c-rel: oklch(0.6731 0.1624 144.2);
	--cluster-alpha: 10%; --shadow: 0 10px 30px oklch(0 0 0 / 0.45);
	color-scheme: dark;
`

const STYLE = `
:root {
	--bg: oklch(0.9711 0.0074 80.72); --bg-2: oklch(0.945 0.012 78); --panel: oklch(0.99 0.004 80);
	--fg: oklch(0.3 0.0358 30.2); --fg-2: oklch(0.52 0.03 35); --fg-3: oklch(0.68 0.02 40);
	--line: oklch(0.87 0.014 75); --line-2: oklch(0.8 0.018 70);
	--primary: oklch(0.7234 0.1783 41.15); --primary-soft: oklch(0.9 0.06 50); --primary-fg: oklch(0.99 0.01 80);
	--ok: oklch(0.6 0.14 150); --ok-soft: oklch(0.92 0.06 150); --warn: oklch(0.72 0.16 65); --warn-soft: oklch(0.94 0.07 75);
	--run: oklch(0.6 0.13 250); --run-soft: oklch(0.92 0.045 250);
	--node-fill: oklch(0.995 0.004 80); --node-locked: oklch(0.93 0.01 78);
	--c-found: oklch(0.72 0.14 45); --c-scaf: oklch(0.62 0.12 250); --c-vis: oklch(0.68 0.15 340); --c-comp: oklch(0.6 0.13 150);
	--c-tele: oklch(0.58 0.16 300); --c-money: oklch(0.72 0.15 85); --c-qa: oklch(0.6 0.12 200); --c-rel: oklch(0.7234 0.1783 41.15);
	--cluster-alpha: 7%; --shadow: 0 10px 30px oklch(0.3 0.03 40 / 0.14);
	--font-sans: 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
	--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
	color-scheme: light;
}
@media (prefers-color-scheme: dark) {
	:root:not([data-theme="light"]) {${DARK_TOKENS}	}
}
:root[data-theme="dark"] {${DARK_TOKENS}}
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 14px; line-height: 1.45; overflow: hidden; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.app { display: grid; grid-template-rows: auto 1fr; height: 100%; }
.bar { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding-block: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); border-bottom: 1px solid var(--line); background: var(--panel); position: relative; z-index: 5; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand .mark { width: 26px; height: 26px; border-radius: 7px; background: var(--primary); display: grid; place-items: center; color: var(--primary-fg); flex: none; }
.brand b { font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.brand .proj { color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; }
.stats { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ring { position: relative; width: 36px; height: 36px; flex: none; }
.ring svg { width: 36px; height: 36px; transform: rotate(-90deg); }
.ring .track { stroke: var(--line); }
.ring .val { stroke: var(--primary); transition: stroke-dashoffset .5s; }
.ring span { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--font-mono); font-size: 10px; font-weight: 500; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); font-size: 12.5px; font-variant-numeric: tabular-nums; cursor: default; }
.chip i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.chip.done i { background: var(--ok); }
.chip.run i { background: var(--run); }
.chip.you { border-color: var(--primary); background: var(--primary-soft); cursor: pointer; }
.chip.you i { background: var(--primary); animation: blink 1.4s ease-in-out infinite; }
.chip.you[disabled] { opacity: .5; cursor: default; }
.chip.you[disabled] i { animation: none; }
.chip.conn i { background: var(--fg-3); }
.chip.conn.live i { background: var(--ok); }
.chip.conn.wait i { background: var(--warn); animation: blink 1.4s ease-in-out infinite; }
.controls { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--line-2); background: var(--bg); cursor: pointer; font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.btn:hover { border-color: var(--fg-3); }
.btn:focus-visible, .chip:focus-visible, .dep:focus-visible, .node:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.btn.icon { width: 30px; padding: 0; justify-content: center; }
.btn.on { background: var(--primary-soft); border-color: var(--primary); }
.btn[hidden] { display: none; }
.btn.upd { background: var(--primary); border-color: var(--primary); color: var(--primary-fg); }
.btn.upd[disabled] { opacity: .6; cursor: default; }
.sep { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }
.btn svg { width: 15px; height: 15px; }
.stage { position: relative; overflow: hidden; background: radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 1.2px) 0 0 / 28px 28px; }
.stage svg.map { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.stage svg.map.dragging { cursor: grabbing; }
.world { transform-origin: 0 0; }
.world.glide { transition: transform .45s cubic-bezier(.3,.7,.2,1); }
.cluster rect { fill: color-mix(in oklch, var(--cc) var(--cluster-alpha), transparent); stroke: color-mix(in oklch, var(--cc) 35%, transparent); stroke-width: 1; rx: 22; }
.cluster text { font-family: var(--font-sans); font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; fill: var(--cc); }
.cluster .hint { font-size: 11.5px; font-weight: 400; letter-spacing: 0; text-transform: none; fill: var(--fg-2); }
.edge { fill: none; stroke: var(--line-2); stroke-width: 1.6; transition: opacity .25s, stroke .25s; }
.edge.sat { stroke: color-mix(in oklch, var(--cc) 70%, var(--fg-3)); stroke-width: 2; }
.edge.flow { stroke: var(--run); stroke-width: 2.2; stroke-dasharray: 6 8; animation: flow 1.1s linear infinite; }
.edge.off { stroke-dasharray: 3 6; opacity: .4; }
.edge.dim { opacity: .18; }
.edge.hi { stroke: var(--primary); stroke-width: 2.6; opacity: 1; }
.edge.hi.flow { stroke: var(--run); }
.node { cursor: pointer; transition: opacity .25s; outline: none; }
.node .body { fill: var(--node-fill); stroke: var(--cc); stroke-width: 2; transition: stroke .25s, fill .25s; }
.node .halo { fill: var(--primary); opacity: 0; }
.node .pr { fill: none; stroke: var(--cc); stroke-width: 3.5; stroke-linecap: round; opacity: .9; transition: stroke-dashoffset .5s; transform: rotate(-90deg); }
.node .pr-track { fill: none; stroke: var(--line); stroke-width: 3.5; }
.node .ic { stroke: var(--cc); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.node .lbl { font-family: var(--font-sans); font-size: 12.5px; font-weight: 500; fill: var(--fg); text-anchor: middle; paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.node .badge circle { fill: var(--bg); stroke: var(--line-2); stroke-width: 1.5; }
.node .badge path, .node .badge circle.spin { stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
.node .badge { opacity: 0; }
.node.st-done .body { fill: color-mix(in oklch, var(--cc) 14%, var(--node-fill)); }
.node.st-done .badge { opacity: 1; }
.node.st-done .badge circle { fill: var(--ok); stroke: var(--ok); }
.node.st-done .badge path { stroke: var(--primary-fg); }
.node.st-done .pr { stroke: var(--ok); }
/* Done on the author's word only: a hollow check, distinct from a proven one in both themes. */
.node.st-done.by-you .badge circle { fill: var(--bg); stroke: var(--ok); }
.node.st-done.by-you .badge path { stroke: var(--ok); }
.node.st-running .badge { opacity: 1; }
.node.st-running .badge circle.bg { fill: var(--bg); stroke: var(--run); }
.node.st-running .badge .spin { stroke: var(--run); stroke-dasharray: 20 30; animation: spin 1s linear infinite; transform-origin: 0 0; }
.node.st-running .body, .node.st-running .pr, .node.st-running .ic { stroke: var(--run); }
.node.st-needs_you .halo { animation: pulse 1.8s ease-out infinite; }
.node.st-needs_you .body { stroke: var(--primary); stroke-width: 2.5; fill: color-mix(in oklch, var(--primary) 12%, var(--node-fill)); }
.node.st-needs_you .ic { stroke: var(--primary); }
.node.st-needs_you .badge { opacity: 1; }
.node.st-needs_you .badge circle { fill: var(--primary); stroke: var(--primary); }
.node.st-needs_you .badge path { stroke: var(--primary-fg); }
.node.st-needs_you .lbl { font-weight: 600; }
.node.st-locked .body { fill: var(--node-locked); stroke: var(--line-2); }
.node.st-locked .ic { stroke: var(--fg-3); }
.node.st-locked .lbl { fill: var(--fg-2); }
.node.st-locked .badge { opacity: 1; }
.node.st-locked .badge path { stroke: var(--fg-3); }
.node.redo .badge, .node.stalled .badge { opacity: 1; }
.node.redo .badge circle, .node.stalled .badge circle { fill: var(--warn); stroke: var(--warn); }
.node.redo .badge path, .node.stalled .badge path { stroke: var(--fg); }
.node.st-inactive { opacity: .32; }
.node.st-inactive .body { stroke-dasharray: 4 4; fill: transparent; }
.node.st-inactive .ic { stroke: var(--fg-3); }
.node.st-inactive .lbl { fill: var(--fg-2); }
.hide-inactive .node.st-inactive, .hide-inactive .edge.off { display: none; }
.node.dim { opacity: .28; }
.node.st-inactive.dim { opacity: .12; }
.node.sel .body { stroke-width: 3.5; }
.node.sel .sel-ring { opacity: 1; }
.node .sel-ring { fill: none; stroke: var(--primary); stroke-width: 1.5; stroke-dasharray: 3 4; opacity: 0; }
.node .you-tag { font-family: var(--font-mono); font-size: 9px; fill: var(--primary); text-anchor: middle; letter-spacing: .06em; opacity: 0; }
.node.st-needs_you .you-tag { opacity: 1; }
.legend { position: absolute; left: max(16px, env(safe-area-inset-left, 0px)); bottom: 14px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 8px 12px; border-radius: 10px; background: color-mix(in oklch, var(--panel) 85%, transparent); border: 1px solid var(--line); font-size: 12px; color: var(--fg-2); backdrop-filter: blur(6px); max-width: calc(100% - 32px); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--fg-3); display: inline-block; }
.legend i.l-done { background: var(--ok); border-color: var(--ok); }
.legend i.l-run { border-color: var(--run); border-top-color: transparent; animation: spin 1s linear infinite; }
.legend i.l-you { border-color: var(--primary); background: var(--primary-soft); }
.legend i.l-word { background: var(--bg); border-color: var(--ok); }
.legend i.l-lock { background: var(--node-locked); border-color: var(--line-2); }
.legend i.l-off { border-style: dashed; opacity: .5; }
.notice { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); max-width: min(560px, calc(100% - 32px)); padding: 8px 14px; border-radius: 10px; background: var(--warn-soft); border: 1px solid var(--warn); font-size: 13px; z-index: 3; display: none; }
.notice.show { display: block; }
.notice code { font-family: var(--font-mono); font-size: 12px; }
.panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 100%); background: var(--panel); border-left: 1px solid var(--line); transform: translateX(100%); transition: transform .3s cubic-bezier(.3,.7,.2,1); display: flex; flex-direction: column; box-shadow: var(--shadow); z-index: 4; padding-right: env(safe-area-inset-right, 0px); }
.panel.open { transform: none; }
/* With a step open, a notice centres on the part of the map left of the panel (a chat's map is narrow). */
.stage:has(.panel.open) .notice { left: calc((100% - min(380px, 100%)) / 2); max-width: min(560px, calc(100% - min(380px, 100%) - 32px)); }
.panel header { display: flex; align-items: flex-start; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--line); }
.panel header .pico { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; flex: none; background: color-mix(in oklch, var(--cc) 14%, transparent); color: var(--cc); }
.panel header .pico svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.panel header h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.25; }
.panel header .sub { color: var(--fg-2); font-size: 12px; margin-top: 2px; }
.panel header .x { margin-left: auto; }
.pbody { overflow: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid transparent; }
.pill.st-done { background: var(--ok-soft); color: var(--ok); }
.pill.st-running { background: var(--run-soft); color: var(--run); }
.pill.st-needs_you { background: var(--primary-soft); color: var(--fg); border-color: var(--primary); }
.pill.st-locked, .pill.st-ready { background: var(--bg-2); color: var(--fg-2); }
.pill.st-inactive { background: var(--bg-2); color: var(--fg-3); }
.pill.warn { background: var(--warn-soft); color: var(--fg); }
.pill .sp { width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: spin 1s linear infinite; }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.actor { color: var(--fg-2); font-size: 12px; }
.actor b { color: var(--fg); font-weight: 500; }
.pbar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.pbar i { display: block; height: 100%; background: var(--cc); width: 0; transition: width .5s; border-radius: 3px; }
.pct { font-family: var(--font-mono); font-size: 12px; color: var(--fg-2); display: flex; justify-content: space-between; }
.desc { color: var(--fg-2); margin: 0; }
.fact { margin: 0; font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--ok-soft); }
.why { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 8px; background: var(--ok-soft); font-size: 13px; }
.why.b-author { background: var(--bg-2); border: 1px solid var(--line-2); }
.why.unknown { background: var(--bg-2); color: var(--fg-2); }
.why p { margin: 0; }
.basis { align-self: flex-start; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--fg-2); }
.where { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--fg-2); }
.where code { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg); word-break: break-all; }
.where a { color: var(--fg); word-break: break-all; }
.where .sha { font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-3); }
.ask .note { height: 32px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--panel); color: var(--fg); font: inherit; font-size: 13px; padding: 0 10px; }
.ask .note:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.ask .hint { font-size: 11.5px; color: var(--fg-3); }
.hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.hist li { display: flex; gap: 8px; color: var(--fg-2); }
.hist li .t { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); flex: none; padding-top: 2px; min-width: 52px; }
.hist li > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hist li.revoked > div > span:first-child { text-decoration: line-through; text-decoration-color: var(--fg-3); }
.hist li b { color: var(--fg); font-weight: 500; }
.hist .note { color: var(--fg); font-style: italic; }
.tool { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11.5px; padding: 4px 8px; border-radius: 6px; background: var(--bg-2); border: 1px solid var(--line); color: var(--fg-2); max-width: 100%; }
.tool code { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
h3 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--fg-3); }
.sec { display: flex; flex-direction: column; gap: 8px; }
.todos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.todos li { display: flex; align-items: flex-start; gap: 9px; padding: 7px 9px; border-radius: 7px; background: var(--bg-2); }
.todos li .m { width: 16px; height: 16px; flex: none; margin-top: 2px; border-radius: 50%; border: 1.5px solid var(--line-2); display: grid; place-items: center; }
.todos li.done .m { background: var(--ok); border-color: var(--ok); }
.todos li.done .m svg { width: 10px; height: 10px; stroke: var(--primary-fg); fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.todos li.run .m { border-color: var(--run); border-top-color: transparent; animation: spin .9s linear infinite; }
.todos li.wait .m { border-color: var(--primary); background: var(--primary-soft); }
.todos li.wait { background: var(--primary-soft); }
.todos li .who { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--fg-3); white-space: nowrap; padding-top: 3px; }
.todos li.wait .who { color: var(--primary); }
.todos li.done span, .todos li.done .who { color: var(--fg-2); }
.deps { display: flex; flex-wrap: wrap; gap: 6px; }
.dep { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px 3px 6px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); font-size: 12px; cursor: pointer; }
.dep:hover { border-color: var(--fg-3); }
.dep i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--line-2); }
.dep.st-done i { background: var(--ok); }
.dep.st-running i { background: var(--run); }
.dep.st-needs_you i { background: var(--primary); }
.dep.st-inactive { opacity: .5; text-decoration: line-through; }
.ask { border: 1px solid var(--primary); background: color-mix(in oklch, var(--primary-soft) 60%, var(--panel)); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.ask.muted { border-color: var(--line); background: var(--bg-2); }
.ask h4 { margin: 0; font-size: 13.5px; font-weight: 600; }
.ask p { margin: 0; color: var(--fg-2); font-size: 13px; }
.ask .act { align-self: flex-start; margin-top: 4px; height: 32px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--primary); background: var(--primary); color: var(--primary-fg); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.ask .act:hover { filter: brightness(1.06); }
.ask .act:disabled { opacity: .6; cursor: default; filter: none; }
.ask .act:focus-visible, .todos .undo:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.ask p.err { color: var(--fg); background: var(--warn-soft); border-radius: 6px; padding: 6px 8px; }
.ask .act.ghost { background: var(--panel); color: var(--fg); border-color: var(--line-2); }
.ask .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ask textarea.note { height: auto; min-height: 96px; padding: 8px 10px; resize: vertical; line-height: 1.4; }
.ask .code { align-self: flex-start; font-family: var(--font-mono); font-size: 18px; font-weight: 600; letter-spacing: .12em; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--panel); }
.ask a { color: var(--primary); }
.ask .req { margin: 0; padding-left: 18px; color: var(--fg-2); font-size: 12.5px; display: flex; flex-direction: column; gap: 2px; }
.ask .picks { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; }
.ask .picks label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.ask .kv { display: flex; flex-direction: column; gap: 4px; }
.ask .kv > span { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-3); }
.copyrow { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.copyrow code { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 11.5px; padding: 5px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); overflow-wrap: anywhere; white-space: pre-wrap; }
.copy { flex: none; height: 26px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--line-2); background: var(--panel); font-size: 12px; cursor: pointer; }
.copy:hover { border-color: var(--fg-3); }
.copy:focus-visible, .ask .picks input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.ask a { color: var(--fg); }
.ask .tolist { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.ask .tolist b { font-weight: 600; }
.variants { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 8px; }
.variant { border: 1px solid var(--line-2); border-radius: 10px; background: var(--panel); padding: 8px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.variant.picked { border-color: var(--ok); box-shadow: inset 0 0 0 1px var(--ok); }
.variant .thumb { aspect-ratio: 1; border-radius: 8px; background: var(--bg-2); display: grid; place-items: center; overflow: hidden; color: var(--fg-3); font-family: var(--font-mono); font-size: 20px; }
.variant .thumb img { width: 100%; height: 100%; object-fit: contain; }
.variant .vl { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.variant .num { font-family: var(--font-mono); font-weight: 500; color: var(--fg-3); margin-right: 4px; }
.variant a { font-size: 12.5px; }
.ask .variant .act { margin-top: 0; align-self: stretch; height: 30px; padding: 0 8px; }
.variant .tag { font-size: 12px; font-weight: 600; color: var(--ok); }
.ask .quote { color: var(--fg); font-style: italic; overflow-wrap: anywhere; }
.rounds { font-size: 12.5px; color: var(--fg-2); }
.rounds summary { cursor: pointer; }
.rounds ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.todos .undo { margin-left: auto; flex: none; border: 0; background: none; padding: 2px 0 0; font: inherit; font-family: var(--font-mono); font-size: 10px; color: var(--fg-2); text-decoration: underline; cursor: pointer; }
.todos .undo:hover { color: var(--fg); }
.todos .undo:disabled { cursor: default; text-decoration: none; }
.opts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.opts li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.opts li i { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--line-2); }
.opts li.on i { background: var(--primary); border-color: var(--primary); }
.opts li:not(.on) { color: var(--fg-3); }
.log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.log li { display: flex; gap: 8px; color: var(--fg-2); }
.log li .t { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); flex: none; padding-top: 2px; }
.log li b { color: var(--fg); font-weight: 500; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes flow { to { stroke-dashoffset: -28; } }
@keyframes pulse { 0% { transform: scale(1); opacity: .45; } 100% { transform: scale(2.1); opacity: 0; } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) {
	.edge.flow, .node .halo, .chip i, .legend i.l-run, .pill .sp, .todos li.run .m, .node.st-running .badge .spin { animation: none !important; }
	.node.st-needs_you .halo { opacity: .25; transform: scale(1.5); }
	.world.glide, .panel { transition: none; }
}
@media (max-width: 720px) {
	.bar { gap: 10px; }
	.brand .proj { display: none; }
	.panel { top: auto; width: 100%; max-height: 62%; border-left: 0; border-top: 1px solid var(--line); border-radius: 16px 16px 0 0; transform: translateY(100%); padding-right: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
	.panel.open { transform: none; }
	.stage:has(.panel.open) .notice { left: 50%; max-width: min(560px, calc(100% - 32px)); }
	.legend { bottom: 10px; font-size: 11px; gap: 8px; }
}
`

const BODY = `<div class="app">
	<header class="bar">
		<div class="brand">
			<span class="mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12h-2a2 2 0 0 0-2 2v2a2 2 0 0 1-2 2h-2v-2a2 2 0 0 0-4 0v2H6a2 2 0 0 1-2-2v-2h2a2 2 0 0 0 0-4H4V8a2 2 0 0 1 2-2h2V4a2 2 0 0 1 4 0v2h2a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2z"/></svg></span>
			<b>Extension Build Map</b>
			<span class="proj mono" id="projName"></span>
		</div>
		<div class="stats">
			<div class="ring" title="Active steps done"><svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15" fill="none" stroke-width="3.5"/><circle class="val" id="ringVal" cx="18" cy="18" r="15" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="94.25" stroke-dashoffset="94.25"/></svg><span id="ringPct">0%</span></div>
			<span class="chip done"><i></i><span id="cDone">0 / 0 done</span></span>
			<span class="chip run"><i></i><span id="cRun">0 running</span></span>
			<button class="chip you" id="cYou" title="Jump to the next step waiting on you" disabled><i></i><span id="cYouT">0 need you</span></button>
			<span class="chip conn wait" id="cConn" title="Connection to the local map server"><i></i><span id="cConnT">connecting</span></span>
		</div>
		<div class="controls">
			<button class="btn upd" id="bUpdate" hidden></button>
			<button class="btn on" id="bInactive" title="Show steps this extension does not need">Show inactive</button>
			<span class="sep"></span>
			<button class="btn icon" id="bZoomOut" title="Zoom out" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
			<button class="btn" id="bFit" title="Fit the whole map">Fit</button>
			<button class="btn icon" id="bZoomIn" title="Zoom in" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
			<button class="btn" id="bFull" title="Show the map full screen" hidden>Full screen</button>
		</div>
	</header>
	<main class="stage" id="stage">
		<svg class="map" id="map" xmlns="http://www.w3.org/2000/svg">
			<g class="world" id="world"><g id="gClusters"></g><g id="gEdges"></g><g id="gNodes"></g></g>
		</svg>
		<div class="notice" id="notice" role="status"></div>
		<div class="legend" aria-label="Legend">
			<span><i class="l-done"></i>done</span>
			<span><i class="l-run"></i>agent working</span>
			<span><i class="l-you"></i>waiting on you</span>
			<span><i class="l-word"></i>done on your word</span>
			<span><i class="l-lock"></i>locked by dependencies</span>
			<span><i class="l-off"></i>not needed, or skipped</span>
		</div>
		<aside class="panel" id="panel" aria-live="polite">
			<header>
				<div class="pico" id="pIco"></div>
				<div style="min-width:0;flex:1"><h2 id="pTitle">Select a step</h2><div class="sub" id="pSub"></div></div>
				<button class="btn icon x" id="pClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
			</header>
			<div class="pbody" id="pBody"></div>
		</aside>
	</main>
</div>`

const CLIENT = `
(function () {
'use strict';
var G = JSON.parse(document.getElementById('graph').textContent);
var ICONS = G.icons, WORLD = G.world, NODES = G.nodes, CLUSTERS = G.clusters;
var COLORS = { found: 'var(--c-found)', scaf: 'var(--c-scaf)', vis: 'var(--c-vis)', comp: 'var(--c-comp)', tele: 'var(--c-tele)', money: 'var(--c-money)', qa: 'var(--c-qa)', rel: 'var(--c-rel)' };
var byId = {}, children = {};
NODES.forEach(function (n) { byId[n.id] = n; });
NODES.forEach(function (n) { n.deps.forEach(function (d) { (children[d] = children[d] || []).push(n.id); }); });
var SV = 'http://www.w3.org/2000/svg', NODE_R = 27, C = 2 * Math.PI * (NODE_R + 5.5);
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var el = function (tag, attrs, parent) { var e = document.createElementNS(SV, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
var SESSION = JSON.parse(document.getElementById('session').textContent);
// The map in a chat (MCP Apps), with the variant thumbnails the MCP server has sent so far.
var APP = SESSION.app || null, thumbs = {}, thumbAsked = {};
var snap = null, selected = null, showInactive = true, edgeEls = {}, nodeEls = {}, firstSnapshot = true;
// The author's write (a mark, or a route): in flight (or saved, until the snapshot shows it), and the last failure.
// What the author typed belongs to the step (and task) it was typed for: another step never sends it.
var pending = null, writeError = null, drafts = {};
// A sign-in the author started (until the snapshot shows its new state), and why it did not start.
var loginWait = null, loginError = '';
var NOUNS = { scan: 'scans', read: 'catalog reads', icon: 'icon generations' };
var MAP_REVIEWS = G.mapReviews || [];
function draft(key) { return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : null; }
function draftFor(id, task) { return draft(id + '|note|' + task) || ''; }
function routeOf(id) { return (snap && snap.routes && snap.routes[id]) || null; }
function routeAt(id) { var r = routeOf(id); return r ? r.at : null; }
function reviewOf(id) { return (snap && snap.reviews && snap.reviews[id]) || null; }
// Which round the step shows and how it stands: an error about a review lasts until this changes.
function reviewKey(id) { var r = reviewOf(id); return r ? r.round + '|' + (r.revision || 1) + '|' + r.status + '|' + (r.choice || '') : ''; }
// A write is in the snapshot once the step shows its result.
function landed(p) {
	if (p.review) { var r = reviewOf(p.node); return !r || r.round !== p.round || (r.revision || 1) !== p.revision || r.status !== p.status || (r.choice || null) !== p.before; }
	return p.route ? routeAt(p.node) !== p.since : nv(p.node).taskIndex === p.expect;
}
try { showInactive = localStorage.getItem('build-map.inactive') !== 'hidden'; } catch (e) {}

function nv(id) { return snap && snap.view.nodes[id] || { status: 'locked', progress: 0, taskIndex: 0 }; }
function agentLabel(n, v) { return v && v.agent ? v.agent : ({ found: 'orchestrator', scaf: 'code agent', vis: 'design agent', comp: 'compliance agent', tele: 'lifecycle agent', money: 'billing agent', qa: 'qa agent', rel: 'release agent' })[n.cluster]; }
function ago(iso) {
	var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
	if (!isFinite(s)) return '';
	if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago';
	if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago';
}

function edgePath(s, t) {
	var sx = s.x + NODE_R + 6, tx = t.x - NODE_R - 6, sy = s.y, ty = t.y, k;
	if (t.x - s.x > 80) { k = Math.max(40, (tx - sx) * 0.5); return 'M' + sx + ',' + sy + ' C' + (sx + k) + ',' + sy + ' ' + (tx - k) + ',' + ty + ' ' + tx + ',' + ty; }
	var dir = ty > sy ? 1 : -1, s2y = s.y + dir * (NODE_R + 6), t2y = t.y - dir * (NODE_R + 6);
	k = Math.max(40, Math.abs(t2y - s2y) * 0.45);
	return 'M' + s.x + ',' + s2y + ' C' + s.x + ',' + (s2y + dir * k) + ' ' + t.x + ',' + (t2y - dir * k) + ' ' + t.x + ',' + t2y;
}

function buildWorld() {
	CLUSTERS.forEach(function (c) {
		var g = el('g', { 'class': 'cluster', style: '--cc:' + COLORS[c.id] }, $('gClusters'));
		el('rect', { x: c.x, y: c.y, width: c.w, height: c.h }, g);
		el('text', { x: c.x + 18, y: c.y + 26 }, g).textContent = c.name;
		el('text', { x: c.x + 18, y: c.y + 44, 'class': 'hint' }, g).textContent = c.hint;
	});
	NODES.forEach(function (n) { n.deps.forEach(function (d) {
		edgeEls[d + '>' + n.id] = el('path', { 'class': 'edge', d: edgePath(byId[d], n), style: '--cc:' + COLORS[byId[d].cluster] }, $('gEdges'));
	}); });
	NODES.forEach(function (n) {
		var g = el('g', { 'class': 'node', transform: 'translate(' + n.x + ',' + n.y + ')', style: '--cc:' + COLORS[n.cluster], tabindex: '0', role: 'button', 'aria-label': n.label }, $('gNodes'));
		el('circle', { 'class': 'halo', r: NODE_R }, g);
		el('circle', { 'class': 'sel-ring', r: NODE_R + 11 }, g);
		el('circle', { 'class': 'pr-track', r: NODE_R + 5.5 }, g);
		el('circle', { 'class': 'pr', r: NODE_R + 5.5, 'stroke-dasharray': C, 'stroke-dashoffset': C }, g);
		el('circle', { 'class': 'body', r: NODE_R }, g);
		el('path', { 'class': 'ic', d: ICONS[n.icon] || '' }, el('g', { transform: 'translate(-12,-12)' }, g));
		var b = el('g', { 'class': 'badge', transform: 'translate(19,-19)' }, g);
		el('circle', { 'class': 'bg', r: 8.5 }, b);
		el('circle', { 'class': 'spin', r: 5.5 }, el('g', { 'class': 'spin' }, b));
		el('path', { 'class': 'bp', d: '', transform: 'translate(-5,-5) scale(0.42)' }, b);
		el('text', { 'class': 'lbl', y: NODE_R + 18 }, g).textContent = n.label;
		el('text', { 'class': 'you-tag', y: -NODE_R - 10 }, g).textContent = 'YOUR TURN';
		g.addEventListener('click', function (ev) { if (dragMoved) return; ev.stopPropagation(); select(n.id); });
		g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(n.id); } });
		nodeEls[n.id] = g;
	});
}

function related(a, b) { return a === b || byId[b].deps.indexOf(a) >= 0 || byId[a].deps.indexOf(b) >= 0; }

function render() {
	if (!snap) return;
	var view = snap.view;
	NODES.forEach(function (n) {
		var v = nv(n.id), st = v.status, g = nodeEls[n.id];
		var cls = 'node st-' + st + (st === 'done' && v.basis === 'author' ? ' by-you' : '') + (v.skippedBy ? ' skipped' : '') + (v.redo && st !== 'done' ? ' redo' : '') + (v.stalled ? ' stalled' : '') + (selected === n.id ? ' sel' : '') + (selected && !related(selected, n.id) ? ' dim' : '');
		g.setAttribute('class', cls);
		g.querySelector('.pr').setAttribute('stroke-dashoffset', C * (1 - v.progress / 100));
		g.querySelector('.bp').setAttribute('d', st === 'done' ? ICONS.check : st === 'needs_you' ? 'M12 5v9M12 18h.01' : (v.redo || v.stalled) ? ICONS.redo : st === 'locked' ? ICONS.lockS : '');
	});
	NODES.forEach(function (n) { n.deps.forEach(function (d) {
		var ts = nv(n.id).status, ss = nv(d).status, cls = 'edge';
		if (ts === 'inactive' || ss === 'inactive') cls += ' off';
		else if (ss === 'done' && ts === 'running') cls += ' flow';
		else if (ss === 'done') cls += ' sat';
		if (selected) cls += (d === selected || n.id === selected) ? ' hi' : ' dim';
		edgeEls[d + '>' + n.id].setAttribute('class', cls);
	}); });
	$('ringVal').setAttribute('stroke-dashoffset', 94.25 * (1 - view.percent / 100));
	$('ringPct').textContent = view.percent + '%';
	$('cDone').textContent = view.done + ' / ' + view.active + ' done';
	$('cRun').textContent = view.running.length + ' running';
	$('cYouT').textContent = view.needsYou.length + ' need' + (view.needsYou.length === 1 ? 's' : '') + ' you';
	$('cYou').disabled = view.needsYou.length === 0;
	var p = snap.project || {};
	var name = [p.name || 'Unnamed extension', p.version].filter(Boolean).join(' · ');
	$('projName').textContent = name;
	$('projName').title = snap.home;
	document.title = (view.needsYou.length ? '(' + view.needsYou.length + ') ' : '') + (p.name ? p.name + ' · ' : '') + 'Build Map';
	if (selected) renderPanel(selected);
}

var STATUS_LABEL = { done: 'Done', running: 'Agent working', needs_you: 'Waiting on you', ready: 'Ready to start', locked: 'Locked', inactive: 'Not needed' };
var OPTIONS = {
	surfaces: [['popup', 'Popup'], ['background', 'Service worker'], ['content', 'Content script'], ['options', 'Options page'], ['sidepanel', 'Side panel']],
	browsers: [['chrome', 'Chrome'], ['firefox', 'Firefox'], ['edge', 'Edge']],
	features: [['analytics', 'Analytics'], ['uninstall', 'Uninstall survey'], ['feedback', 'Feedback form'], ['i18n', 'Localization'], ['monetization', 'Monetization'], ['onboarding', 'Welcome page'], ['promo', 'Promo tiles'], ['research', 'Niche research'], ['ci', 'CI evidence']]
};
function inactiveReason(n) {
	var r = n.requires || {};
	if (r.surface) return 'This extension has no ' + r.surface + ' surface.';
	if (r.browser) return r.browser.charAt(0).toUpperCase() + r.browser.slice(1) + ' is not a target browser.';
	if (r.multiBrowser) return 'Only one target browser, so there is nothing to reconcile.';
	if (r.feature) return 'The ' + r.feature + ' module is off for this extension.';
	return 'A module or surface this step needs is off for this extension.';
}

function select(id) { selected = id; $('panel').classList.add('open'); render(); if (!snap) renderPanel(id); }
function closePanel() { selected = null; $('panel').classList.remove('open'); if (location.hash) history.replaceState(null, '', location.pathname); render(); }

// The evidence journal (plan 6.2.1): why a step counts as done, and its history.
var BASIS_LABEL = { author: 'Your mark', agent: 'Agent report', project: 'Found in the project files', dojo: 'From Dojo' };
function journal(id) { return (snap && snap.evidence && snap.evidence[id]) || []; }
function whereList(where) {
	if (!where || !where.length) return '';
	return '<ul class="where">' + where.map(function (w) {
		if (w.file) return '<li><code>' + esc(w.file) + '</code>' + (w.sha256 ? ' <span class="sha" title="sha256 ' + esc(w.sha256) + '">sha256 ' + esc(w.sha256.slice(0, 10)) + '</span>' : '') + '</li>';
		if (w.url) return '<li>' + (/^https?:[/][/]/i.test(w.url) ? '<a href="' + esc(w.url) + '" target="_blank" rel="noopener noreferrer">' + esc(w.url) + '</a>' : esc(w.url)) + '</li>';
		if (w.dojo) return '<li>Dojo · ' + esc(w.dojo) + '</li>';
		if (w.command) return '<li><code>' + esc(w.command) + '</code></li>';
		return '';
	}).join('') + '</ul>';
}
function whyDone(id, v) {
	if (v.status !== 'done') return '';
	if (v.fact) return '<div class="why b-' + esc(v.basis || 'project') + '"><span class="basis">' + esc(v.local ? 'Checked by the map' : BASIS_LABEL[v.basis] || BASIS_LABEL.project) + '</span><p>' + esc(v.fact) + '</p>' + whereList(v.where) + '</div>';
	var entry = journal(id).filter(function (e) { return !e.revoked && (v.route === 'self' ? e.route === 'self' : !e.route) && (e.basis === 'author' || e.basis === 'agent'); })[0];
	if (entry) return '<div class="why b-' + esc(entry.basis) + '"><span class="basis">' + esc(BASIS_LABEL[entry.basis]) + (entry.basis === 'agent' && entry.who ? ' · ' + esc(entry.who) : '') + (entry.checked ? ' · checked' : '') + '</span><p>' + esc(entry.claim) + '</p>' + (entry.note ? '<p class="note">' + esc(entry.note) + '</p>' : '') + whereList(entry.where) + '</div>';
	if (v.basis === 'agent') return '<div class="why unknown"><span class="basis">Agent report</span><p>' + esc(v.agent || 'An agent') + ' reported the step done without saying how it checked.</p></div>';
	return '<div class="why unknown"><p>Done before the map kept a record of why.</p></div>';
}
function historyLine(e) {
	if (e.basis === 'author' && e.route === 'skip') return '<li class="' + (e.revoked ? 'revoked' : '') + '"><span class="t">' + esc(ago(e.t)) + '</span><div><span><b>' + (e.revoked ? 'you took the skip back' : 'you skipped this step') + '</b></span></div></li>';
	var what = e.basis === 'author' ? (e.route === 'self' ? (e.revoked ? 'you took it back' : 'you did it yourself') : e.revoked ? 'you took the mark back' : 'you marked done')
		: e.basis === 'agent' ? esc(e.who) + (e.revoked ? ' withdrew' : ' reported')
		: e.basis === 'dojo' ? (e.revoked ? 'no longer in Dojo' : 'Dojo shows')
		: (e.revoked ? 'no longer in the files' : 'found in the files');
	return '<li class="' + (e.revoked ? 'revoked' : '') + '"><span class="t">' + esc(ago(e.t)) + '</span><div><span><b>' + what + '</b> ' + esc(e.claim) + '</span>' + (e.note ? '<span class="note">' + esc(e.note) + '</span>' : '') + (e.revoked ? '' : whereList(e.where)) + '</div></li>';
}

function renderPanel(id) {
	var n = byId[id], v = nv(id), st = v.status, color = COLORS[n.cluster];
	var cluster = CLUSTERS.filter(function (c) { return c.id === n.cluster; })[0];
	$('pIco').style.setProperty('--cc', color);
	$('pIco').innerHTML = '<svg viewBox="0 0 24 24"><path d="' + esc(ICONS[n.icon]) + '"/></svg>';
	$('pTitle').textContent = n.label;
	$('pSub').textContent = cluster.name + ' · ' + (n.actor === 'you' ? 'needs your decision' : 'agent step');
	var h = '';
	h += '<div class="status"><span class="pill st-' + st + '">' + (st === 'running' ? '<span class="sp"></span>' : '<span class="dot"></span>') + (v.route === 'skip' ? 'Skipped' : v.skippedBy ? 'Off' : STATUS_LABEL[st]) + '</span>';
	if (v.redo && st !== 'done') h += '<span class="pill warn">re-run queued</span>';
	if (v.stalled) h += '<span class="pill warn">agent went quiet</span>';
	h += '<span class="actor">' + (n.actor === 'you' ? '<b>you</b> + ' : '') + '<b>' + esc(agentLabel(n, v)) + '</b></span></div>';
	h += whyDone(id, v);
	if (st !== 'inactive' && !v.fact) h += '<div class="sec"><div class="pbar" style="--cc:' + color + '"><i style="width:' + v.progress + '%"></i></div><div class="pct"><span>' + v.progress + '%</span><span>' + Math.min(v.taskIndex, n.todos.length) + ' / ' + n.todos.length + ' tasks' + (v.updatedAt ? ' · ' + esc(ago(v.updatedAt)) : '') + '</span></div></div>';
	if (v.stalled) h += '<div class="ask muted"><h4>No report for a while</h4><p>' + esc(v.agent) + ' last reported ' + esc(ago(v.updatedAt)) + '. Another agent can pick the step up.</p></div>';
	h += '<p class="desc">' + esc(n.desc) + '</p>';
	if (n.tool) h += '<div class="tool"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONS.wrench + '"/></svg><code>' + esc(n.tool) + '</code></div>';
	var writable = Boolean(snap && (APP ? snap.app && snap.app.writable : SESSION.token));
	var busy = pending && pending.node === id;
	var routeFailed = writeError && writeError.node === id && writeError.kind === 'route' ? writeError.message : '';
	if (routeFailed) h += '<div class="ask muted"><p class="err">' + esc(routeFailed) + '</p></div>';
	if (v.route === 'skip') h += '<div class="ask muted"><h4>You skipped this step</h4><p>' + esc(n.skip ? n.skip.consequence : '') + '</p>' + (n.skip && n.skip.store ? '<p>It is on the list of what to do in the store dashboards.</p>' : '') + (writable ? '<button class="act ghost" data-route="null"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Take the skip back') + '</button>' : '') + '</div>';
	else if (v.skippedBy) h += '<div class="ask muted"><h4>Off with a skipped step</h4><p>It only uses the result of <a href="#node=' + esc(v.skippedBy) + '">' + esc(byId[v.skippedBy] ? byId[v.skippedBy].label : v.skippedBy) + '</a>, which you skipped.</p></div>';
	else if (st === 'inactive') h += '<div class="ask muted"><h4>Not needed for this extension</h4><p>' + esc(inactiveReason(n)) + '</p></div>';
	// A stored route stays editable even once the project files prove the step (the agent wired the link).
	var stored = routeOf(id);
	if (n.credits && snap && snap.account && st !== 'inactive' && st !== 'done' && v.route !== 'skip' && !v.skippedBy) h += creditBox(n, writable);
	var ownRoute = v.route === 'self' || Boolean(stored && stored.how === 'self');
	if (writable && n.manual && st !== 'inactive' && (st !== 'done' || ownRoute) && (ownRoute || selfOpen(n))) h += manualBox(id, n, v, busy);
	if (writable && n.skip && st !== 'inactive' && st !== 'done') h += skipBox(n, busy);
	if (writable && st === 'done' && stored && stored.how === 'skip') h += '<div class="ask muted"><h4>You skipped this step</h4><p>The project files show it done anyway, so the skip has no effect.</p><button class="act ghost" data-route="null"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Take the skip back') + '</button></div>';
	if (id === 'ready' && snap && snap.view.byHand.length) h += '<div class="ask muted"><h4>To do in the store dashboards</h4>' + byHandList(snap.view.byHand) + '</div>';
	var review = reviewOf(id), onMap = MAP_REVIEWS.indexOf(n.review) >= 0;
	if (onMap && review && st !== 'inactive') h += reviewBox(id, n, review, writable, busy);
	var cur = n.todos[v.taskIndex], last = v.taskIndex - 1;
	var canMark = writable && st !== 'inactive' && st !== 'done' && cur && cur.confirm;
	var canUndo = writable && st !== 'inactive' && !v.fact && !v.route && last >= 0 && n.todos[last] && n.todos[last].confirm;
	var failed = writeError && writeError.node === id && writeError.kind === 'confirm' ? writeError.message : '';
	if (canMark) {
		h += '<div class="ask"><h4>' + esc(cur.t) + '</h4><p>Only you can do this. When it is done, mark it here: every agent working on this project sees it.</p>';
		if (failed) h += '<p class="err">' + esc(failed) + '</p>';
		h += '<input class="note" data-draft="' + id + '|note|' + v.taskIndex + '" maxlength="280" placeholder="Note for the history (optional), e.g. the publisher name" value="' + esc(draftFor(id, v.taskIndex)) + '"' + (busy ? ' disabled' : '') + '>';
		h += '<span class="hint">Kept in the project&#39;s map file. Never put passwords or keys here.</span>';
		h += '<button class="act" data-confirm="1" data-task="' + v.taskIndex + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Mark as done') + '</button></div>';
	} else if (st === 'needs_you' && cur && onMap && !review) h += '<div class="ask"><h4>' + esc(cur.t) + '</h4><p>The variants to choose from show up here when the agent offers them.</p></div>';
	else if (st === 'needs_you' && cur && !(onMap && review)) h += '<div class="ask"><h4>' + esc(cur.t) + '</h4><p>The agent is waiting for your answer in the chat.</p></div>';
	else if (canUndo && failed) h += '<div class="ask muted"><p class="err">' + esc(failed) + '</p></div>';
	if (snap && OPTIONS[n.review]) {
		var on = snap.view.settings[n.review];
		h += '<div class="sec"><h3>Current choice</h3><ul class="opts">' + OPTIONS[n.review].map(function (o) { return '<li class="' + (on[o[0]] ? 'on' : '') + '"><i></i>' + o[1] + '</li>'; }).join('') + '</ul></div>';
	}
	if (n.todos.length) {
		h += '<div class="sec"><h3>Tasks</h3><ul class="todos">';
		n.todos.forEach(function (t, i) {
			var cls = st === 'done' || i < v.taskIndex ? 'done' : i === v.taskIndex && st === 'running' ? 'run' : i === v.taskIndex && st === 'needs_you' ? 'wait' : '';
			var who = canUndo && i === last
				? '<button class="undo" data-confirm="0" data-task="' + i + '" title="Mark this task as not done"' + (busy ? ' disabled' : '') + '>' + (busy ? 'saving…' : 'undo') + '</button>'
				: '<span class="who">' + (t.a === 'you' ? 'you' : 'agent') + '</span>';
			h += '<li class="' + cls + '"><span class="m">' + (cls === 'done' ? '<svg viewBox="0 0 24 24"><path d="' + ICONS.check + '"/></svg>' : '') + '</span><span>' + esc(t.t) + '</span>' + who + '</li>';
		});
		h += '</ul></div>';
	}
	var chips = function (ids) { return ids.map(function (d) { return '<button class="dep st-' + nv(d).status + '" data-go="' + d + '"><i></i>' + esc(byId[d].label) + '</button>'; }).join(''); };
	if (n.deps.length) h += '<div class="sec"><h3>Depends on</h3><div class="deps">' + chips(n.deps) + '</div></div>';
	if (children[id]) h += '<div class="sec"><h3>Unlocks</h3><div class="deps">' + chips(children[id]) + '</div></div>';
	var history = journal(id);
	if (history.length) h += '<div class="sec"><h3>Evidence history</h3><ul class="hist">' + history.map(historyLine).join('') + '</ul></div>';
	var logs = snap ? snap.log.filter(function (l) { return l.node === id; }).slice(0, 8) : [];
	if (logs.length) h += '<div class="sec"><h3>Activity</h3><ul class="log">' + logs.map(function (l) { return '<li><span class="t">' + esc(ago(l.t)) + '</span><span><b>' + esc(l.who) + '</b> ' + esc(l.what) + '</span></li>'; }).join('') + '</ul></div>';
	var body = $('pBody');
	if (body.dataset.html === h) return;
	// Someone is typing in a field of this step: keep it; the panel catches up when it loses focus.
	var typing = document.activeElement;
	if (typing && typing.getAttribute && typing.getAttribute('data-draft') && body.contains(typing) && body.dataset.node === id && !busy) return;
	body.dataset.node = id;
	body.dataset.html = h;
	body.innerHTML = h;
	if (APP) loadThumbs();
	body.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { focusNode(b.getAttribute('data-go')); select(b.getAttribute('data-go')); }); });
	body.querySelectorAll('[data-confirm]').forEach(function (b) { b.addEventListener('click', function () { sendConfirm(id, Number(b.getAttribute('data-task')), b.getAttribute('data-confirm') === '1'); }); });
	body.querySelectorAll('[data-route]').forEach(function (b) { b.addEventListener('click', function () { var how = b.getAttribute('data-route'); sendRoute(id, how === 'null' ? null : how); }); });
	body.querySelectorAll('[data-copy]').forEach(function (b) { b.addEventListener('click', function () { copyText(b); }); });
	body.querySelectorAll('[data-login]').forEach(function (b) { b.addEventListener('click', function () { sendLogin(id); }); });
	body.querySelectorAll('[data-pick]').forEach(function (b) { b.addEventListener('click', function () { sendReview(id, { choice: b.getAttribute('data-pick') }); }); });
	body.querySelectorAll('[data-redo]').forEach(function (b) { b.addEventListener('click', function () {
		var r = reviewOf(id), text = r ? (draft(id + '|redo|' + r.round) || '').trim() : '';
		if (!text) { writeError = { node: id, kind: 'review', key: reviewKey(id), message: 'Say what to change first.' }; renderPanel(id); return; }
		sendReview(id, { redo: text });
	}); });
	body.querySelectorAll('[data-draft]').forEach(function (f) {
		var key = f.getAttribute('data-draft');
		if (f.type === 'checkbox') f.addEventListener('change', function () {
			drafts[key] = Array.prototype.filter.call(body.querySelectorAll('[data-draft="' + key + '"]'), function (c) { return c.checked; }).map(function (c) { return c.value; }).join(',');
		});
		else f.addEventListener('input', function () { drafts[key] = f.value; });
		f.addEventListener('blur', function () { setTimeout(function () { if (selected === id) renderPanel(id); }, 0); });
	});
}

// Doing a step by hand (plan phase 1f): what the author gives, and for a store submit what an upload by hand needs.
var BS = String.fromCharCode(92);
function absPath(file) {
	var home = snap.home || '', sep = home.indexOf(BS) >= 0 && home.indexOf('/') < 0 ? BS : '/';
	while (home.length > 1 && (home.charAt(home.length - 1) === '/' || home.charAt(home.length - 1) === BS)) home = home.slice(0, -1);
	return home + sep + file;
}
function copyRow(text, label) {
	var shown = label || (text.length > 160 ? text.slice(0, 157) + '…' : text);
	return '<div class="copyrow"><code>' + esc(shown) + '</code><button class="copy" data-copy="' + esc(text) + '">Copy</button></div>';
}
function copyText(b) {
	var text = b.getAttribute('data-copy');
	var done = function (label) { b.textContent = label; setTimeout(function () { b.textContent = 'Copy'; }, 1500); };
	if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done('Copied'); }, function () { done('Copy failed'); });
	else done('Copy failed');
}
function byHandList(ids) {
	return '<ul class="tolist">' + ids.map(function (d) { return '<li><b>' + esc(byId[d].label) + '.</b> ' + esc(byId[d].skip ? byId[d].skip.consequence : '') + '</li>'; }).join('') + '</ul>';
}
// The packages on disk for one store: named for its browser (and the Firefox source), else every package.
function packagesFor(browser) {
	var files = (nv('zip').where || []).filter(function (w) { return w.file; }).map(function (w) { return w.file; });
	var named = files.filter(function (f) { return new RegExp(browser, 'i').test(f) || (browser === 'firefox' && /source/i.test(f)); });
	if (named.length) return named;
	var plain = files.filter(function (f) { return !/chrome|firefox|edge/i.test(f); });
	return plain.length ? plain : files;
}
function uploadParts(n) {
	var browser = n.requires && n.requires.browser, h = '';
	var files = browser ? packagesFor(browser) : [];
	h += '<div class="kv"><span>Package</span>' + (files.length ? files.map(function (f) { return copyRow(absPath(f), f); }).join('') : '<p>No package on disk yet: the Package per browser step makes it.</p>') + '</div>';
	// What the author gave, even once the project files prove the step (the agent wired the link).
	var policy = routeOf('policy'), reasons = routeOf('justifications'), listing = nv('listing');
	if (policy && policy.how === 'self' && policy.value) h += '<div class="kv"><span>Privacy policy URL</span>' + copyRow(policy.value) + '</div>';
	if (browser === 'chrome' && reasons && reasons.how === 'self' && reasons.value) h += '<div class="kv"><span>Permission reasons</span>' + copyRow(reasons.value) + '</div>';
	var listingFile = (listing.where || []).filter(function (w) { return w.file; })[0];
	if (listingFile) h += '<div class="kv"><span>Listing copy</span>' + copyRow(absPath(listingFile.file), listingFile.file) + '</div>';
	var left = snap.view.byHand.filter(function (d) { var r = byId[d].requires; return !r || !r.browser || r.browser === browser; });
	if (left.length) h += '<div class="kv"><span>Do there, skipped on the map</span>' + byHandList(left) + '</div>';
	h += '<p><a href="' + esc(n.manual.dashboard) + '" target="_blank" rel="noopener noreferrer">Open the dashboard</a></p>';
	return h;
}
function storesNow(id, v) {
	var chosen = draft(id + '|stores');
	if (chosen !== null) return chosen;
	var given = givenValue(id, v);
	if (given) return given;
	var on = snap.view.settings.browsers;
	return OPTIONS.browsers.filter(function (o) { return on[o[0]]; }).map(function (o) { return o[0]; }).join(',');
}
// What the author gave: in the view, or in the stored route once the project files prove the step instead.
function givenValue(id, v) {
	if (v.route === 'self' && v.value) return v.value;
	var r = routeOf(id);
	return r && r.how === 'self' && r.value ? r.value : '';
}
function manualBox(id, n, v, busy) {
	var r = routeOf(id), m = n.manual, mine = v.route === 'self' || Boolean(r && r.how === 'self'), given = givenValue(id, v);
	var h = '<div class="ask' + (mine ? ' muted' : '') + '">';
	h += '<h4>' + esc(mine ? 'You did this yourself' : m.label) + '</h4>';
	if (mine && v.fact) h += '<p>The project files show it too.</p>';
	if (!mine && m.dashboard) h += '<p>Upload it yourself, then mark it here.</p>' + uploadParts(n);
	if (!mine && m.requirements && m.requirements.length) h += '<ul class="req">' + m.requirements.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
	if (mine && given && m.input !== 'browsers') h += copyRow(given);
	if (m.input === 'url' || m.input === 'text') {
		var val = draft(id + '|value');
		if (val === null) val = mine ? given : '';
		h += m.input === 'url'
			? '<input class="note" type="url" data-draft="' + id + '|value" maxlength="2048" placeholder="https://" value="' + esc(val) + '"' + (busy ? ' disabled' : '') + '>'
			: '<textarea class="note" data-draft="' + id + '|value" maxlength="4000"' + (busy ? ' disabled' : '') + '>' + esc(val) + '</textarea>';
		if (m.key) h += '<span class="hint">An agent writes it into src/extenshi.config.js as ' + esc(m.key) + '.</span>';
	} else if (m.input === 'browsers') {
		var stores = ',' + storesNow(id, v) + ',';
		h += '<div class="picks">' + OPTIONS.browsers.map(function (o) { return '<label><input type="checkbox" data-draft="' + id + '|stores" value="' + o[0] + '"' + (stores.indexOf(',' + o[0] + ',') >= 0 ? ' checked' : '') + (busy ? ' disabled' : '') + '> ' + o[1] + '</label>'; }).join('') + '</div>';
		if (snap.project && snap.project.projectId) h += '<span class="hint">This project is bound to Dojo: a decision there wins over the choice here.</span>';
	}
	if (!mine || m.input !== 'mark') {
		var rnote = draft(id + '|rnote') || '';
		h += '<input class="note" data-draft="' + id + '|rnote" maxlength="280" placeholder="Note for the history (optional)" value="' + esc(rnote) + '"' + (busy ? ' disabled' : '') + '>';
		h += '<span class="hint">Kept in the project&#39;s map file. Never put passwords or keys here.</span>';
	}
	h += '<div class="row">';
	if (!mine || m.input !== 'mark') h += '<button class="act" data-route="self"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : m.input === 'mark' ? esc(m.label) : mine ? 'Save the change' : 'Save') + '</button>';
	if (mine) h += '<button class="act ghost" data-route="null"' + (busy ? ' disabled' : '') + '>Take it back</button>';
	return h + '</div></div>';
}
// A credit step's own mark opens once the free credits of its pool are spent (the server checks it too).
function selfOpen(n) {
	if (!n.credits) return true;
	var a = snap && snap.account, b = a && a.signedIn && a.credits && a.credits[n.credits];
	return Boolean(b) && b.freeRemaining <= 0;
}
function timeLeft(iso) {
	var m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
	return m > 1 ? 'in ' + m + ' minutes' : 'in a minute';
}
function creditBox(n, writable) {
	var a = snap.account, noun = NOUNS[n.credits], lg = a.login, h;
	if (a.checking) return '<div class="ask muted"><h4>Credits</h4><p>Checking your Extenshi account…</p></div>';
	if (!a.signedIn) {
		h = '<div class="ask"><h4>Sign in for free credits</h4>';
		h += '<p>This step spends ' + noun + '. A new Extenshi account gets free scans, catalog reads and icon generations, once. Signing in costs nothing.</p>';
		if (a.problem) h += '<p class="err">' + esc(a.problem) + '</p>';
		if (lg && lg.status === 'waiting') {
			h += '<p>Check that the sign-in page shows this code, then approve it there:</p><div class="code">' + esc(lg.code) + '</div>';
			h += '<p>' + (lg.opened ? 'The sign-in page opened in a new tab. ' : '') + '<a href="' + esc(lg.url) + '" target="_blank" rel="noopener noreferrer">' + (lg.opened ? 'Open it again' : 'Open the sign-in page') + '</a></p>';
			h += '<span class="hint">Waiting for your approval. The code expires ' + esc(timeLeft(lg.expiresAt)) + '.</span>';
			return h + '</div>';
		}
		var failed = loginError || (lg && lg.status === 'failed' ? lg.message : '');
		if (failed) h += '<p class="err">' + esc(failed) + '</p>';
		if (writable && !APP) {
			var starting = Boolean(loginWait);
			h += '<button class="act" data-login="1"' + (starting ? ' disabled' : '') + '>' + (starting ? 'Starting…' : 'Sign in for free credits') + '</button>';
			h += '<span class="hint">Opens extenshi.io to sign in or create an account. The key is saved in ~/.extenshi/config.json on this computer, where every extenshi command finds it.</span>';
		} else h += '<p>Run <code>npx @extenshi/cli login</code> in a terminal' + (APP ? ', or sign in on the map in your browser' : '') + '.</p>';
		if (n.skip) h += '<span class="hint">Or skip the step below.</span>';
		return h + '</div>';
	}
	var b = a.credits && a.credits[n.credits];
	if (!b) return '<div class="ask muted"><h4>Credits</h4><p>' + esc(a.problem || 'You are signed in, but the map does not know your credits right now.') + '</p></div>';
	h = '<div class="ask muted"><h4>' + esc(noun.charAt(0).toUpperCase() + noun.slice(1)) + ': ' + b.remaining + ' left</h4>';
	if (lg && lg.status === 'done') h += '<p>Signed in' + (lg.email ? ' as ' + esc(lg.email) : '') + '.' + (b.remaining > 0 ? ' An agent can run this step now.' : '') + '</p>';
	if (b.freeRemaining > 0) {
		h += '<p>' + b.freeRemaining + ' of them free, of the ' + b.freeGranted + ' every account gets once.</p>';
		if (n.manual) h += '<p>&ldquo;' + esc(n.manual.label) + '&rdquo; opens once the free ones are spent.</p>';
	} else if (b.remaining > 0) h += '<p>The free ones are spent; the rest are credits you bought.</p>';
	else {
		h += '<p>None left. Buy more, ' + (n.manual ? 'mark the step done yourself, ' : '') + 'or skip it.</p>';
		if (a.billingUrl) h += '<p><a href="' + esc(a.billingUrl) + '" target="_blank" rel="noopener noreferrer">Buy credits in Dojo</a></p>';
	}
	return h + '</div>';
}
// A write: to the map server with the page token, or, in a chat, through the MCP server's app-only tool.
// Either way it resolves once the write is saved and fails with the reason to show.
function post(path, body) {
	if (APP) return appWrite(path.replace('/api/', ''), body);
	return fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-extenshi-map-page': SESSION.token },
		body: JSON.stringify(body)
	}).then(function (res) {
		// 403: the server restarted since this page loaded, so its token is gone. The new page has the new one.
		if (res.status === 403) { location.reload(); return new Promise(function () {}); }
		return res.json().catch(function () { return {}; }).then(function (answer) {
			if (!res.ok) throw new Error(answer.message || ('The map server answered ' + res.status + '.'));
		});
	});
}
// The author signs in from the map: the server starts the browser pairing; the code comes back over SSE.
function sendLogin(id) {
	if (loginWait || !snap || !snap.account) return;
	loginWait = { before: JSON.stringify(snap.account.login || null) };
	loginError = '';
	renderPanel(id);
	post('/api/login', {}).then(function () {
		var mine = loginWait;
		setTimeout(function () { if (loginWait === mine) { loginWait = null; if (selected) renderPanel(selected); } }, 15000);
	}, function (error) {
		loginWait = null;
		loginError = (error && error.message) || 'The map server did not answer.';
		if (selected === id) renderPanel(id);
	});
}
function skipBox(n, busy) {
	var h = '<div class="ask muted"><h4>Skip this step</h4><p>' + esc(n.skip.consequence) + '</p>';
	if (n.skip.store) h += '<p>It goes on the list of what to do in the store dashboards.</p>';
	if (n.skip.with && n.skip.with.length) h += '<p>Also switches off: ' + n.skip.with.map(function (d) { return esc(byId[d].label); }).join(', ') + '.</p>';
	return h + '<button class="act ghost" data-route="skip"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Skip') + '</button></div>';
}

// A variant's file goes through the map server (/review/…), which serves it in a sandbox; an https address opens as it is.
// In a chat the page has no server of its own: a preview opens on the browser map's server while it runs, else not at all.
// revision: variants an agent replaced keep their ids, so the address names the revision, or the browser keeps
// showing the image it loaded for the old one (a document reuses an image at the same address, no-store or not).
function variantSrc(id, round, x, which, revision) {
	var loc = which === 'image' ? x.image : x.preview;
	if (!loc) return '';
	// No backslashes in this script: it lives in a template literal, which would eat them.
	if (/^https:/i.test(loc)) return loc;
	var rel = 'review/' + encodeURIComponent(id) + '/' + round + '/' + encodeURIComponent(x.id) + '/' + which + (revision ? '?v=' + revision : '');
	if (APP) return snap && snap.app && snap.app.url ? snap.app.url + rel : '';
	return '/' + rel;
}
function thumbOf(id, r, x) {
	var round = r.round, revision = r.revision || 1;
	var image = function (loc) { return loc && !/^https:/i.test(loc) && /[.](svg|png|jpe?g|webp|gif)$/i.test(loc); };
	if (APP) {
		// A chat lets the page show data: images only: the MCP server reads the file and sends it (loadThumbs).
		var which = image(x.image) ? 'image' : image(x.preview) ? 'preview' : '';
		// The revision too: replaced variants keep their ids, and the old thumbnail must not stand for the new one.
		var key = [id, round, x.id, which, revision].join('|');
		if (which && thumbs[key]) return '<span class="thumb"><img src="' + esc(thumbs[key]) + '" alt=""></span>';
		return '<span class="thumb"' + (which ? ' data-thumb="' + esc(key) + '"' : '') + '>' + esc(x.id) + '</span>';
	}
	// The page loads images from this server only, so a thumbnail at an https address shows as its number.
	var src = image(x.image) ? variantSrc(id, round, x, 'image', revision) : image(x.preview) ? variantSrc(id, round, x, 'preview', revision) : '';
	return src ? '<span class="thumb"><img src="' + esc(src) + '" alt=""></span>' : '<span class="thumb">' + esc(x.id) + '</span>';
}
function variantLabel(r, vid) { var x = (r.variants || []).filter(function (c) { return c.id === vid; })[0]; return x ? x.label : vid; }

// Variants an agent offered (plan phase 2): pick one, or say what to change for another round.
function reviewBox(id, n, r, writable, busy) {
	var failed = writeError && writeError.node === id && writeError.kind === 'review' ? writeError.message : '';
	var task = n.todos.filter(function (t) { return t.a === 'you' && !t.confirm; })[0];
	var picked = r.status === 'picked' ? r.choice : null;
	var h = '<div class="ask' + (r.status === 'waiting' ? '' : ' muted') + '">';
	if (r.status === 'waiting') h += '<h4>' + esc(task ? task.t : 'Pick a variant') + (r.round > 1 ? ' · round ' + r.round : '') + '</h4><p>' + (writable ? 'Open each preview, then pick one. Or say what to change, and the agent makes another round.' : 'The agent waits for your pick.') + '</p>';
	else if (r.status === 'picked') h += '<h4>' + (r.via === 'chat' ? 'Picked in the chat: ' : 'You picked ') + '“' + esc(variantLabel(r, picked)) + '”</h4>' + (writable ? '<p>Changed your mind? Pick another one: the steps built from this pick run again.</p>' : '');
	else h += '<h4>You asked for another round</h4><p class="quote">' + esc(r.feedback) + '</p><p>' + esc(r.agent || 'The agent') + ' is making new variants.</p>';
	if (failed) h += '<p class="err">' + esc(failed) + '</p>';
	if (r.status !== 'redo') {
		h += '<div class="variants">' + r.variants.map(function (x) {
			var mine = picked === x.id, saving = busy && pending.choice === x.id;
			var act = mine ? '<span class="tag">Your pick</span>'
				: writable ? '<button class="act' + (picked ? ' ghost' : '') + '" data-pick="' + esc(x.id) + '"' + (busy ? ' disabled' : '') + '>' + (saving ? 'Saving…' : picked ? 'Pick this instead' : 'Pick this') + '</button>' : '';
			var open = variantSrc(id, r.round, x, 'preview', r.revision || 1);
			return '<div class="variant' + (mine ? ' picked' : '') + '">' + thumbOf(id, r, x) + '<span class="vl"><span class="num">' + esc(x.id) + '</span>' + esc(x.label) + '</span>' + (open ? '<a href="' + esc(open) + '" target="_blank" rel="noopener noreferrer">Open preview</a>' : '') + act + '</div>';
		}).join('') + '</div>';
		if (writable) {
			h += '<textarea class="note" data-draft="' + id + '|redo|' + r.round + '" maxlength="2000" placeholder="Or say what to change, e.g. a simpler shape, no letters, warmer colours"' + (busy ? ' disabled' : '') + '>' + esc(draft(id + '|redo|' + r.round) || '') + '</textarea>';
			h += '<button class="act ghost" data-redo="1"' + (busy ? ' disabled' : '') + '>' + (busy && pending.redo ? 'Saving…' : 'Ask for another round') + '</button>';
		}
	}
	if (r.history && r.history.length) {
		h += '<details class="rounds"><summary>Earlier rounds (' + r.history.length + ')</summary><ul>' + r.history.map(function (p) {
			var links = p.variants.map(function (x) { var open = variantSrc(id, p.round, x, 'preview'); return open ? '<a href="' + esc(open) + '" target="_blank" rel="noopener noreferrer">' + esc(x.label) + '</a>' : esc(x.label); }).join(', ');
			return '<li>Round ' + p.round + ': ' + (links || 'variants not kept') + (p.choice ? ' · picked “' + esc(variantLabel(p, p.choice)) + '”' : '') + (p.feedback ? ' · you asked: <span class="quote">' + esc(p.feedback) + '</span>' : '') + '</li>';
		}).join('') + '</ul></details>';
	}
	return h + '</div>';
}

// The author answers a review on the map. round and revision: the variants the page showed, so an
// answer to an older round, or to variants since replaced, gets 409 instead of landing on ones the author did not see.
function sendReview(id, body) {
	var r = reviewOf(id);
	if (pending || !r) return;
	body.node = id;
	body.round = r.round;
	body.revision = r.revision || 1;
	pending = { node: id, review: true, round: r.round, revision: r.revision || 1, status: r.status, before: r.choice || null, choice: body.choice || null, redo: Boolean(body.redo), saved: false };
	writeError = null;
	renderPanel(id);
	post('/api/review', body).then(function () {
		delete drafts[id + '|redo|' + r.round];
		var mine = pending;
		if (landed(mine)) { pending = null; if (selected === id) renderPanel(id); return; }
		mine.saved = true;
		setTimeout(function () { if (pending === mine) { pending = null; render(); } }, 3000);
	}, function (error) {
		pending = null;
		writeError = { node: id, kind: 'review', key: reviewKey(id), message: (error && error.message) || 'The map server did not answer.' };
		if (selected === id) renderPanel(id);
	});
}

// The author marks their own task done, or takes the mark back. The server
// writes the shared state file; the change comes back like any other, over SSE.
function sendConfirm(id, task, done) {
	if (pending) return;
	// expect: the task index the step shows once the write is in a snapshot.
	pending = { node: id, expect: done ? task + 1 : task, saved: false };
	writeError = null;
	renderPanel(id);
	var note = done ? draftFor(id, task).trim() : '';
	post('/api/confirm', note ? { node: id, task: task, done: done, note: note } : { node: id, task: task, done: done }).then(function () {
		if (done) delete drafts[id + '|note|' + task];
		var mine = pending;
		// The snapshot with the write may arrive before this answer, or after it.
		if (landed(mine)) { pending = null; if (selected === id) renderPanel(id); return; }
		mine.saved = true;
		setTimeout(function () { if (pending === mine) { pending = null; render(); } }, 3000);
	}, function (error) {
		pending = null;
		writeError = { node: id, kind: 'confirm', ti: nv(id).taskIndex, message: (error && error.message) || 'The map server did not answer.' };
		if (selected === id) renderPanel(id);
	});
}

// The author does a step themselves, skips it, or takes that back. since: the route the page showed,
// so a page behind another write gets 409 instead of overwriting it.
function sendRoute(id, how) {
	if (pending || !snap) return;
	var n = byId[id], v = nv(id), since = routeAt(id);
	var body = { node: id, how: how, since: since };
	if (how === 'self' && n.manual.input === 'browsers') body.value = storesNow(id, v);
	else if (how === 'self' && n.manual.input !== 'mark') { var val = draft(id + '|value'); body.value = val === null ? givenValue(id, v) : val; }
	var note = how === 'self' ? (draft(id + '|rnote') || '').trim() : '';
	if (note) body.note = note;
	pending = { node: id, route: true, since: since, saved: false };
	writeError = null;
	renderPanel(id);
	post('/api/route', body).then(function () {
		delete drafts[id + '|value']; delete drafts[id + '|rnote']; delete drafts[id + '|stores'];
		var mine = pending;
		if (landed(mine)) { pending = null; if (selected === id) renderPanel(id); return; }
		mine.saved = true;
		setTimeout(function () { if (pending === mine) { pending = null; render(); } }, 3000);
	}, function (error) {
		pending = null;
		writeError = { node: id, kind: 'route', at: since, message: (error && error.message) || 'The map server did not answer.' };
		if (selected === id) renderPanel(id);
	});
}

var view = { x: 0, y: 0, k: 1 }, world = $('world'), map = $('map'), stage = $('stage');
var dragging = false, dragMoved = false, dragStart = null;
function apply() { world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'; }
function fit() {
	var W = stage.clientWidth, H = stage.clientHeight, panelW = (selected && W > 720) ? 380 : 0;
	view.k = Math.max(0.2, Math.min((W - panelW - 40) / WORLD.w, (H - 70) / WORLD.h, 1.4));
	view.x = (W - panelW - WORLD.w * view.k) / 2; view.y = (H - 30 - WORLD.h * view.k) / 2; apply();
}
function zoomAt(px, py, f) { var nk = Math.max(0.2, Math.min(2.6, view.k * f)); view.x = px - (px - view.x) * (nk / view.k); view.y = py - (py - view.y) * (nk / view.k); view.k = nk; apply(); }
function focusNode(id) {
	var n = byId[id], W = stage.clientWidth, H = stage.clientHeight, panelW = W > 720 ? 380 : 0, bottom = W > 720 ? 0 : H * 0.55;
	view.k = Math.max(view.k, 1.1); view.x = (W - panelW) / 2 - n.x * view.k; view.y = (H - bottom) / 2 - n.y * view.k;
	world.classList.add('glide'); apply(); setTimeout(function () { world.classList.remove('glide'); }, 500);
}
// Capture the pointer only once the press turns into a drag: captured early, the
// click would go to the SVG instead of the node under it and never select it.
map.addEventListener('pointerdown', function (e) { dragging = true; dragMoved = false; dragStart = { x: e.clientX - view.x, y: e.clientY - view.y, sx: e.clientX, sy: e.clientY }; });
map.addEventListener('pointermove', function (e) {
	if (!dragging) return;
	if (!dragMoved && Math.hypot(e.clientX - dragStart.sx, e.clientY - dragStart.sy) > 4) {
		dragMoved = true;
		try { map.setPointerCapture(e.pointerId); } catch (err) {}
		map.classList.add('dragging');
	}
	if (dragMoved) { view.x = e.clientX - dragStart.x; view.y = e.clientY - dragStart.y; apply(); }
});
map.addEventListener('pointerup', function (e) { var dragged = dragMoved; dragging = false; map.classList.remove('dragging'); if (!dragged && !(e.target.closest && e.target.closest('.node'))) closePanel(); setTimeout(function () { dragMoved = false; }, 0); });
map.addEventListener('pointercancel', function () { dragging = false; map.classList.remove('dragging'); });
map.addEventListener('wheel', function (e) { if (APP && hostMode === 'inline' && !e.ctrlKey) return; e.preventDefault(); var r = map.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
$('bZoomIn').addEventListener('click', function () { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25); });
$('bZoomOut').addEventListener('click', function () { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 0.8); });
$('bFit').addEventListener('click', fit);
$('pClose').addEventListener('click', closePanel);
// In a chat the host resizes the frame (to its height, to full screen and back): keep the open step in view.
window.addEventListener('resize', function () { if (APP && selected) focusNode(selected); else fit(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); if (e.key === '0' && e.target === document.body) fit(); });
var youCursor = 0;
$('cYou').addEventListener('click', function () { if (!snap || !snap.view.needsYou.length) return; var id = snap.view.needsYou[youCursor++ % snap.view.needsYou.length]; focusNode(id); select(id); });
function applyInactive() { $('bInactive').classList.toggle('on', showInactive); $('bInactive').textContent = showInactive ? 'Show inactive' : 'Inactive hidden'; map.classList.toggle('hide-inactive', !showInactive); }
$('bInactive').addEventListener('click', function () { showInactive = !showInactive; try { localStorage.setItem('build-map.inactive', showInactive ? 'shown' : 'hidden'); } catch (e) {} applyInactive(); });

function fromHash() { var m = /node=([A-Za-z]+)/.exec(location.hash); if (m && byId[m[1]]) { focusNode(m[1]); select(m[1]); } }
window.addEventListener('hashchange', fromHash);

function setConn(state, text) { $('cConn').className = 'chip conn ' + state; $('cConnT').textContent = text; }
function notice(html) { $('notice').innerHTML = html; $('notice').classList.toggle('show', Boolean(html)); }
// A new snapshot, from the stream or, in a chat, from build_map_view. note: what the page says (trusted
// markup) when the snapshot reports no problem of its own.
function showSnapshot(next, note) {
	snap = next;
	if (pending && pending.saved && landed(pending)) pending = null;
	if (loginWait && JSON.stringify((snap.account && snap.account.login) || null) !== loginWait.before) loginWait = null;
	// An error about a step that has moved on since describes a state the page no longer shows.
	if (writeError && (writeError.kind === 'route' ? routeAt(writeError.node) !== writeError.at : writeError.kind === 'review' ? reviewKey(writeError.node) !== writeError.key : nv(writeError.node).taskIndex !== writeError.ti)) writeError = null;
	// A restart that failed says why; the button offers it again.
	if (updateWait && snap.update && !snap.update.updating && snap.update.problem) updateWait = null;
	var issue = snap.problem || (snap.live && snap.live.problem) || (snap.update && snap.update.problem);
	notice(issue ? esc(issue) : note);
	renderUpdate();
	render();
	if (firstSnapshot) { firstSnapshot = false; if (APP) fromArgs(); else fromHash(); }
}

// The release this map runs, and the newer one on npm it can restart on (snap.update).
var updateWait = null;
function renderUpdate() {
	var u = snap && snap.update, b = $('bUpdate');
	if (u) $('cConn').title = 'Connection to the local map server: @extenshi/cli ' + u.version + ', steps revision ' + u.graph;
	if (!u || !SESSION.token || !(u.available || u.updating)) { b.hidden = true; return; }
	b.hidden = false;
	if (u.updating || updateWait) {
		b.disabled = true;
		b.textContent = 'Updating…';
		b.title = 'Starting @extenshi/cli ' + (u.updating ? u.updating.to : updateWait) + ' for this map. The page reloads by itself once it runs.';
		return;
	}
	b.disabled = false;
	b.textContent = u.agent ? 'Update: new steps' : 'Update to ' + u.available;
	b.title = 'Restart this map on @extenshi/cli ' + u.available + '. It runs ' + u.version + ' now' + (u.agent ? '; an agent already works with the newer steps' : '') + '. Your progress stays: it is in .extenshi/build-map.json.';
}
function sendUpdate() {
	var u = snap && snap.update;
	if (!u || !u.available || updateWait) return;
	updateWait = u.available;
	renderUpdate();
	fetch('/api/update', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-extenshi-map-page': SESSION.token },
		body: JSON.stringify({ to: u.available })
	}).then(function (res) {
		if (res.status === 403) { location.reload(); return new Promise(function () {}); }
		return res.json().catch(function () { return {}; }).then(function (body) {
			if (!res.ok) throw new Error(body.message || ('The map server answered ' + res.status + '.'));
		});
	}).catch(function (err) {
		updateWait = null;
		renderUpdate();
		notice(esc(err.message));
	});
}
$('bUpdate').addEventListener('click', sendUpdate);
function connect() {
	if (APP) { appConnect(); return; }
	if (!window.EventSource || location.protocol === 'file:') { setConn('', 'snapshot'); return; }
	var es = new EventSource('/events');
	// Every connection opens with the server's instance. Another one means the
	// server restarted on this port: reload for its page token.
	es.addEventListener('hello', function (ev) {
		var hello = JSON.parse(ev.data);
		if (SESSION.instance && hello.instance !== SESSION.instance) location.reload();
	});
	es.addEventListener('map', function (ev) {
		var next = JSON.parse(ev.data);
		// A newer server took over this port: its page knows things this one does not.
		if (next.protocol !== SESSION.protocol) { location.reload(); return; }
		setConn('live', 'live');
		showSnapshot(next, '');
	});
	es.addEventListener('bye', function (ev) {
		// A newer release takes the port over: the stream reconnects to it and its hello reloads the page.
		if (ev.data === 'updated') {
			setConn('wait', 'updating');
			notice('The map restarts on the newer release. This page reloads by itself.');
			return;
		}
		setConn('', 'stopped');
		notice('The map server stopped' + (ev.data ? ' (' + esc(ev.data) + ')' : '') + '. Run <code>npx @extenshi/cli map</code> in the project to bring it back; this page reconnects by itself.');
	});
	es.onerror = function () { setConn('wait', 'reconnecting'); };
}

// ── The map in a chat (MCP Apps 2026-01-26) ──────────────────────────────────
// The host renders this page in a sandboxed frame and runs the MCP server's tools for it. JSON-RPC over
// postMessage: ui/initialize, then the tool's arguments (projectDir, step); the snapshot comes from the
// app-only tool build_map_view every few seconds (the answer is "unchanged" while it is).
var rpcSeq = 0, rpcWaiting = {}, hostCtx = {}, hostMode = 'inline', appArgs = {}, argsSeen = false, gotArgs = null;
var appEtag = '', appTimer = null, appStopped = false;
var NO_SERVER = 'The map server is not running, so the steps only the project files prove look not done here. It starts with <code>npx @extenshi/cli map</code> in the project, and this view fills in by itself.';
var SKEW = 'The map server runs another version of <code>@extenshi/cli</code> than this view. If something looks off, restart it with <code>npx @extenshi/cli@latest map</code>.';
function appSend(message) { window.parent.postMessage(message, '*'); }
function appRequest(method, params) {
	return new Promise(function (resolve, reject) {
		var id = ++rpcSeq;
		rpcWaiting[id] = { resolve: resolve, reject: reject };
		appSend({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
	});
}
function appNotify(method, params) { appSend({ jsonrpc: '2.0', method: method, params: params || {} }); }
// The MCP server answers with JSON text; a refusal carries its reason there too.
function appTool(name, args) {
	return appRequest('tools/call', { name: name, arguments: args }).then(function (result) {
		var text = result && result.content && result.content[0] && result.content[0].text;
		if (!result || result.isError) throw new Error(text || 'The map did not answer.');
		return text ? JSON.parse(text) : {};
	});
}
function projectArgs(extra) {
	var args = {};
	if (appArgs.projectDir) args.projectDir = appArgs.projectDir;
	for (var k in extra) args[k] = extra[k];
	return args;
}
function appWrite(kind, body) {
	return appTool('build_map_answer', projectArgs({ kind: kind, body: body })).then(function (answer) {
		if (!answer.ok) throw new Error(answer.message || 'The map did not take the answer.');
	});
}
function loadThumbs() {
	document.querySelectorAll('[data-thumb]').forEach(function (t) {
		var key = t.getAttribute('data-thumb');
		if (thumbAsked[key]) return;
		thumbAsked[key] = true;
		var p = key.split('|');
		appTool('build_map_file', projectArgs({ step: p[0], round: Number(p[1]), variant: p[2], which: p[3] })).then(function (file) {
			if (!file.src) return;
			thumbs[key] = file.src;
			if (selected) renderPanel(selected);
		}, function () {});
	});
}
function fromArgs() { if (appArgs.step && byId[appArgs.step]) { focusNode(appArgs.step); select(appArgs.step); } }
// Fixed by the host, or full screen: fill it. Otherwise ask for a height that fits a chat.
function appSize() {
	var d = hostCtx.containerDimensions || {}, root = document.documentElement;
	root.style.height = hostMode === 'fullscreen' || d.height ? '100vh' : Math.min(d.maxHeight || 640, 640) + 'px';
	var box = root.getBoundingClientRect();
	appNotify('ui/notifications/size-changed', { width: Math.ceil(box.width), height: Math.ceil(box.height) });
}
function applyHost(ctx) {
	for (var k in ctx) hostCtx[k] = ctx[k];
	if (hostCtx.theme === 'dark' || hostCtx.theme === 'light') document.documentElement.setAttribute('data-theme', hostCtx.theme);
	if (hostCtx.displayMode) hostMode = hostCtx.displayMode;
	$('bFull').hidden = (hostCtx.availableDisplayModes || []).indexOf('fullscreen') < 0;
	$('bFull').textContent = hostMode === 'fullscreen' ? 'Exit full screen' : 'Full screen';
	appSize();
}
function appPoll() {
	clearTimeout(appTimer);
	if (appStopped) return;
	appTool('build_map_view', projectArgs(appEtag ? { since: appEtag } : {})).then(function (answer) {
		if (answer.unchanged) return;
		appEtag = answer.etag || '';
		var next = answer.snapshot, facts = Boolean(next.app && next.app.facts);
		setConn(facts ? 'live' : 'wait', facts ? 'live' : 'files not read');
		showSnapshot(next, !facts ? NO_SERVER : next.protocol !== SESSION.protocol ? SKEW : '');
	}, function () {
		setConn('wait', 'reconnecting');
	}).then(function () {
		if (!appStopped) appTimer = setTimeout(appPoll, document.hidden ? 10000 : 2500);
	});
}
function appConnect() {
	setConn('wait', 'connecting');
	window.addEventListener('message', function (ev) {
		var m = ev.data;
		if (ev.source !== window.parent || !m || m.jsonrpc !== '2.0') return;
		if (m.method === undefined && m.id != null && rpcWaiting[m.id]) {
			var w = rpcWaiting[m.id];
			delete rpcWaiting[m.id];
			if (m.error) w.reject(new Error(m.error.message || 'The host refused.'));
			else w.resolve(m.result);
			return;
		}
		if (m.method === 'ui/notifications/tool-input') {
			appArgs = (m.params && m.params.arguments) || {};
			argsSeen = true;
			if (gotArgs) gotArgs();
		} else if (m.method === 'ui/notifications/host-context-changed') applyHost(m.params || {});
		else if (m.method === 'ui/resource-teardown') {
			appStopped = true;
			clearTimeout(appTimer);
			if (m.id != null) appSend({ jsonrpc: '2.0', id: m.id, result: {} });
		} else if (m.method === 'ping' && m.id != null) appSend({ jsonrpc: '2.0', id: m.id, result: {} });
	});
	// Links (variant previews, Dojo, the stores) open through the host; #node= links stay on the map.
	document.addEventListener('click', function (e) {
		var a = e.target.closest && e.target.closest('a[href]');
		if (!a || a.getAttribute('href').charAt(0) === '#') return;
		e.preventDefault();
		appRequest('ui/open-link', { url: a.href }).catch(function () {});
	});
	$('bFull').addEventListener('click', function () {
		appRequest('ui/request-display-mode', { mode: hostMode === 'fullscreen' ? 'inline' : 'fullscreen' }).then(function (r) {
			if (r && r.mode) applyHost({ displayMode: r.mode });
		}, function () {});
	});
	document.addEventListener('visibilitychange', function () { if (!document.hidden && snap) appPoll(); });
	appRequest('ui/initialize', {
		protocolVersion: '2026-01-26',
		appInfo: { name: 'extenshi-build-map', version: APP.version },
		appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }
	}).then(function (result) {
		applyHost((result && result.hostContext) || {});
		// The tool's arguments come right after this; a host that sends none gets the map of the server's working directory.
		var args = new Promise(function (resolve) { gotArgs = resolve; if (argsSeen) resolve(); setTimeout(resolve, 1500); });
		appNotify('ui/notifications/initialized', {});
		return args;
	}).then(function () {
		gotArgs = null;
		appPoll();
	}, function () {
		setConn('', 'no host');
		notice('This page is the build map for a chat that shows MCP Apps, and no chat answered. <code>npx @extenshi/cli map</code> opens it in the browser.');
	});
}

buildWorld();
applyInactive();
fit();
connect();
})();
`
