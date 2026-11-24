#!/usr/bin/env node
/**
 * SessionStart hook of the Extenshi plugin (Claude Code). In the repository of an
 * Extenshi extension project whose author has never been asked about the build
 * map, it adds one note to the new session: offer the map in the first reply
 * about the extension. Everywhere else it prints nothing.
 *
 * It reads two local files and runs `git rev-parse`; it sends nothing anywhere,
 * starts no server and does not run npx.
 *
 * Where the map lives mirrors the CLI (tools/extenshi-cli/src/build-map-store.ts
 * in the extenshi.io monorepo): `.extenshi/build-map.json` of the project
 * directory in the main checkout, which from a linked git worktree is the same
 * path inside the main working tree. The `offer` record there says whether the
 * author answered; no file means nobody asked.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Files that make a directory an Extenshi project: the integration config or a binding/map record. */
const MARKERS = ['src/extenshi.config.js', 'extenshi.config.js', '.extenshi/project.json', '.extenshi/build-map.json']

const isDirectory = (p) => {
	try {
		return statSync(p).isDirectory()
	} catch {
		return false
	}
}
const isFile = (p) => {
	try {
		return statSync(p).isFile()
	} catch {
		return false
	}
}

function readInput() {
	try {
		return JSON.parse(readFileSync(0, 'utf8') || '{}')
	} catch {
		return {}
	}
}

/** The project directory in the main checkout: `dir` itself unless it sits in a linked git worktree. */
function mapHome(dir) {
	let out
	try {
		out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], {
			cwd: dir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 2000,
		})
	} catch {
		return dir
	}
	const [top, common] = out.trim().split('\n')
	if (!top || !common || path.basename(common) !== '.git') return dir
	try {
		const mainRoot = realpathSync(path.dirname(common))
		const topReal = realpathSync(top)
		if (mainRoot === topReal) return dir
		const candidate = path.join(mainRoot, path.relative(topReal, dir))
		return isDirectory(candidate) ? candidate : dir
	} catch {
		return dir
	}
}

/** The `offer` record, `{ count: 0 }` when there is no state file, undefined when it cannot be read. */
function readOffer(home) {
	let text
	try {
		text = readFileSync(path.join(home, '.extenshi', 'build-map.json'), 'utf8')
	} catch (error) {
		return error?.code === 'ENOENT' ? { count: 0 } : undefined
	}
	try {
		const offer = JSON.parse(text)?.offer
		return offer && typeof offer === 'object' ? offer : { count: 0 }
	} catch {
		return undefined
	}
}

export function offerNote(cwd) {
	let dir
	try {
		dir = realpathSync(path.resolve(cwd))
	} catch {
		return undefined
	}
	const home = mapHome(dir)
	if (!MARKERS.some((marker) => isFile(path.join(dir, marker)) || isFile(path.join(home, marker)))) return undefined
	const offer = readOffer(home)
	if (!offer) return undefined
	const asked = Number(offer.count) > 0 || Boolean(offer.offeredAt || offer.acceptedAt || offer.declinedAt)
	if (asked) return undefined
	return (
		`Extenshi extension project (${home}): the author has never been asked about the build map, a local page ` +
		'that shows which build steps are done, which are in progress and which wait on the author. When this session ' +
		'works on the extension (building it, continuing, planning or recommending next steps), load the ' +
		'extension-build skill and end your first reply about the extension with the build-map offer as its own ' +
		'yes/no question in the author’s language, separate from any list of next steps. After a yes, run ' +
		`\`npx @extenshi/cli@latest map --no-open\` in ${home} yourself and show the map (show_build_map where it ` +
		'is available, otherwise the address the command prints); after a no, run ' +
		'`npx @extenshi/cli@latest map decline`. Ask once; the CLI records the answer for later sessions.'
	)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
	const input = readInput()
	const note = offerNote(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd())
	if (note)
		process.stdout.write(
			`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: note } })}\n`,
		)
}
