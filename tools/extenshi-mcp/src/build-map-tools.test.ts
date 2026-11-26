import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { deriveBuildMap, emptyBuildMapState } from '@extenshi/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import {
	MAP_CLIENT_HEADER,
	MAP_SERVER_FILE,
	MAP_TOKEN_HEADER,
	mapClient,
	mapPath,
	readMapState,
	updateMapState,
	writeJsonAtomic,
} from './build-map-store.js'
import { buildMapAgent } from './build-map-tools.js'
import { registerTools, type ToolDeps } from './tools.js'

const temps: string[] = []
const servers: http.Server[] = []
const ICONS = 'iconConcepts'

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mcp-build-map-tools-')))
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

/**
 * The author's map server as the CLI runs it: health, and the snapshot with the
 * view it derived. `health` adds to the health answer (the graph it draws, a
 * newer release); `hellos` collects the client headers health requests carry.
 */
async function runningMap(
	home: string,
	health: Record<string, unknown> = {},
	hellos: { token?: string; client?: string }[] = [],
): Promise<string> {
	const instance = 'instance-1'
	// An empty project: the steps before the icon concepts are not done, so they are locked.
	const view = deriveBuildMap(emptyBuildMapState(), { done: {} })
	const server = http.createServer((req, res) => {
		if (req.url === '/api/health')
			hellos.push({
				token: req.headers[MAP_TOKEN_HEADER] as string | undefined,
				client: req.headers[MAP_CLIENT_HEADER] as string | undefined,
			})
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(
			JSON.stringify(
				req.url === '/api/map'
					? { view, reviews: {} }
					: { instance, home, protocol: 6, version: 'test', clients: 1, ...health },
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

// Several git processes and file writes per test: more than the 5 s default on a busy CI runner.
describe('build map tools on the local server (phase 2)', { timeout: 30_000 }, () => {
	it('without the author’s map: offers variants, records the answer from the chat, and says what it could not check', async () => {
		const home = await project()
		const agent = buildMapAgent(home)
		const offered = (await agent.requestReview(undefined, {
			step: ICONS,
			agent: 'icons agent',
			variants: [
				{ label: 'Ruler', preview: 'concepts/ruler.html' },
				{ label: 'Letter', preview: 'concepts/letter.svg', image: 'concepts/letter.svg' },
			],
		})) as Record<string, unknown>
		expect(offered).toMatchObject({ step: ICONS, round: 1, note: expect.stringMatching(/not running/) })
		expect(offered.url).toBeUndefined()

		const map = (await agent.getMap()) as Record<string, any>
		expect(map).toMatchObject({ home, facts: 'files', note: expect.stringMatching(/not running/) })
		// Nobody asked the author yet: the answer opens with the offer, before the data caveats.
		expect(map.offer).toMatchObject({ offered: false, declined: false, offers: 0 })
		expect(Object.keys(map)[0]).toBe('offer')
		expect(map.offer.next).toMatch(/has not been asked about the build map.*Ask in this reply/)
		// `next` stays the steps that can start now.
		expect(Array.isArray(map.next)).toBe(true)
		expect(map.reviews[ICONS]).toMatchObject({
			status: 'waiting',
			round: 1,
			variants: [{ id: '1' }, { id: '2' }],
		})
		expect(map.steps[ICONS]).toMatchObject({
			current: 'Pick a concept',
			byAuthor: true,
			agent: 'icons agent',
		})

		const picked = (await agent.reportStep(undefined, {
			step: ICONS,
			agent: 'icons agent',
			choice: '2',
		})) as Record<string, any>
		expect(picked).toMatchObject({ status: 'picked', via: 'chat', choice: { id: '2', label: 'Letter' } })
		const done = (await agent.reportStep(undefined, {
			step: ICONS,
			agent: 'icons agent',
			files: ['concepts/letter.svg'],
		})) as Record<string, unknown>
		expect(done).toMatchObject({ tasksDone: 4, tasks: 4, checked: true, inputsChecked: false })
		// The answer names every task and whose it is; with all of them closed there is no current one.
		expect(done.todos).toEqual([
			{ task: 0, t: 'Read name, tagline and audience', by: 'agent', done: true },
			{ task: 1, t: 'Generate four concepts', by: 'agent', done: true },
			{ task: 2, t: 'Pick a concept', by: 'author', done: true },
			{ task: 3, t: 'Lock the concept for the set', by: 'agent', done: true },
		])
		expect(done.current).toBeUndefined()
		const { state } = await readMapState(home)
		expect(state.evidence[ICONS][0]).toMatchObject({ basis: 'agent', checked: true })
		expect(state.evidence[ICONS][1]).toMatchObject({ basis: 'author', who: 'icons agent' })
		await expect(
			agent.requestReview(undefined, {
				step: ICONS,
				agent: 'a',
				variants: [{ label: 'Elsewhere', preview: path.join(tempDir(), 'x.html') }],
			}),
		).rejects.toThrow(/no such file/)
	})

	it('without the author’s map: reads the project files itself, so a written extension is not sent back to the idea', async () => {
		const home = await project()
		writeFileSync(
			path.join(home, 'manifest.json'),
			JSON.stringify({
				manifest_version: 3,
				name: 'UTM Builder',
				version: '0.1.0',
				background: { service_worker: 'background.js' },
			}),
		)
		writeFileSync(path.join(home, 'background.js'), '')
		const map = (await buildMapAgent(home).getMap()) as Record<string, any>
		expect(map.facts).toBe('files')
		expect(map.steps.idea).toMatchObject({ status: 'done', basis: 'project' })
		expect(map.steps.bg).toMatchObject({ status: 'done', basis: 'project' })
		expect(map.next).not.toContain('idea')
		expect(map.next).toContain('perms')
		// The modules are the author's to confirm, whatever the files suggest.
		const features = map.needsYou.find((ask: { id: string }) => ask.id === 'features')
		expect(features).toMatchObject({ answer: 'map', label: 'Modules' })
		expect(features.options.map((option: { value: string }) => option.value)).toContain('features.analytics')
		expect(map.needsYouHow).toContain('one at a time')
		expect(map.modules.summary).toMatchObject({ confirmed: false })
	})

	it('records the author’s answer about a module; the author still confirms the set', async () => {
		const home = await project()
		const agent = buildMapAgent(home)
		const set = (await agent.setModule(undefined, {
			module: 'analytics',
			value: 'on',
			agent: 'planner',
			note: 'wants usage numbers',
		})) as Record<string, any>
		expect(set.module).toMatchObject({ id: 'analytics', on: true, source: 'author', unconfirmed: true })
		expect(set.module.data).toMatch(/consent/)
		const { state } = await readMapState(home)
		expect(state.settings.features).toEqual({ analytics: true })
		expect(state.evidence.features[0]).toMatchObject({
			basis: 'agent',
			who: 'planner',
			note: 'wants usage numbers',
		})
		const back = (await agent.setModule(undefined, {
			module: 'analytics',
			value: 'auto',
			agent: 'planner',
		})) as Record<string, any>
		expect(back.module).toMatchObject({ on: false, source: 'default' })
		await expect(
			agent.setModule(undefined, { module: 'telemetry', value: 'on', agent: 'planner' } as never),
		).rejects.toThrow(/unknown_setting/)
	})

	it('while the author’s map runs: answers with the module as it is after the write, not the map’s earlier view', async () => {
		const home = await project()
		// A map that reads the state file late: the first reads after the write still show the old view.
		let reads = 0
		const instance = 'instance-1'
		const server = http.createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' })
			if (req.url !== '/api/map') {
				res.end(JSON.stringify({ instance, home, protocol: 6, version: 'test', clients: 1 }))
				return
			}
			reads += 1
			void (async () => {
				const state = reads > 2 ? (await readMapState(home)).state : emptyBuildMapState()
				res.end(
					JSON.stringify({
						view: deriveBuildMap(state, { done: {} }),
						reviews: {},
						evidence: state.evidence,
					}),
				)
			})()
		})
		servers.push(server)
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const port = (server.address() as AddressInfo).port
		await writeJsonAtomic(mapPath(home, MAP_SERVER_FILE), {
			pid: process.pid,
			host: os.hostname(),
			port,
			url: `http://127.0.0.1:${port}/`,
			instance,
			token: 't',
			protocol: 6,
			version: 'test',
			home,
			startedAt: new Date().toISOString(),
		})
		const set = (await buildMapAgent(home).setModule(undefined, {
			module: 'analytics',
			value: 'on',
			agent: 'planner',
		})) as Record<string, any>
		expect(reads).toBeGreaterThan(2)
		expect(set.module).toMatchObject({ id: 'analytics', on: true, source: 'author' })
		expect(set.summary).toMatchObject({ confirmed: false })
	})

	it('while the author’s map runs: reads its view, links the step, and refuses a step whose inputs are not done', async () => {
		const home = await project()
		const url = await runningMap(home)
		const agent = buildMapAgent(home)
		const map = (await agent.getMap()) as Record<string, any>
		expect(map).toMatchObject({ facts: true, url })
		expect(map.note).toBeUndefined()
		expect(map.offer).toBeUndefined()
		await expect(
			agent.requestReview(undefined, {
				step: ICONS,
				agent: 'icons agent',
				variants: [{ label: 'Ruler', preview: 'concepts/ruler.html' }],
			}),
		).rejects.toThrow(/^"Icon concepts" waits on .* \(locked\)$/)
		await expect(agent.reportStep(undefined, { step: 'nope', agent: 'a' })).rejects.toThrow(
			/\(unknown_step\)$/,
		)
	})

	it('names the skills of the steps ahead, and of a step when an agent starts it', async () => {
		const home = await project()
		const agent = buildMapAgent(home)
		const url =
			'https://raw.githubusercontent.com/Extenshi-io/extenshi-io/main/plugins/extenshi/skills/extension-icon-design/SKILL.md'

		const map = (await agent.getMap()) as Record<string, any>
		expect(map.skills.how).toMatch(/before you work on it/)
		expect(map.skills.map).toMatchObject({ name: 'extension-build' })
		expect(map.skills.steps[ICONS]).toEqual(['extension-icon-design'])
		expect(map.skills.steps.cwsAccount).toBeUndefined()
		expect(map.skills.index['extension-icon-design']).toMatchObject({ url })

		const started = (await agent.reportStep(undefined, {
			step: ICONS,
			agent: 'icons agent',
			state: 'start',
		})) as Record<string, any>
		expect(started.skills).toEqual([
			{ name: 'extension-icon-design', teaches: expect.stringContaining('16 px'), url },
		])
		expect(started.skillsHow).toBe(map.skills.how)

		// A step that names no skill, and a report that is not a start, carry none.
		const plain = (await agent.reportStep(undefined, {
			step: 'cwsAccount',
			agent: 'main agent',
			state: 'start',
		})) as Record<string, any>
		expect(plain.skills).toBeUndefined()
		const stopped = (await agent.reportStep(undefined, {
			step: ICONS,
			agent: 'icons agent',
			state: 'stop',
		})) as Record<string, any>
		expect(stopped.skills).toBeUndefined()

		// A done step leaves the list: its instructions are no longer needed.
		expect(map.skills.steps.research).toEqual(['extension-market-research'])
		await updateMapState(home, (state) => ({
			...state,
			nodes: {
				...state.nodes,
				idea: { ti: 3, updatedAt: new Date().toISOString() },
				research: { ti: 3, updatedAt: new Date().toISOString() },
			},
		}))
		const later = (await agent.getMap()) as Record<string, any>
		expect(later.steps.research.status).toBe('done')
		expect(later.skills.steps.research).toBeUndefined()
	})

	it('tells the map which steps it knows, and says what to do when the map draws older ones', async () => {
		const home = await project()
		const hellos: { token?: string; client?: string }[] = []
		// A map from before graph revisions: its health carries no graph.
		await runningMap(home, { version: '0.45.0' }, hellos)
		const me = mapClient('mcp', '0.24.0')
		const agent = buildMapAgent(home, me)
		const map = (await agent.getMap()) as Record<string, any>
		expect(hellos.at(-1)).toEqual({ token: 't', client: `mcp/0.24.0 graph=${me.graph}` })
		expect(map.map).toEqual({ version: '0.45.0', graph: 0 })
		expect(map.update).toMatch(
			/older set of steps \(revision 0\) than this MCP server knows .* `npx @extenshi\/cli@latest map update` in the project/,
		)
		// Writes say it too: the difference explains a refusal for a step the map does not draw.
		const done = (await agent.reportStep(undefined, { step: 'idea', agent: 'a', state: 'start' })) as Record<
			string,
			unknown
		>
		expect(done.update).toBe(map.update)
	})

	it('names a newer release the author can update the map to, and stays quiet when nothing differs', async () => {
		const me = mapClient('mcp', '0.24.0')
		const newer = await project()
		await runningMap(newer, { version: '0.50.0', graph: me.graph, available: '0.51.0' })
		const map = (await buildMapAgent(newer, me).getMap()) as Record<string, any>
		expect(map.map).toEqual({ version: '0.50.0', graph: me.graph, available: '0.51.0' })
		expect(map.update).toMatch(/@extenshi\/cli 0\.51\.0 is out; .* press Update on the map/)
		// A newer release alone is not something a write needs to mention.
		const started = (await buildMapAgent(newer, me).reportStep(undefined, {
			step: 'idea',
			agent: 'a',
			state: 'start',
		})) as Record<string, unknown>
		expect(started.update).toBeUndefined()

		const same = await project()
		await runningMap(same, { version: '0.50.0', graph: me.graph })
		expect(((await buildMapAgent(same, me).getMap()) as Record<string, unknown>).update).toBeUndefined()
	})

	it('registers the three tools only where the server has the author’s files', () => {
		const names = (deps: Partial<ToolDeps>) => {
			const added: string[] = []
			const server = { addTool: (tool: { name: string }) => added.push(tool.name) }
			registerTools(server as unknown as Parameters<typeof registerTools>[0], {
				cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
				capabilities: new Set(['docs']),
				getBff: () => ({}) as never,
				...deps,
			})
			return added
		}
		const tools = ['get_build_map', 'report_build_step', 'request_build_review']
		expect(names({ buildMap: buildMapAgent(tempDir()) })).toEqual(expect.arrayContaining(tools))
		for (const tool of tools) expect(names({})).not.toContain(tool)
	})
})
