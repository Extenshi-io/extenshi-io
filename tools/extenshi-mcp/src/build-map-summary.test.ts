import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
	MAP_SERVER_FILE,
	MAP_STATE_FILE,
	mapPath,
	updateMapState,
	writeJsonAtomic,
} from './build-map-store.js'
import { readBuildMapSummary } from './build-map-summary.js'

const temps: string[] = []
const servers: http.Server[] = []

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mcp-build-map-')))
	temps.push(dir)
	return dir
}

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
		cwd,
		stdio: 'pipe',
	})

/** A map server as the CLI records and answers it: health carries the recorded instance and home. */
async function fakeServer(home: string, instance = 'instance-1'): Promise<string> {
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ instance, home, protocol: 1, version: 'test', clients: 0 }))
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
		protocol: 1,
		version: 'test',
		home,
		startedAt: new Date().toISOString(),
	})
	return url
}

describe('readBuildMapSummary', () => {
	it('a project with no map yet: not running, never offered', async () => {
		const dir = tempDir()
		expect(await readBuildMapSummary(dir)).toEqual({
			running: false,
			offered: false,
			declined: false,
			offers: 0,
			home: dir,
		})
	})

	it('reads a decline the CLI recorded, and a later yes overrides it', async () => {
		const dir = tempDir()
		await updateMapState(dir, (state) => ({
			...state,
			offer: { count: 1, declinedAt: '2026-11-03T10:00:00.000Z' },
		}))
		expect(await readBuildMapSummary(dir)).toMatchObject({ offered: true, declined: true, offers: 1 })
		await updateMapState(dir, (state) => ({
			...state,
			offer: { ...state.offer, count: 2, acceptedAt: '2026-11-03T11:00:00.000Z' },
		}))
		expect(await readBuildMapSummary(dir)).toMatchObject({ offered: true, declined: false, offers: 2 })
	})

	it('a running map is reported with its address, and is not declined', async () => {
		const dir = tempDir()
		await updateMapState(dir, (state) => ({
			...state,
			offer: { count: 1, declinedAt: '2026-11-03T10:00:00.000Z' },
		}))
		const url = await fakeServer(dir)
		expect(await readBuildMapSummary(dir)).toMatchObject({ running: true, url, declined: false })
	})

	it('a record whose server answers as another instance reads as not running', async () => {
		const dir = tempDir()
		await fakeServer(dir)
		const record = mapPath(dir, MAP_SERVER_FILE)
		const recorded = JSON.parse(readFileSync(record, 'utf8'))
		await writeJsonAtomic(record, { ...recorded, instance: 'someone-else' })
		const summary = await readBuildMapSummary(dir)
		expect(summary.running).toBe(false)
		expect(summary.url).toBeUndefined()
	})

	it('every git worktree of the project sees the map of the main checkout', async () => {
		const root = tempDir()
		const main = path.join(root, 'main')
		mkdirSync(path.join(main, 'ext'), { recursive: true })
		writeFileSync(path.join(main, 'ext', 'README.md'), 'x')
		git(main, 'init', '-q', '-b', 'main')
		git(main, 'add', '.')
		git(main, 'commit', '-q', '-m', 'init')
		const worktree = path.join(root, 'wt')
		git(main, 'worktree', 'add', '-q', '-b', 'agent-1', worktree)
		const home = path.join(main, 'ext')
		const url = await fakeServer(home)
		expect(await readBuildMapSummary(path.join(worktree, 'ext'))).toMatchObject({ running: true, url, home })
		expect(await readBuildMapSummary(home)).toMatchObject({ running: true, url, home })
	})

	it('names a state file it cannot read instead of failing', async () => {
		const dir = tempDir()
		mkdirSync(path.join(dir, '.extenshi'))
		writeFileSync(mapPath(dir, MAP_STATE_FILE), '{ not json')
		const summary = await readBuildMapSummary(dir)
		expect(summary).toMatchObject({ running: false, offered: false })
		expect(summary.problem).toContain(MAP_STATE_FILE)
	})
})
