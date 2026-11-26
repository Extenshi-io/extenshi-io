/**
 * What the project files on this computer prove about the build map, with no
 * agent and no network (plan 2026-11-03-extension-build-map §6.2, phase 1).
 *
 * SYNCED COPY: @extenshi/mcp ships this file byte-identical (with png.ts and
 * build-map-store.ts, which it imports), so its get_build_map reads the same
 * facts when the author's map is not running; build-map-store-sync.test.ts in
 * that package fails when the copies drift. Edit this one, then copy it over.
 * Imports stay inside that set: node, @extenshi/contracts, the store and png.ts.
 * build-map-facts.ts (CLI only) adds the records `extenshi scan` and
 * `extenshi ai-visibility` leave, and the live Dojo readiness.
 *
 * Every fact is a sentence the inspector shows as the reason a step is done,
 * so the author can check it. Probes are conservative: a step is done only
 * when a file says so; anything a file cannot prove (research, the permission
 * audit, which modules the author wants, a store submission) stays to the
 * author's marks and the agents' reports. Settings are what the code and the
 * Dojo decisions suggest; the author's explicit choices win over them.
 *
 * Sources, in order: the extension manifest and the files it names; the source
 * tree (bounded scan for known SDK calls); the project's store folder and
 * packages; the Dojo binding cached in `.extenshi/project.json` — taken from
 * whichever checkout of the repository holds the freshest one, since worktrees
 * bind separately — or the live workspace document in its place.
 *
 * `proof` says where each fact is (the file, relative to the map's home, or the
 * Dojo record), so the evidence journal can point at it (plan §6.2.1).
 */

import { createHash } from 'node:crypto'
import { type FileHandle, open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import {
	BUILD_DOJO_DECISION_PREFIX,
	type BuildBrowser,
	type BuildDecide,
	type BuildEvidenceWhere,
	type BuildFactProof,
	type BuildFacts,
	type BuildFeature,
	type BuildSettingsPatch,
	type BuildSurface,
} from '@extenshi/contracts'
import { MAP_DIR } from './build-map-store.js'
import { decodePng } from './png.js'

type Json = Record<string, any>

const MANIFEST_CANDIDATES = [
	'manifest.json',
	'src/manifest.json',
	'public/manifest.json',
	'static/manifest.json',
]
const SOURCE_RE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx|html|vue|svelte)$/i
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'coverage', '.extenshi', '.output', '.wxt', '.plasmo'])
const MAX_SOURCE_FILES = 2_000
const MAX_SOURCE_BYTES = 512 * 1024
const MAX_SCAN_BYTES = 24 * 1024 * 1024
/** Icons bigger than this are not read for the placeholder check. */
const MAX_ICON_BYTES = 2 * 1024 * 1024
/** A package's central directory and manifest are read only up to these sizes. */
const MAX_ZIP_DIRECTORY = 8 * 1024 * 1024
const MAX_ZIP_MANIFEST = 1024 * 1024

/** Where the owner answers a project's decisions in Dojo. */
const DOJO_ORIGIN = 'https://dojo.extenshi.io'

/**
 * sha256 of the placeholder icons the scaffold commits (16, 32, 48 and 128 px,
 * shared-types/extension-placeholder-icons.ts): loadable, and never an icon the
 * author chose. build-map-files.test.ts pins them to that module.
 */
export const PLACEHOLDER_ICON_SHA256: readonly string[] = [
	'10c7354f0b8f2204f2d36f5d0111ef46540ece82d099ca871dc1aaab1df612db',
	'8f4fa764b62e851750b34cf9ee353d4e1ff5938833188feb7707d663e8b5d865',
	'a7ceb066e793e64e5ea04a1190010d81190866bcba8ade1224cd2ec9b5b020e2',
	'bca95e3e38a5c986baf9a072c27b07ccac8c1c9aeb50482917ed323b9771aec9',
]

/** The Dojo record named by facts that the project's store listings prove. */
export const DOJO_STORE_LISTINGS_RECORD = 'store listings'

/** The bound Dojo project as a live read has it; facts use only its workspace document. */
export type LiveDocument = { projectId: string; document?: Json }

export type ProjectFacts = BuildFacts & {
	proof: Record<string, BuildFactProof>
	project: { name?: string; version?: string; manifest?: string; projectId?: string; homepage?: string }
	/** Where the binding came from, when it is not the home checkout. */
	bindingFrom?: string
}

async function readJson(file: string, limit = 1024 * 1024): Promise<Json | undefined> {
	try {
		if ((await stat(file)).size > limit) return undefined
		const value = JSON.parse(await readFile(file, 'utf8'))
		return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
	} catch {
		return undefined
	}
}

async function exists(file: string): Promise<boolean> {
	try {
		await stat(file)
		return true
	} catch {
		return false
	}
}

async function listFiles(dir: string, limit = 200): Promise<string[]> {
	try {
		return (await readdir(dir)).slice(0, limit)
	} catch {
		return []
	}
}

type SourceText = {
	files: string[]
	text: string
	/** The first source file (relative to `root`) whose text matches. */
	fileOf: (pattern: RegExp) => string | undefined
	/** When the most recently changed source file changed (ms), 0 with none. */
	newest: number
}

/** Text of the source files under `root`, bounded in count and bytes; build outputs are skipped. */
async function sourceText(root: string): Promise<SourceText> {
	const files: string[] = []
	const chunks: string[] = []
	let total = 0
	let newest = 0
	const walk = async (dir: string, depth: number) => {
		if (depth > 8 || files.length >= MAX_SOURCE_FILES || total >= MAX_SCAN_BYTES) return
		let entries: import('node:fs').Dirent[]
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (files.length >= MAX_SOURCE_FILES || total >= MAX_SCAN_BYTES) return
			const location = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (SKIPPED_DIRS.has(entry.name) || /^(dist|build)([-_].*)?$/.test(entry.name)) continue
				await walk(location, depth + 1)
			} else if (entry.isFile() && SOURCE_RE.test(entry.name)) {
				try {
					const info = await stat(location)
					if (info.size > MAX_SOURCE_BYTES) continue
					files.push(path.relative(root, location))
					chunks.push(await readFile(location, 'utf8'))
					total += info.size
					newest = Math.max(newest, info.mtimeMs)
				} catch {
					// unreadable: skip
				}
			}
		}
	}
	await walk(root, 0)
	return {
		files,
		text: chunks.join('\n'),
		fileOf: (pattern) => {
			const index = chunks.findIndex((chunk) => pattern.test(chunk))
			return index >= 0 ? files[index] : undefined
		},
		newest,
	}
}

/** The extension manifest of a project directory, or the first candidate that parses as one. */
export async function findManifest(dir: string): Promise<{ file: string; manifest: Json } | undefined> {
	for (const candidate of MANIFEST_CANDIDATES) {
		const file = path.join(dir, candidate)
		const manifest = await readJson(file)
		if (manifest && typeof manifest.manifest_version === 'number') return { file, manifest }
	}
	return undefined
}

/** The freshest Dojo binding among the project's checkouts (`fetchedAt`, then file mtime). */
async function freshestBinding(dirs: readonly string[]): Promise<{ dir: string; binding: Json } | undefined> {
	let best: { dir: string; binding: Json; at: number } | undefined
	for (const dir of dirs) {
		const file = path.join(dir, MAP_DIR, 'project.json')
		const binding = await readJson(file, 8 * 1024 * 1024)
		if (!binding?.projectId) continue
		let at = Date.parse(binding.fetchedAt ?? '')
		if (!Number.isFinite(at)) at = (await stat(file)).mtimeMs
		if (!best || at > best.at) best = { dir, binding, at }
	}
	return best && { dir: best.dir, binding: best.binding }
}

/** The Dojo project id bound in any checkout of the project (the freshest binding wins). */
export async function boundProjectId(checkouts: readonly string[]): Promise<string | undefined> {
	return (await freshestBinding(checkouts))?.binding.projectId
}

const BROWSERS: readonly BuildBrowser[] = ['chrome', 'firefox', 'edge']

/** `__MSG_key__` resolved from the default locale's catalog (keys are case-insensitive); the raw value otherwise. */
async function displayName(manifest: Json, root: string): Promise<string | undefined> {
	if (typeof manifest.name !== 'string' || !manifest.name.trim()) return undefined
	const key = /^__MSG_(\w+)__$/.exec(manifest.name)?.[1]
	if (!key || typeof manifest.default_locale !== 'string') return manifest.name
	const catalog = await readJson(path.join(root, '_locales', manifest.default_locale, 'messages.json'))
	const entry = Object.entries(catalog ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1]
	return typeof entry?.message === 'string' && entry.message.trim() ? entry.message : manifest.name
}

/** The map step where each store's submission is made. */
const SUBMIT_STEP: Record<BuildBrowser, string> = { chrome: 'cws', firefox: 'amo', edge: 'edge' }
const STORE_NAME: Record<BuildBrowser, string> = {
	chrome: 'Chrome Web Store',
	firefox: 'AMO',
	edge: 'Edge Add-ons',
}

/**
 * Store listings recorded in Dojo (workspace `storeListings`): a submitted or
 * live listing is that store's submit step done; review tracking is done once
 * every target store's listing is live. The targets are the browsers known so
 * far, else the stores that have a submitted or live listing.
 */
function listingFacts(
	listings: unknown,
	browsers: Partial<Record<BuildBrowser, boolean>>,
	done: Record<string, string>,
	fromDojo: (id: string, record: string) => void,
): void {
	if (!listings || typeof listings !== 'object') return
	const status = (browser: BuildBrowser): string | undefined => {
		const entry = (listings as Json)[browser]
		return entry && typeof entry === 'object' && typeof entry.status === 'string' ? entry.status : undefined
	}
	for (const browser of BROWSERS) {
		const state = status(browser)
		if (state !== 'submitted' && state !== 'live') continue
		const submittedAt = (listings as Json)[browser]?.submittedAt
		const when = typeof submittedAt === 'string' ? ` (submitted ${submittedAt.slice(0, 10)})` : ''
		done[SUBMIT_STEP[browser]] =
			state === 'live'
				? `the ${STORE_NAME[browser]} listing is live (Dojo store listings)`
				: `the ${STORE_NAME[browser]} listing is submitted${when} (Dojo store listings)`
		fromDojo(SUBMIT_STEP[browser], DOJO_STORE_LISTINGS_RECORD)
	}
	// The name is settled once a store has it: a listing under it is submitted or live.
	const listed = BROWSERS.find((browser) => ['submitted', 'live'].includes(status(browser) ?? ''))
	if (listed) {
		done.identity = `the name is in the ${STORE_NAME[listed]} listing (Dojo store listings)`
		fromDojo('identity', DOJO_STORE_LISTINGS_RECORD)
	}
	const chosen = BROWSERS.filter((browser) => browsers[browser] === true)
	const targets = chosen.length
		? chosen
		: BROWSERS.filter((browser) => ['submitted', 'live'].includes(status(browser) ?? ''))
	if (targets.length && targets.every((browser) => status(browser) === 'live')) {
		done.track = `the listings are live in ${targets.map((browser) => STORE_NAME[browser]).join(', ')} (Dojo store listings)`
		fromDojo('track', DOJO_STORE_LISTINGS_RECORD)
	}
}

/** A pricing decision in words: "paid, 7-day trial, subscription". */
function pricingWords(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return undefined
	const { model, trialDays, plans } = value as Json
	if (typeof model !== 'string') return undefined
	const parts = [model]
	if (typeof trialDays === 'number' && trialDays > 0) parts.push(`${trialDays}-day trial`)
	if (Array.isArray(plans) && plans.length)
		parts.push(plans.map((plan) => String(plan).replace('_', '-')).join(' or '))
	return parts.join(', ')
}

/**
 * Why a declared icon is not an icon anyone chose, or undefined when it may be
 * one: the scaffold's placeholder (by hash), a picture of one colour (one
 * covering 97% of it — a filled square, a blank), or an empty file. Few colours
 * alone prove nothing: a flat glyph on a plain ground is an icon. A PNG this
 * module cannot decode (a palette or 16-bit one, another format) is given the
 * benefit.
 */
async function placeholderIcon(file: string): Promise<string | undefined> {
	let bytes: Buffer
	try {
		if ((await stat(file)).size > MAX_ICON_BYTES) return undefined
		bytes = await readFile(file)
	} catch {
		return undefined
	}
	if (!bytes.length) return 'an empty file'
	if (PLACEHOLDER_ICON_SHA256.includes(createHash('sha256').update(bytes).digest('hex')))
		return 'the scaffold placeholder'
	const png = decodePng(bytes)
	if (!png) return undefined
	const counts = new Map<number, number>()
	const pixels = png.width * png.height
	for (let i = 0; i < pixels; i++) {
		const at = i * png.channels
		const alpha = png.channels === 4 ? png.data[at + 3] : 255
		// 4 bits per colour channel, 2 for alpha; every nearly transparent pixel is one colour.
		const key =
			alpha < 16
				? -1
				: ((png.data[at] >> 4) << 10) |
					((png.data[at + 1] >> 4) << 6) |
					((png.data[at + 2] >> 4) << 2) |
					(alpha >> 6)
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	const top = Math.max(...counts.values())
	return top / pixels >= 0.97 ? 'a picture of one colour' : undefined
}

/** Test files by name (`*.test.*`, `*.spec.*`) or by folder (tests, test, __tests__, e2e). */
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i
const TEST_DIRS = new Set(['tests', 'test', '__tests__', 'e2e'])
const SCRIPT_RE = /\.[cm]?[jt]sx?$/i
/** Relative module specifiers a test imports or requires. */
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`](\.{1,2}\/[^"'`]+)["'`]/g
/**
 * A test that starts a browser with the extension loaded exercises all of it. Starting a
 * browser is not enough: the test must hand it the extension (Chromium flags, Puppeteer's
 * option, web-ext).
 */
const LOADS_EXTENSION_RE =
	/--load-extension\b|--disable-extensions-except\b|\benableExtensions\s*:|\binstallExtension\s*\(|\bweb-ext\s+run\b|\bwebExt\.cmd\.run\b/

/** A module's identity: its path without the extension, an index file standing for its folder. */
function moduleKey(file: string): string {
	const bare = file.replace(/\.(?:[cm]?[jt]sx?|html)$/i, '')
	return path.basename(bare) === 'index' ? path.dirname(bare) : bare
}

/**
 * What a test imports when it tests `script`: the script itself, or the source it is built
 * from under `src/` (a manifest in public/ or static/ is copied into the build, and one
 * naming dist/ or build/ names bundles), by path, never by file name alone.
 */
function scriptKeys(home: string, root: string, script: string): string[] {
	const parts = path.relative(root, script).split(path.sep)
	const source = /^(dist|build|out)$/.test(parts[0]) ? parts.slice(1) : parts
	return [moduleKey(script), moduleKey(path.join(home, 'src', ...source))]
}

/**
 * The scripts the extension runs, where its handlers are: the background, the content
 * scripts, and the scripts of its pages (popup, options, side panel, background page).
 * Absolute paths, whether or not the files exist.
 */
async function runScripts(root: string, manifest: Json): Promise<string[]> {
	const background: Json = manifest.background ?? {}
	const scripts: string[] = [
		background.service_worker,
		...(Array.isArray(background.scripts) ? background.scripts : []),
		...(Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).flatMap((entry: Json) =>
			Array.isArray(entry?.js) ? entry.js : [],
		),
	]
		.filter((script): script is string => typeof script === 'string')
		.map((script) => path.join(root, script))
	const pages = [
		manifest.action?.default_popup,
		manifest.browser_action?.default_popup,
		manifest.page_action?.default_popup,
		manifest.options_ui?.page,
		manifest.options_page,
		manifest.side_panel?.default_path,
		manifest.sidebar_action?.default_panel,
		background.page,
	].filter((page): page is string => typeof page === 'string' && page !== '')
	for (const page of pages) {
		const file = path.join(root, page)
		let html: string
		try {
			if ((await stat(file)).size > MAX_SOURCE_BYTES) continue
			html = await readFile(file, 'utf8')
		} catch {
			continue
		}
		for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
			if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue
			scripts.push(src.startsWith('/') ? path.join(root, src) : path.join(path.dirname(file), src))
		}
	}
	return scripts
}

/**
 * The first test under `home` that reaches the extension's handlers: one importing a
 * script the extension runs (`entry`, the manifest's under `root`), or one loading the
 * extension in a browser.
 */
async function testOfHandlers(
	home: string,
	root: string,
	scripts: readonly string[],
): Promise<{ test: string; entry?: string } | undefined> {
	const byKey = new Map(
		scripts.flatMap((script) => scriptKeys(home, root, script).map((key) => [key, script] as const)),
	)
	const tests: string[] = []
	const walk = async (dir: string, depth: number, inTests: boolean) => {
		if (depth > 6 || tests.length >= 200) return
		let entries: import('node:fs').Dirent[]
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (tests.length >= 200) return
			const location = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
				if (/^(dist|build)([-_].*)?$/.test(entry.name)) continue
				await walk(location, depth + 1, inTests || TEST_DIRS.has(entry.name))
			} else if (entry.isFile() && (TEST_FILE_RE.test(entry.name) || (inTests && SCRIPT_RE.test(entry.name))))
				tests.push(location)
		}
	}
	await walk(home, 0, false)
	for (const test of tests) {
		let text: string
		try {
			if ((await stat(test)).size > MAX_SOURCE_BYTES) continue
			text = await readFile(test, 'utf8')
		} catch {
			continue
		}
		for (const [, specifier] of text.matchAll(IMPORT_RE)) {
			const entry = byKey.get(moduleKey(path.resolve(path.dirname(test), specifier)))
			if (entry) return { test, entry }
		}
		if (LOADS_EXTENSION_RE.test(text)) return { test }
	}
	return undefined
}

/** A drawing of the icon the author keeps in the project: an SVG named icon or logo. */
async function iconSource(home: string, root: string): Promise<string | undefined> {
	const dirs = [root, home].flatMap((base) =>
		[
			'.',
			'icons',
			'icon',
			'assets',
			'images',
			'img',
			'design',
			'art',
			'store',
			'assets/store',
			'concepts',
		].map((sub) => path.join(base, sub)),
	)
	for (const dir of [...new Set(dirs)]) {
		const svg = (await listFiles(dir, 500)).find((name) => /\.svg$/i.test(name) && /icon|logo/i.test(name))
		if (svg) return path.join(dir, svg)
	}
	return undefined
}

/**
 * The version in the manifest.json a zip package carries (the shallowest one):
 * null when it carries none, undefined when the zip cannot be read. Reads the
 * central directory and that one entry, not the whole package.
 */
async function zipManifestVersion(file: string): Promise<string | null | undefined> {
	let handle: FileHandle | undefined
	try {
		handle = await open(file, 'r')
		const { size } = await handle.stat()
		const tailSize = Math.min(size, 22 + 0xffff)
		if (tailSize < 22) return undefined
		const tail = Buffer.alloc(tailSize)
		await handle.read(tail, 0, tailSize, size - tailSize)
		let end = -1
		for (let at = tailSize - 22; at >= 0; at--)
			if (tail.readUInt32LE(at) === 0x06054b50) {
				end = at
				break
			}
		if (end < 0) return undefined
		const count = tail.readUInt16LE(end + 10)
		const directorySize = tail.readUInt32LE(end + 12)
		const directoryAt = tail.readUInt32LE(end + 16)
		if (directorySize > MAX_ZIP_DIRECTORY || directoryAt + directorySize > size) return undefined
		const directory = Buffer.alloc(directorySize)
		await handle.read(directory, 0, directorySize, directoryAt)
		let found: { depth: number; method: number; packed: number; plain: number; at: number } | undefined
		for (let at = 0, n = 0; n < count && at + 46 <= directory.length; n++) {
			if (directory.readUInt32LE(at) !== 0x02014b50) return undefined
			const nameLength = directory.readUInt16LE(at + 28)
			const name = directory.toString('utf8', at + 46, at + 46 + nameLength)
			const depth = name.split('/').length
			if ((name === 'manifest.json' || name.endsWith('/manifest.json')) && (!found || depth < found.depth))
				found = {
					depth,
					method: directory.readUInt16LE(at + 10),
					packed: directory.readUInt32LE(at + 20),
					plain: directory.readUInt32LE(at + 24),
					at: directory.readUInt32LE(at + 42),
				}
			at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32)
		}
		if (!found) return null
		if (found.packed > MAX_ZIP_MANIFEST || found.plain > MAX_ZIP_MANIFEST) return undefined
		if (found.method !== 0 && found.method !== 8) return undefined
		const head = Buffer.alloc(30)
		await handle.read(head, 0, 30, found.at)
		if (head.readUInt32LE(0) !== 0x04034b50) return undefined
		const data = Buffer.alloc(found.packed)
		await handle.read(data, 0, found.packed, found.at + 30 + head.readUInt16LE(26) + head.readUInt16LE(28))
		const raw = found.method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_ZIP_MANIFEST }) : data
		const manifest = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''))
		return typeof manifest?.version === 'string' ? manifest.version : null
	} catch {
		return undefined
	} finally {
		await handle?.close()
	}
}

/**
 * Facts the files prove for the project whose map lives in `home`. `checkouts`
 * are the same project directory in every worktree (home first); the binding
 * may sit in any. `live` stands in for the cached workspace document, only for
 * the project the binding names.
 */
export async function readFileFacts(
	home: string,
	checkouts: readonly string[] = [home],
	live?: LiveDocument,
): Promise<ProjectFacts> {
	const done: Record<string, string> = {}
	const surfaces: Partial<Record<BuildSurface, boolean>> = {}
	const browsers: Partial<Record<BuildBrowser, boolean>> = {}
	const features: Partial<Record<BuildFeature, boolean>> = {}
	const settings: BuildSettingsPatch = { surfaces, browsers, features }
	const proof: Record<string, BuildFactProof> = {}
	const decide: Record<string, BuildDecide> = {}
	const modules: Partial<Record<BuildFeature, BuildFactProof>> = {}
	const facts: ProjectFacts = { done, settings, modules, proof, decide, project: {} }
	const fromDojo = (id: string, record: string) => {
		proof[id] = { basis: 'dojo', where: [{ dojo: record }] }
	}

	const found = await findManifest(home)
	const bound = await freshestBinding(checkouts)
	if (bound) {
		facts.project.projectId = bound.binding.projectId
		if (bound.dir !== home) facts.bindingFrom = bound.dir
	}

	// Browsers: the owner's decision, then what the project builds for, then a proposal, then the gecko id.
	const fresh = live?.document && live.projectId === bound?.binding.projectId ? live.document : undefined
	const document: Json = fresh ?? bound?.binding.document ?? {}
	const entries: Json = document.spec?.decisions?.entries ?? {}
	const decided = entries.targetBrowsers
	const built = Object.keys(document.builtManifests ?? {}).filter((b): b is BuildBrowser =>
		BROWSERS.includes(b as BuildBrowser),
	)
	const proposedBrowsers =
		decided?.status === 'proposed' && Array.isArray(decided.value)
			? BROWSERS.filter((browser) => decided.value.includes(browser))
			: []
	if (Array.isArray(decided?.value) && decided.status === 'decided') {
		for (const browser of BROWSERS) browsers[browser] = decided.value.includes(browser)
		done.browsers = `the owner decided the target browsers in Dojo: ${decided.value.join(', ')}`
		fromDojo('browsers', `${BUILD_DOJO_DECISION_PREFIX}targetBrowsers`)
	} else if (built.length) {
		for (const browser of built) browsers[browser] = true
		done.browsers = `the project builds for ${built.join(', ')} (Dojo binding)`
		fromDojo('browsers', 'built manifests')
	} else if (proposedBrowsers.length) {
		// A proposal is what an agent suggested: it sets the stores, the owner still decides.
		for (const browser of BROWSERS) browsers[browser] = proposedBrowsers.includes(browser)
	}
	const pricing = entries.pricing
	if (pricing?.status === 'decided') {
		done.pricing = 'the owner decided the pricing in Dojo'
		fromDojo('pricing', `${BUILD_DOJO_DECISION_PREFIX}pricing`)
	}
	// A paid model, proposed or decided, needs the monetization steps.
	if (pricing?.value?.model === 'paid') {
		features.monetization = true
		modules.monetization = { basis: 'dojo', where: [{ dojo: `${BUILD_DOJO_DECISION_PREFIX}pricing` }] }
	}
	// A bound project: the owner answers these in Dojo, so the map leads there instead of asking again.
	if (bound) {
		const url = `${DOJO_ORIGIN}/projects/${encodeURIComponent(bound.binding.projectId)}?stage=ship&node=decisions`
		if (!done.browsers)
			decide.browsers = {
				key: 'targetBrowsers',
				url,
				...(proposedBrowsers.length ? { proposed: proposedBrowsers.join(', ') } : {}),
			}
		const proposedPricing = pricing?.status === 'proposed' ? pricingWords(pricing.value) : undefined
		if (!done.pricing)
			decide.pricing = { key: 'pricing', url, ...(proposedPricing ? { proposed: proposedPricing } : {}) }
	}

	listingFacts(document.storeListings, browsers, done, fromDojo)

	if (!found) return facts
	const { file, manifest } = found
	const root = path.dirname(file)
	const rel = (location: string) => path.relative(home, location) || '.'
	const manifestName = rel(file)
	facts.project.manifest = manifestName
	const name = await displayName(manifest, root)
	if (name) facts.project.name = name
	if (typeof manifest.version === 'string') facts.project.version = manifest.version
	const named = async (value: unknown) => typeof value === 'string' && (await exists(path.join(root, value)))
	/** The fact `id` rests on these paths (absolute, or relative to the extension root). */
	const at = (id: string, ...locations: (string | undefined)[]) => {
		const where: BuildEvidenceWhere[] = locations
			.filter((location): location is string => typeof location === 'string' && location !== '')
			.map((location) => ({ file: rel(path.isAbsolute(location) ? location : path.join(root, location)) }))
		proof[id] = { basis: 'project', ...(where.length ? { where } : {}) }
	}

	// The extension exists: what it is and where it runs were decided. Its name is not:
	// a name in the manifest is not checked against other extensions or locked (a store
	// listing under it is, see listingFacts). The modules are not either: the code only
	// suggests them, and the author confirms the choice.
	done.idea = `the project already has ${manifestName}`
	done.scaffold = `${manifestName} and its files are on disk`
	done.surfaces = `${manifestName} declares the extension's surfaces`
	if (typeof manifest.version === 'string' && name)
		done.manifest = `${manifestName} declares name and version ${manifest.version}`
	for (const id of ['idea', 'scaffold', 'surfaces', 'manifest']) if (done[id]) at(id, file)

	const background = manifest.background ?? {}
	const backgroundFile =
		background.service_worker ?? (Array.isArray(background.scripts) ? background.scripts[0] : undefined)
	surfaces.background = Boolean(backgroundFile || background.page)
	if (await named(backgroundFile)) {
		done.bg = `${manifestName} runs ${backgroundFile} in the background`
		at('bg', backgroundFile)
	}

	const contentScripts: Json[] = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []
	surfaces.content = contentScripts.length > 0
	const matches = contentScripts.flatMap((entry) => (Array.isArray(entry.matches) ? entry.matches : []))
	const hosts = [...matches, ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [])]
	if (hosts.length)
		done.sites = `${manifestName} lists ${hosts.length} match pattern${hosts.length === 1 ? '' : 's'}`
	else if (!contentScripts.length) done.sites = 'the extension runs on no particular site'
	if (done.sites) at('sites', file)
	const contentFile = contentScripts.flatMap((entry) => entry.js ?? [])[0]
	if (await named(contentFile)) {
		done.content = `${manifestName} injects ${contentFile}`
		at('content', contentFile)
	}

	const popup = manifest.action?.default_popup ?? manifest.browser_action?.default_popup
	surfaces.popup = Boolean(popup)
	if (await named(popup)) {
		done.popup = `${manifestName} opens ${popup} from the toolbar`
		at('popup', popup)
	}

	const options = manifest.options_ui?.page ?? manifest.options_page
	surfaces.options = Boolean(options)
	if (await named(options)) {
		done.options = `${manifestName} declares the options page ${options}`
		at('options', options)
	}

	const sidePanel = manifest.side_panel?.default_path ?? manifest.sidebar_action?.default_panel
	surfaces.sidepanel = Boolean(sidePanel)
	if (await named(sidePanel)) {
		done.sidepanel = `${manifestName} declares the side panel ${sidePanel}`
		at('sidepanel', sidePanel)
	}

	const gecko = manifest.browser_specific_settings?.gecko ?? manifest.applications?.gecko
	if (gecko?.id && browsers.firefox === undefined) browsers.firefox = true

	// Localization: a default locale with its catalog, the manifest reading from it, and the
	// languages it ships in: every one the target-locales decision in Dojo names (proposed or
	// decided), or, without a decision, more than one. One catalog is the strings extracted.
	const localeDir = path.join(root, '_locales')
	const locales = (
		await Promise.all(
			(
				await listFiles(localeDir)
			).map(async (code) => ((await exists(path.join(localeDir, code, 'messages.json'))) ? code : undefined)),
		)
	).filter((code): code is string => code !== undefined)
	if (locales.length) features.i18n = true
	const targetLocales: string[] = (
		Array.isArray(entries.targetLocales?.value)
			? entries.targetLocales.value
			: Array.isArray(document.spec?.targetLocales)
				? document.spec.targetLocales
				: []
	).filter((code: unknown): code is string => typeof code === 'string')
	const localeKey = (code: string) => code.toLowerCase().replace(/-/g, '_')
	const shipped = new Set(locales.map(localeKey))
	const languagesDone = targetLocales.length
		? targetLocales.every((code) => shipped.has(localeKey(code)))
		: locales.length > 1
	if (
		languagesDone &&
		typeof manifest.default_locale === 'string' &&
		(await exists(path.join(localeDir, manifest.default_locale, 'messages.json'))) &&
		JSON.stringify(manifest).includes('__MSG_')
	) {
		done.i18n = targetLocales.length
			? `_locales has the ${targetLocales.length} target languages (Dojo decision), the manifest reads from them`
			: `_locales has ${locales.length} languages, the manifest reads from them`
		at('i18n', path.join('_locales', manifest.default_locale, 'messages.json'))
	}

	// Icons: every declared size exists and none is a placeholder. The concept is
	// chosen on the map, or the project keeps the drawing the set is made from.
	const icons: Json = manifest.icons ?? {}
	const iconFiles = Object.values(icons).filter((value): value is string => typeof value === 'string')
	const sizes = Object.keys(icons)
	if (iconFiles.length && (await Promise.all(iconFiles.map(named))).every(Boolean)) {
		const stubs = (
			await Promise.all(
				iconFiles.slice(0, 8).map(async (icon) => {
					const why = await placeholderIcon(path.join(root, icon))
					return why ? `${icon} is ${why}` : undefined
				}),
			)
		).filter((why): why is string => why !== undefined)
		if (!stubs.length) {
			done.manifestIcons = `${manifestName} names icon files for ${sizes.join(', ')} px and they exist`
			at('manifestIcons', file, ...iconFiles)
			if (['16', '48', '128'].every((size) => sizes.includes(size))) {
				done.iconSet = `icons for ${sizes.join(', ')} px are on disk`
				at('iconSet', ...iconFiles)
			}
		}
	}
	const drawing = await iconSource(home, root)
	if (drawing) {
		done.iconConcepts = `${rel(drawing)} is the drawing the icon is made from`
		at('iconConcepts', drawing)
	}

	// Source scan: SDKs and calls the map steps produce.
	const { text, fileOf, newest } = await sourceText(root)
	const pkgFile = path.join(home, 'package.json')
	const pkg = (await readJson(pkgFile)) ?? {}
	const deps = { ...pkg.dependencies, ...pkg.devDependencies }
	// A module the code has switches its steps on; one it lacks keeps the default, so the
	// map still offers it instead of calling the extension finished.
	if ('extenshi-collector' in deps || /extenshi-collector/.test(text)) {
		features.analytics = true
		done.analytics = 'the Extenshi Collector SDK is in the code'
		at('analytics', 'extenshi-collector' in deps ? pkgFile : fileOf(/extenshi-collector/))
	}
	// Integration config values (src/extenshi.config.js, or a hand-written equivalent):
	// a link the author gave on the map, or the generated config once Dojo has the
	// page, lands here.
	const configUrl = (key: string, scheme = 'https?') =>
		new RegExp(`\\b${key.replace(/\$/g, '\\$')}["']?\\s*[:=]\\s*["']${scheme}://`)
	// The hook is a call that sets an address: an https literal, or a name the code sets to
	// one. A call behind an empty UNINSTALL_FORM_URL opens nothing. The survey is the page it
	// opens, which only a link proves.
	const uninstallCall = /\bsetUninstallURL\s*\(\s*([^)]*?)\s*\)/g
	const uninstallArgs = [...text.matchAll(uninstallCall)].map((match) => match[1])
	if (uninstallArgs.length) features.uninstall = true
	for (const arg of uninstallArgs) {
		const setting = () =>
			[...arg.matchAll(/[A-Za-z_$][\w$]*/g)]
				.map(([name]) => name)
				.find((name) => configUrl(name, 'https').test(text))
		const key = /^[`'"]https:\/\//.test(arg) ? undefined : setting()
		const to = key
			? `${key}, set to an https link`
			: /^[`'"]https:\/\//.test(arg)
				? 'an https address'
				: undefined
		if (!to) continue
		done.uninstallHook = `the service worker calls setUninstallURL with ${to}`
		at('uninstallHook', fileOf(/\bsetUninstallURL\s*\(/))
		break
	}
	const uninstallForm = configUrl('UNINSTALL_FORM_URL', 'https')
	if (uninstallForm.test(text)) {
		features.uninstall = true
		done.survey = 'the integration config holds the uninstall survey URL'
		at('survey', fileOf(uninstallForm))
	}
	const policyLink = configUrl('PRIVACY_POLICY_URL')
	if (policyLink.test(text)) {
		const file = fileOf(policyLink)
		done.policyUrl = 'the integration config holds the privacy policy URL'
		at('policyUrl', file)
		done.policy = 'the integration config links a published privacy policy'
		at('policy', file)
	}
	// A homepage: the integration config holds its URL once a page is published or
	// registered, and the manifest names it for the stores.
	const homepageLink = configUrl('HOMEPAGE_URL')
	if (homepageLink.test(text)) {
		done.homepage = 'the integration config holds the homepage URL'
		at('homepage', fileOf(homepageLink))
		// The address itself, so a site check of another page does not count for this one.
		facts.project.homepage = /\bHOMEPAGE_URL["']?\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/.exec(text)?.[1]
	} else if (typeof manifest.homepage_url === 'string' && /^https:\/\//i.test(manifest.homepage_url)) {
		done.homepage = `${manifestName} names the homepage ${manifest.homepage_url}`
		at('homepage', file)
		facts.project.homepage = manifest.homepage_url
	}
	// The generated config carries FEEDBACK_FORM_URL only once a form exists in Dojo;
	// a form URL written into the code proves the same.
	const formUrl =
		/"FEEDBACK_FORM_URL"\s*:\s*"https?:|feedback\.extenshi\.io\/[a-z0-9]{6,}|\/feedback-form\/[a-z0-9]{6,}/i
	if (formUrl.test(text)) {
		features.feedback = true
		done.feedbackForm = 'the code holds the hosted feedback form URL'
		at('feedbackForm', fileOf(formUrl))
		const opens = /\bopenFeedbackForm\s*\(|\.FEEDBACK_FORM_URL\b|\bconst\s+FEEDBACK_FORM_URL\s*=/
		if (opens.test(text)) {
			done.feedbackLinks = 'the extension opens the feedback form'
			at('feedbackLinks', fileOf(opens))
		}
	}
	if ('@extenshi/pay' in deps || /\bExtenshiPay\b|extenshi-pay/.test(text)) {
		features.monetization = true
		delete modules.monetization
		done.pay = 'the Extenshi Pay SDK is in the code'
		const sdk = '@extenshi/pay' in deps ? pkgFile : fileOf(/\bExtenshiPay\b|extenshi-pay/)
		at('pay', sdk)
		if (!done.pricing) {
			done.pricing = 'the extension already sells through Extenshi Pay'
			at('pricing', sdk)
			delete decide.pricing
		}
		const paywall = /\bshowPaywall\s*\(|\bExtenshiPay\b/
		if (paywall.test(text)) {
			done.paywall = 'the code opens the Extenshi paywall'
			at('paywall', fileOf(paywall))
		}
	}
	const welcome = (await listFiles(root)).find((name) => /^(welcome|onboarding)/i.test(name))
	if (welcome && /onInstalled/.test(text)) {
		features.onboarding = true
		done.onboarding = `${rel(path.join(root, welcome))} opens after install`
		at('onboarding', welcome)
	}

	// Store folder: listing copy, screenshots, promo tiles.
	for (const storeDir of ['store', 'assets/store', 'store-assets', '.']) {
		const dir = path.join(home, storeDir)
		const names = await listFiles(dir, 500)
		if (!names.length) continue
		const listing = names.find((name) => /^(CHROMEWEBSTORE|LISTINGS?)\.md$/i.test(name))
		if (listing && !done.listing) {
			done.listing = `${rel(path.join(dir, listing))} holds the listing copy`
			at('listing', path.join(dir, listing))
		}
		const promo = names.filter((name) => /(promo|marquee).*\.(png|jpe?g)$/i.test(name))
		if (promo.length) {
			if (!done.promo) {
				done.promo = `${promo.length} promo tile${promo.length === 1 ? '' : 's'} in ${rel(dir)}`
				at('promo', ...promo.slice(0, 5).map((name) => path.join(dir, name)))
			}
			features.promo = true
		}
		const shots = (await listFiles(path.join(dir, 'screenshots'), 500)).filter((name) =>
			/\.(png|jpe?g)$/i.test(name),
		)
		if (shots.length && !done.screenshots) {
			done.screenshots = `${shots.length} screenshot${shots.length === 1 ? '' : 's'} in ${rel(path.join(dir, 'screenshots'))}`
			at('screenshots', ...shots.slice(0, 5).map((name) => path.join(dir, 'screenshots', name)))
		}
	}

	// Build outputs and packages.
	for (const out of ['dist', 'build', '.output/chrome-mv3', 'build/chrome-mv3-prod']) {
		if (await exists(path.join(home, out, 'manifest.json'))) {
			done.build = `${out}/manifest.json is a built bundle`
			at('build', path.join(home, out, 'manifest.json'))
			break
		}
	}
	const top = await listFiles(home, 500)
	const perBrowserBuilds = top.filter((name) => /^dist-(firefox|edge)$/.test(name))
	if (done.build && perBrowserBuilds.length) {
		done.compat = `per-browser builds: ${perBrowserBuilds.join(', ')}`
		at('compat', ...perBrowserBuilds.map((name) => path.join(home, name, 'manifest.json')))
	}
	// A package counts while it is the current one: built after the last change to the
	// sources and the manifest, carrying the manifest's version. A source archive (no
	// manifest of its own) goes along with it.
	const zipFiles = [
		...top.filter((name) => /\.zip$/i.test(name)).map((name) => path.join(home, name)),
		...(await listFiles(path.join(home, MAP_DIR, 'packages')))
			.filter((name) => /\.zip$/i.test(name))
			.map((name) => path.join(home, MAP_DIR, 'packages', name)),
	].slice(0, 20)
	const changed = Math.max(newest, (await stat(file)).mtimeMs)
	const current: string[] = []
	let versioned = 0
	for (const location of zipFiles) {
		try {
			if ((await stat(location)).mtimeMs < changed) continue
		} catch {
			continue
		}
		const version = await zipManifestVersion(location)
		if (version === manifest.version) versioned++
		if (version === manifest.version || version === null) current.push(location)
	}
	if (versioned && typeof manifest.version === 'string') {
		const zips = current.map((location) => path.basename(location))
		done.zip = `${zips.length} package${zips.length === 1 ? '' : 's'} of version ${manifest.version}, newer than the sources (${zips.slice(0, 3).join(', ')})`
		at('zip', ...current.slice(0, 5))
	}

	// Tests: a test that reaches the handlers, by importing a script the extension runs
	// (the background, a content script, a page's script) or by loading the extension in a
	// browser. A test folder of helpers' tests does not; whether they pass is the release's
	// test evidence (Dojo).
	const handlerTest = await testOfHandlers(home, root, await runScripts(root, manifest))
	if (handlerTest) {
		done.tests = handlerTest.entry
			? `${rel(handlerTest.test)} imports ${rel(handlerTest.entry)}, which the extension runs`
			: `${rel(handlerTest.test)} loads the extension in a browser`
		at('tests', handlerTest.test, handlerTest.entry)
	}
	// CI: a workflow that runs extenshi switches the step on. It is done once Dojo holds
	// passing evidence from CI (release readiness, ciVerified), which needs the project
	// bound and the evidence secret in the repository: the workflow file proves neither.
	const workflows = path.join(home, '.github', 'workflows')
	for (const name of await listFiles(workflows)) {
		try {
			if (/extenshi/i.test(await readFile(path.join(workflows, name), 'utf8'))) {
				features.ci = true
				break
			}
		} catch {
			// unreadable
		}
	}

	// The release the binding last prepared carries digests of what it shipped.
	const release: Json = document.release ?? {}
	const prepared = `release ${release.version ?? ''}`.trim()
	if (release.policyDigest && !done.policy) {
		done.policy = 'the prepared release carries a privacy policy (Dojo binding)'
		fromDojo('policy', prepared)
	}
	if (release.listingDigest && !done.listing) {
		done.listing = 'the prepared release carries listing copy (Dojo binding)'
		fromDojo('listing', prepared)
	}
	if (release.artifactDigest && release.version && !done.zip) {
		done.zip = `the prepared release ${release.version} carries a package (Dojo binding)`
		fromDojo('zip', prepared)
	}

	return facts
}
