import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { BUILD_NODES, deriveBuildMap, emptyBuildMapState } from '@extenshi/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMapApp, registerBuildMapApp } from './build-map-app.js'
import { MAP_SERVER_FILE, mapPath, readMapState, updateMapState, writeJsonAtomic } from './build-map-store.js'
import { buildMapAgent } from './build-map-tools.js'
import {
	BUILD_MAP_APP_TOOLS,
	BUILD_MAP_UI,
	clientShowsApps,
	MCP_APP_MIME,
	MCP_APPS_EXTENSION,
} from './build-map-ui.js'
import { registerTools } from './tools.js'

const temps: string[] = []
const servers: http.Server[] = []
const ICONS = 'iconConcepts'

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mcp-build-map-app-')))
	temps.push(dir)
	return dir
}

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
	const home = tempDir()
	await updateMapState(home, (state) => state)
	mkdirSync(path.join(home, 'concepts'))
	writeFileSync(path.join(home, 'concepts', 'ruler.html'), '<p>ruler</p>')
	writeFileSync(path.join(home, 'concepts', 'letter.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
	return home
}

/** The author's map server, as build-map-tools.test.ts runs it: its snapshot carries the view it derived. */
async function runningMap(home: string, extra: Record<string, unknown> = {}): Promise<string> {
	const instance = 'instance-1'
	const view = deriveBuildMap(emptyBuildMapState(), { done: {} })
	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(
			JSON.stringify(
				req.url === '/api/map'
					? { protocol: 6, view, reviews: {}, generatedAt: new Date().toISOString(), ...extra }
					: { instance, home, protocol: 6, version: 'test', clients: 1 },
			),
		)
	})
	servers.push(server)
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as AddressInfo).port
	const url = `http://127.0.0.1:${port}/`
	await writeJsonAtomic(mapPath(home, MAP_SERVER_FILE), {
		pid: process.pid,
		host: os.hostname(),
		port,
		url,
		instance,
		token: 't',
		protocol: 6,
		version: 'test',
		home,
		startedAt: new Date().toISOString(),
	})
	return url
}

async function offerIcons(home: string) {
	await buildMapAgent(home).requestReview(undefined, {
		step: ICONS,
		agent: 'icons agent',
		variants: [
			{ label: 'Ruler', preview: 'concepts/ruler.html' },
			{ label: 'Letter', preview: 'concepts/letter.svg', image: 'concepts/letter.svg' },
		],
	})
}

// Git and file writes per test: more than the 5 s default on a busy CI runner.
describe('the build map in a chat (MCP Apps, phase 4)', { timeout: 30_000 }, () => {
	it('builds the page for a chat: no token, and the session says it is the app', () => {
		const html = buildMapApp({ version: '9.9.9', writable: () => true, cwd: tempDir() }).page()
		const session = JSON.parse(/id="session">([^<]*)</.exec(html)?.[1] ?? '{}')
		expect(session).toMatchObject({ token: null, app: { version: '9.9.9' } })
		expect(html).toMatch(/<script nonce="[\w-]{20,}">/)
	})

	it('without the author’s map server: draws the state file, says so, and answers “unchanged” until it changes', async () => {
		const home = await project()
		const app = buildMapApp({ version: '1.0.0', writable: () => true, cwd: home })
		const first = (await app.view()) as { etag: string; snapshot: Record<string, any> }
		expect(first.snapshot).toMatchObject({
			home,
			app: { facts: false, writable: true },
			routes: {},
			reviews: {},
		})
		expect(Object.keys(first.snapshot.view.nodes)).toHaveLength(56)
		expect(await app.view(undefined, first.etag)).toEqual({ etag: first.etag, unchanged: true })
		await offerIcons(home)
		const next = (await app.view(undefined, first.etag)) as { etag: string; snapshot: Record<string, any> }
		expect(next.etag).not.toBe(first.etag)
		expect(next.snapshot.reviews[ICONS]).toMatchObject({ status: 'waiting', round: 1 })
	})

	it('while the author’s map server runs: passes its snapshot on, with the address previews open at', async () => {
		const home = await project()
		const url = await runningMap(home, { account: { signedIn: false } })
		const app = buildMapApp({ version: '1.0.0', writable: () => false, cwd: home })
		const { snapshot } = (await app.view()) as { snapshot: Record<string, unknown> }
		expect(snapshot).toMatchObject({
			protocol: 6,
			account: { signedIn: false },
			app: { facts: true, url, writable: false },
		})
	})

	it('takes the author’s pick or another round as the map server does, and refuses an answer to replaced variants', async () => {
		const home = await project()
		await offerIcons(home)
		const app = buildMapApp({ version: '1.0.0', writable: () => true, cwd: home })
		expect(
			await app.answer(undefined, 'review', { node: ICONS, round: 1, revision: 2, choice: '2' }),
		).toMatchObject({
			ok: false,
			status: 409,
			error: 'stale',
		})
		expect(
			await app.answer(undefined, 'review', { node: ICONS, round: 1, revision: 1, redo: 'Bolder' }),
		).toEqual({
			ok: true,
		})
		await offerIcons(home)
		expect(await app.answer(undefined, 'review', { node: ICONS, round: 2, choice: '2' })).toEqual({
			ok: true,
		})
		const { state } = await readMapState(home)
		expect(state.reviews[ICONS]).toMatchObject({ status: 'picked', choice: '2', via: 'map', round: 2 })
		expect(state.reviews[ICONS].history[0]).toMatchObject({ round: 1, feedback: 'Bolder' })
		expect(state.evidence[ICONS][0]).toMatchObject({ basis: 'author', who: 'you' })
	})

	it('takes a mark and a skip, refuses a page that is behind, and a malformed answer', async () => {
		const home = await project()
		const app = buildMapApp({ version: '1.0.0', writable: () => true, cwd: home })
		const confirmable = BUILD_NODES.find((node) => node.todos[0]?.confirm)
		const skippable = BUILD_NODES.find((node) => node.skip && !node.credits)
		if (!confirmable || !skippable) throw new Error('the graph has no confirmable or skippable step')
		expect(
			await app.answer(undefined, 'confirm', { node: confirmable.id, task: 0, done: true, note: ' ' }),
		).toEqual({
			ok: true,
		})
		expect(
			await app.answer(undefined, 'confirm', { node: confirmable.id, task: 0, done: true }),
		).toMatchObject({
			status: 409,
			error: 'out_of_order',
		})
		expect(await app.answer(undefined, 'route', { node: skippable.id, how: 'skip', since: null })).toEqual({
			ok: true,
		})
		expect(
			await app.answer(undefined, 'route', { node: skippable.id, how: null, since: null }),
		).toMatchObject({
			status: 409,
			error: 'stale',
		})
		expect(await app.answer(undefined, 'route', { node: skippable.id, how: 'later' })).toMatchObject({
			status: 400,
			error: 'bad_request',
		})
		const { state } = await readMapState(home)
		expect(state.nodes[confirmable.id]).toMatchObject({ ti: 1 })
		expect(state.evidence[confirmable.id][0].note).toBeUndefined()
		expect(state.routes[skippable.id]).toMatchObject({ how: 'skip' })
	})

	it('answers only a client that shows apps: anything else is an agent, which records chat answers instead', async () => {
		const home = await project()
		await offerIcons(home)
		const app = buildMapApp({ version: '1.0.0', writable: () => false, cwd: home })
		expect(await app.answer(undefined, 'review', { node: ICONS, round: 1, choice: '1' })).toMatchObject({
			ok: false,
			status: 403,
			error: 'not_an_app',
		})
		expect((await readMapState(home)).state.reviews[ICONS].status).toBe('waiting')
	})

	it('sends a variant’s image as a data: URL, and nothing for a page or an unknown variant', async () => {
		const home = await project()
		await offerIcons(home)
		const app = buildMapApp({ version: '1.0.0', writable: () => true, cwd: home })
		const image = await app.file(undefined, { step: ICONS, round: 1, variant: '2', which: 'image' })
		expect(image.src).toBe(
			`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
		)
		expect(await app.file(undefined, { step: ICONS, round: 1, variant: '1', which: 'preview' })).toEqual({})
		expect(await app.file(undefined, { step: ICONS, round: 3, variant: '2', which: 'image' })).toEqual({})
	})

	it('registers the page and three tools only the page may call, outside the agent’s tools', async () => {
		const tools: { name: string; _meta?: { ui?: { visibility?: string[] } }; annotations?: object }[] = []
		const resources: { uri: string; mimeType?: string; load: () => Promise<unknown> }[] = []
		registerBuildMapApp(
			{
				addTool: (tool: never) => tools.push(tool),
				addResource: (resource: never) => resources.push(resource),
			} as never,
			buildMapApp({ version: '1.0.0', writable: () => true, cwd: tempDir() }),
		)
		expect(tools.map((tool) => tool.name)).toEqual([...BUILD_MAP_APP_TOOLS])
		for (const tool of tools) {
			expect(tool._meta?.ui?.visibility, tool.name).toEqual(['app'])
			expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: expect.any(Boolean) })
		}
		expect(resources).toHaveLength(1)
		expect(resources[0]).toMatchObject({ uri: BUILD_MAP_UI, mimeType: MCP_APP_MIME })
		expect(await resources[0].load()).toMatchObject({
			mimeType: MCP_APP_MIME,
			text: expect.stringContaining('Extension Build Map'),
			_meta: { ui: { prefersBorder: true } },
		})
	})

	it('show_build_map links the page, opens a step, and is an agent tool where the server has the files', async () => {
		const home = await project()
		await offerIcons(home)
		const added: {
			name: string
			_meta?: unknown
			execute: (args: unknown, ctx: unknown) => Promise<string>
		}[] = []
		registerTools({ addTool: (tool: never) => added.push(tool) } as never, {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set(['docs']),
			getBff: () => ({}) as never,
			buildMap: buildMapAgent(home),
		})
		const show = added.find((tool) => tool.name === 'show_build_map')
		expect(show?._meta).toEqual({ ui: { resourceUri: BUILD_MAP_UI } })
		const shown = JSON.parse((await show?.execute({ step: ICONS }, {})) ?? '{}')
		expect(shown).toMatchObject({
			facts: false,
			step: { id: ICONS, byAuthor: true, review: { status: 'waiting', round: 1 } },
		})
		await expect(show?.execute({ step: 'nope' }, {})).rejects.toThrow(/unknown_step/)
	})

	it('tells a client that shows apps from one that does not', () => {
		expect(clientShowsApps({ extensions: { [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME] } } })).toBe(
			true,
		)
		expect(clientShowsApps({ extensions: { [MCP_APPS_EXTENSION]: {} } })).toBe(false)
		expect(clientShowsApps({ experimental: {} })).toBe(false)
		expect(clientShowsApps(null)).toBe(false)
	})
})
