/**
 * Where the build map lives and how every client touches it (plan
 * 2026-11-03-extension-build-map §6.1).
 *
 * ONE MAP PER PROJECT, whoever asks. Agents often work on one extension in
 * parallel, each in its own git worktree, and `.extenshi/` is usually ignored by
 * git, so a per-checkout file would give every agent its own map and the author
 * one browser tab per agent. The map therefore lives in the MAIN checkout: from
 * a linked worktree, `resolveMapHome` maps the directory to the same path in the
 * main working tree. Every agent, from any worktree, reads and writes the same
 * `.extenshi/build-map.json` and finds the same server.
 *
 * Files under `<home>/.extenshi/`:
 *   build-map.json         the state (BuildMapState); written under build-map.lock
 *   build-map.lock/        held for one read-modify-write; stale after a crash is taken over
 *   build-map.server.json  the running server: pid, port, instance id, shutdown token (0600);
 *                          a stopped server leaves it with pid 0 so the next start reuses the port
 *   build-map.server.lock/ held while a server starts, so two starts cannot both listen
 *   build-map.log          output of the background server
 *
 * Writes go to a temporary file in the same directory and are renamed over the
 * target, so a reader never sees half a file.
 *
 * The stdio MCP server (`@extenshi/mcp`) is the map's other client and ships a
 * byte-identical copy at tools/extenshi-mcp/src/build-map-store.ts, so both find
 * the same home and the same server; build-map-store-sync.test.ts there fails on
 * any drift. Edit this file, then copy it over.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type BuildMapState, emptyBuildMapState, normalizeBuildMapState } from '@extenshi/contracts'

export const MAP_DIR = '.extenshi'
export const MAP_STATE_FILE = 'build-map.json'
export const MAP_SERVER_FILE = 'build-map.server.json'
export const MAP_LOG_FILE = 'build-map.log'
const STATE_LOCK = 'build-map.lock'
const SERVER_LOCK = 'build-map.server.lock'

/** Bumped when the page/server protocol changes: a newer CLI replaces an older server instead of reusing it. */
export const MAP_PROTOCOL = 1

export type MapHome = {
	/** Where the map's files live: this project directory in the main checkout. */
	home: string
	/** The directory the command ran in. */
	dir: string
	/** `dir` is inside a linked git worktree, and the map lives in the main checkout. */
	worktree: boolean
}

export const mapPath = (home: string, file: string) => path.join(home, MAP_DIR, file)

function git(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, timeout: 5_000, windowsHide: true }, (error, stdout) =>
			resolve(error ? undefined : stdout),
		)
	})
}

async function isDirectory(location: string): Promise<boolean> {
	try {
		return (await stat(location)).isDirectory()
	} catch {
		return false
	}
}

/**
 * The map home for `dir`: `dir` itself, unless it sits in a linked git worktree
 * whose main working tree has the same directory — then that one. Outside git,
 * in a bare-repository worktree or a submodule, the directory stays its own home.
 */
export async function resolveMapHome(dir: string): Promise<MapHome> {
	const real = await realpath(path.resolve(dir))
	const own: MapHome = { home: real, dir: real, worktree: false }
	const out = await git(real, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
	const [top, common] = (out ?? '').trim().split('\n')
	if (!top || !common || path.basename(common) !== '.git') return own
	let mainRoot: string
	let topReal: string
	try {
		mainRoot = await realpath(path.dirname(common))
		topReal = await realpath(top)
	} catch {
		return own
	}
	if (mainRoot === topReal) return own
	const candidate = path.join(mainRoot, path.relative(topReal, real))
	if (!(await isDirectory(candidate))) return own
	return { home: candidate, dir: real, worktree: true }
}

/** Every checkout of the repository `home` belongs to (main first), mapped to the project directory in each. */
export async function projectCheckouts(home: string): Promise<string[]> {
	const out = await git(home, ['worktree', 'list', '--porcelain'])
	const top = (await git(home, ['rev-parse', '--show-toplevel']))?.trim()
	if (!out || !top) return [home]
	const relative = path.relative(top, home)
	const roots = out
		.split('\n')
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length))
	const dirs = [home]
	for (const root of roots) {
		const candidate = path.join(root, relative)
		if (!dirs.includes(candidate) && (await isDirectory(candidate))) dirs.push(candidate)
	}
	return dirs
}

export function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type LockOwner = { pid: number; host: string; at: number; token: string }

async function readOwner(lockDir: string): Promise<LockOwner | undefined> {
	try {
		return JSON.parse(await readFile(path.join(lockDir, 'owner.json'), 'utf8'))
	} catch {
		return undefined // created a moment ago and not written yet, or a crash in between
	}
}

/**
 * Whether the lock as it is now may be taken over: its owner died on this
 * machine, or it is older than `staleMs` (the critical sections take
 * milliseconds). `undefined` when the lock is gone.
 */
async function lockIsStale(lockDir: string, staleMs: number): Promise<boolean | undefined> {
	const owner = await readOwner(lockDir)
	let age: number
	try {
		age = Date.now() - (owner?.at ?? (await stat(lockDir)).mtimeMs)
	} catch {
		return undefined
	}
	const dead = owner !== undefined && owner.host === os.hostname() && !pidAlive(owner.pid)
	return dead || age > staleMs
}

/**
 * Hold `<lockDir>.breaker` while removing `lockDir`. Every removal — a release
 * and a takeover alike — happens under it and re-checks the lock it is about to
 * remove, so a waiter that judged a dead owner's lock stale a moment ago cannot
 * delete the fresh lock another waiter has taken since. The breaker is held for
 * a few file operations; one older than 10 s belongs to a process that crashed
 * inside them.
 */
async function withBreaker(lockDir: string, deadline: number, remove: () => Promise<void>): Promise<void> {
	const breaker = `${lockDir}.breaker`
	for (;;) {
		try {
			await mkdir(breaker)
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
		}
		try {
			if (Date.now() - (await stat(breaker)).mtimeMs > 10_000)
				await rm(breaker, { recursive: true, force: true })
		} catch {
			// released while we looked
		}
		if (Date.now() > deadline)
			throw new Error(`${path.basename(breaker)} is held; remove it if no extenshi command runs.`)
		await sleep(2 + Math.floor(Math.random() * 8))
	}
	try {
		await remove()
	} finally {
		await rm(breaker, { recursive: true, force: true })
	}
}

/** Move the lock directory aside, then delete it: after the rename, `mkdir(lockDir)` is free again. */
async function removeLockDir(lockDir: string): Promise<void> {
	const aside = `${lockDir}.gone-${randomUUID()}`
	try {
		await rename(lockDir, aside)
	} catch {
		return // already gone
	}
	await rm(aside, { recursive: true, force: true })
}

/**
 * Run `work` holding a directory lock. `mkdir` is atomic, so exactly one
 * process creates the directory; its `owner.json` carries a random token. A
 * lock whose owner died on this machine, or that is older than `staleMs`, is
 * taken over — but the verdict is checked again under the breaker
 * (`withBreaker`) before anything is removed, and a release removes the lock
 * only while it still carries this holder's token.
 */
export async function withDirLock<T>(
	lockDir: string,
	work: () => Promise<T>,
	options: { timeoutMs?: number; staleMs?: number; what?: string } = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 10_000
	const staleMs = options.staleMs ?? 30_000
	const deadline = Date.now() + timeoutMs
	await mkdir(path.dirname(lockDir), { recursive: true })
	for (;;) {
		try {
			await mkdir(lockDir)
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
		}
		const stale = await lockIsStale(lockDir, staleMs)
		if (stale === undefined) continue // released while we looked
		if (stale) {
			await withBreaker(lockDir, deadline, async () => {
				if (await lockIsStale(lockDir, staleMs)) await removeLockDir(lockDir)
			})
			continue
		}
		if (Date.now() > deadline)
			throw new Error(
				`${options.what ?? path.basename(lockDir)} is held by process ${(await readOwner(lockDir))?.pid ?? 'unknown'}. ` +
					'If no extenshi command is running, remove the lock directory.',
			)
		await sleep(20 + Math.floor(Math.random() * 40))
	}
	const token = randomUUID()
	try {
		const owner: LockOwner = { pid: process.pid, host: os.hostname(), at: Date.now(), token }
		await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(owner))
		return await work()
	} finally {
		await withBreaker(lockDir, Date.now() + 15_000, async () => {
			if ((await readOwner(lockDir))?.token === token) await removeLockDir(lockDir)
		})
	}
}

/** Write JSON so a concurrent reader sees the old file or the new one, never a mix. */
export async function writeJsonAtomic(file: string, value: unknown, mode = 0o644): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true })
	const temporary = `${file}.${randomUUID()}.tmp`
	try {
		const handle = await open(temporary, 'wx', mode)
		try {
			await handle.writeFile(`${JSON.stringify(value, null, '\t')}\n`)
			await handle.sync()
		} finally {
			await handle.close()
		}
		await rename(temporary, file)
	} finally {
		await rm(temporary, { force: true })
	}
}

export type StateRead = { state: BuildMapState; exists: boolean; problem?: string }

/** Read the state for display: a missing or broken file reads as empty, with the problem named. */
export async function readMapState(home: string): Promise<StateRead> {
	let text: string
	try {
		text = await readFile(mapPath(home, MAP_STATE_FILE), 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return { state: emptyBuildMapState(), exists: false }
		return { state: emptyBuildMapState(), exists: true, problem: (error as Error).message }
	}
	try {
		return { state: normalizeBuildMapState(JSON.parse(text)), exists: true }
	} catch (error) {
		return {
			state: emptyBuildMapState(),
			exists: true,
			problem: `${MAP_STATE_FILE}: ${(error as Error).message}`,
		}
	}
}

/**
 * Read, change and write the state as one step, under the state lock, so two
 * agents reporting at the same moment both land. Refuses to write over a file
 * it cannot read rather than replace someone's edit with an empty map.
 */
export async function updateMapState(
	home: string,
	change: (state: BuildMapState) => BuildMapState | undefined,
): Promise<BuildMapState> {
	return withDirLock(
		mapPath(home, STATE_LOCK),
		async () => {
			const read = await readMapState(home)
			if (read.problem) throw new Error(`Cannot update the build map: ${read.problem}`)
			const next = change(read.state) ?? read.state
			await writeJsonAtomic(mapPath(home, MAP_STATE_FILE), next)
			return next
		},
		{ what: `${MAP_DIR}/${STATE_LOCK}` },
	)
}

export type MapServerRecord = {
	pid: number
	host: string
	port: number
	url: string
	/** Random per start: tells this server from another that later got the same pid or port. */
	instance: string
	/** Authorizes /api/shutdown; the file is readable by the owner only. */
	token: string
	protocol: number
	version: string
	home: string
	startedAt: string
}

export type MapHealth = { instance: string; home: string; protocol: number; version: string; clients: number }

export async function readServerRecord(home: string): Promise<MapServerRecord | undefined> {
	try {
		const record = JSON.parse(await readFile(mapPath(home, MAP_SERVER_FILE), 'utf8'))
		if (typeof record?.port !== 'number' || typeof record?.instance !== 'string') return undefined
		return record as MapServerRecord
	} catch {
		return undefined
	}
}

export async function fetchHealth(port: number, timeoutMs = 1_500): Promise<MapHealth | undefined> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (!response.ok) return undefined
		return (await response.json()) as MapHealth
	} catch {
		return undefined
	}
}

export type RunningServer = MapServerRecord & { clients: number }

/**
 * The server recorded for `home`, if it is really up: same machine, process
 * alive, and its health answer carries the recorded instance id and home. A
 * record left by a crash, by another machine (a synced folder) or a reused pid
 * reads as no server.
 */
export async function probeServer(home: string): Promise<RunningServer | undefined> {
	const record = await readServerRecord(home)
	if (!record || record.host !== os.hostname() || !pidAlive(record.pid)) return undefined
	const health = await fetchHealth(record.port)
	if (!health || health.instance !== record.instance || health.home !== home) return undefined
	return { ...record, clients: health.clients }
}

export const serverLockPath = (home: string) => mapPath(home, SERVER_LOCK)

/**
 * Mark the server record stopped, but only if it still names `instance` —
 * never a successor's. The port stays in it, so the next start binds the same
 * address and a tab left open reconnects by itself; pid 0 and no token make it
 * read as no server.
 */
export async function retireServerRecord(home: string, instance: string): Promise<void> {
	const record = await readServerRecord(home)
	if (record?.instance !== instance) return
	await writeJsonAtomic(
		mapPath(home, MAP_SERVER_FILE),
		{ ...record, pid: 0, token: '', stoppedAt: new Date().toISOString() },
		0o600,
	)
}
