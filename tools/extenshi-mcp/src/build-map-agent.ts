/**
 * What an agent does on the build map (plan 2026-11-03-extension-build-map
 * §6.3–6.4, phase 2): report a step, offer the author variants to choose from,
 * record the author's answer from the chat, and wait for the author's answer.
 *
 * The CLI (`extenshi map step|review|choose|wait`) and the stdio MCP server
 * (`report_build_step`, `request_build_review`, `get_build_map`) both call
 * these. Every write goes through updateMapState, so it lands in the one map of
 * the project from whichever worktree the agent works in, and an open page shows
 * it within a second. The MCP server ships a byte-identical copy of this file
 * next to its copy of build-map-store.ts; build-map-store-sync.test.ts there
 * fails on any drift. Edit this file, then copy it over.
 *
 * Files an agent names are resolved here. Evidence files are hashed, so the
 * journal entry is `checked`. A variant's preview and image must be files of
 * the project, in the main checkout or any of its worktrees, or https
 * addresses. The map server serves those files only for a variant that names
 * them (reviewFileOnDisk), so naming a file elsewhere is refused up front.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
	answerBuildReview,
	BUILD_MAP_SKILL,
	type BuildAsk,
	type BuildEvidenceWhere,
	type BuildMapState,
	type BuildMapView,
	type BuildModulesSummary,
	type BuildModuleView,
	type BuildNodeRecord,
	type BuildNodeView,
	type BuildReview,
	type BuildStepReport,
	buildAsks,
	buildModulesSummary,
	buildNodeById,
	buildReviewLocationValid,
	buildSkillRef,
	buildStepSkills,
	openBuildReview,
	reportBuildStep,
	setBuildSetting,
} from '@extenshi/contracts'
import {
	type MapClient,
	mapSkew,
	probeServer,
	projectCheckouts,
	type RunningServer,
	readMapState,
	updateMapState,
} from './build-map-store.js'

/** The file types a variant's preview or image may be, with the type the map server answers with. */
export const REVIEW_FILE_TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
}
export const REVIEW_FILE_MAX_BYTES = 20 * 1024 * 1024
/** Evidence files bigger than this are refused rather than hashed for minutes. */
const EVIDENCE_FILE_MAX_BYTES = 64 * 1024 * 1024

const isHttps = (value: string) => /^https:\/\//i.test(value)
const hasScheme = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value)

function inside(root: string, file: string): boolean {
	const relative = path.relative(root, file)
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** The project directory in every checkout of the repository, resolved: the map home first. */
async function checkoutRoots(home: string): Promise<string[]> {
	const roots: string[] = []
	for (const dir of await projectCheckouts(home)) {
		try {
			const real = await realpath(dir)
			if (!roots.includes(real)) roots.push(real)
		} catch {
			// A worktree removed since git listed it.
		}
	}
	return roots.length ? roots : [home]
}

async function sha256Of(file: string): Promise<string> {
	const hash = createHash('sha256')
	for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
	return hash.digest('hex')
}

/**
 * Where a variant's preview or image is, as the state file keeps it: an https
 * address as given; a file relative to `home` when it is in the main checkout,
 * absolute when it is in another checkout of the project. Throws for anything
 * else, with what to do instead.
 */
export async function resolveReviewFile(home: string, from: string, value: string): Promise<string> {
	const given = value.trim()
	if (hasScheme(given)) {
		if (isHttps(given) && buildReviewLocationValid(given)) return given
		throw new Error(`${given}: a preview is a file of the project or an https address.`)
	}
	let real: string
	try {
		real = await realpath(path.resolve(from, given))
	} catch {
		throw new Error(`${given}: no such file.`)
	}
	const type = REVIEW_FILE_TYPES[path.extname(real).toLowerCase()]
	if (!type)
		throw new Error(
			`${given}: a preview is an HTML page or an image (${Object.keys(REVIEW_FILE_TYPES).join(', ')}).`,
		)
	const info = await stat(real)
	if (!info.isFile()) throw new Error(`${given}: not a file.`)
	if (info.size > REVIEW_FILE_MAX_BYTES)
		throw new Error(`${given}: larger than ${REVIEW_FILE_MAX_BYTES / 1024 / 1024} MB.`)
	if (inside(home, real)) return path.relative(home, real)
	// Asking git for the other checkouts costs a process or two: only for a file outside the main one.
	if ((await checkoutRoots(home)).some((root) => inside(root, real))) return real
	throw new Error(
		`${given}: outside the project, so the map will not serve it. Write the preview inside the project (any of its git worktrees works).`,
	)
}

/**
 * The file behind a variant's preview or image, if the map may serve it: it
 * is a file of a checkout of the project, of a type in REVIEW_FILE_TYPES, and
 * not too big. Checked again at every request, since files change.
 */
export async function reviewFileOnDisk(
	home: string,
	stored: string,
): Promise<{ file: string; type: string; bytes: number } | undefined> {
	if (!buildReviewLocationValid(stored) || hasScheme(stored)) return undefined
	try {
		const real = await realpath(path.isAbsolute(stored) ? stored : path.join(home, stored))
		const type = REVIEW_FILE_TYPES[path.extname(real).toLowerCase()]
		if (!type) return undefined
		const info = await stat(real)
		if (!info.isFile() || info.size > REVIEW_FILE_MAX_BYTES) return undefined
		if (!inside(home, real) && !(await checkoutRoots(home)).some((root) => inside(root, real)))
			return undefined
		return { file: real, type, bytes: info.size }
	} catch {
		return undefined
	}
}

/** Whether a directory between `home` and `file` has a `.git` of its own: a checkout nested in the main one. */
async function nestedCheckout(home: string, file: string): Promise<boolean> {
	for (let dir = path.dirname(file); inside(home, dir); dir = path.dirname(dir)) {
		try {
			await access(path.join(dir, '.git'))
			return true
		} catch {
			// not this one
		}
	}
	return false
}

/**
 * Where an evidence file is, as the journal keeps it: relative to the project
 * directory of the checkout that holds it. A file an agent wrote in a worktree
 * gets the path it has in the main checkout once the work is merged
 * (`src/manifest.json`, not `.claude/worktrees/<name>/src/manifest.json` or an
 * absolute path that is gone with the worktree). Only a file outside every
 * checkout of the project stays absolute.
 */
async function journalPath(home: string, real: string, roots: () => Promise<string[]>): Promise<string> {
	// Asking git for the checkouts costs a process or two: only for a file outside the
	// main checkout, or under a directory with a .git of its own (a worktree nested in it).
	if (inside(home, real) && !(await nestedCheckout(home, real))) return path.relative(home, real)
	const holder = (await roots()).filter((root) => inside(root, real)).sort((a, b) => b.length - a.length)[0]
	return holder ? path.relative(holder, real) : real
}

/**
 * Evidence files hashed, each where the journal keeps it (journalPath). Throws
 * for a file that is not there.
 */
export async function evidenceFiles(
	home: string,
	from: string,
	files: readonly string[],
): Promise<BuildEvidenceWhere[]> {
	const where: BuildEvidenceWhere[] = []
	let roots: Promise<string[]> | undefined
	const checkouts = () => {
		roots ??= checkoutRoots(home)
		return roots
	}
	for (const given of files) {
		const absolute = path.resolve(from, given)
		let info: Awaited<ReturnType<typeof stat>>
		try {
			info = await stat(absolute)
		} catch {
			throw new Error(`${given}: no such file.`)
		}
		if (!info.isFile()) throw new Error(`${given}: not a file.`)
		if (info.size > EVIDENCE_FILE_MAX_BYTES)
			throw new Error(
				`${given}: larger than ${EVIDENCE_FILE_MAX_BYTES / 1024 / 1024} MB; name a smaller file as proof.`,
			)
		const real = await realpath(absolute)
		where.push({ file: await journalPath(home, real, checkouts), sha256: await sha256Of(real) })
	}
	return where
}

/**
 * The map as the running map server derives it: with the project facts and
 * the bound Dojo project. Undefined when no server runs or it does not answer.
 * `client` tells the server which program asks (probeServer); `server` says
 * which release and graph revision the map runs.
 */
export async function serverSnapshot(
	home: string,
	client?: MapClient,
): Promise<
	| { url: string; server: RunningServer; snapshot: { view: BuildMapView } & Record<string, unknown> }
	| undefined
> {
	const server = await probeServer(home, client)
	if (!server) return undefined
	try {
		const response = await fetch(`http://127.0.0.1:${server.port}/api/map`, {
			signal: AbortSignal.timeout(3_000),
		})
		if (!response.ok) return undefined
		const snapshot = (await response.json()) as { view?: BuildMapView } & Record<string, unknown>
		return snapshot.view
			? { url: server.url, server, snapshot: snapshot as { view: BuildMapView } }
			: undefined
	} catch {
		return undefined
	}
}

/**
 * What an agent should know about the release the author's map runs, in one
 * sentence: the map draws older steps than the agent knows (switch it), newer
 * ones (update the agent's own tool), or a newer release is out. Undefined
 * when the two agree and nothing newer is known.
 */
export function mapUpdateNote(
	server: Pick<RunningServer, 'version' | 'graph' | 'available' | 'updating'>,
	client: MapClient,
): string | undefined {
	const tool = client.kind === 'cli' ? 'this CLI' : 'this MCP server'
	const switchIt =
		client.kind === 'cli' ? '`extenshi map update`' : '`npx @extenshi/cli@latest map update` in the project'
	if (server.updating)
		return `The map is restarting on @extenshi/cli ${server.updating}; the author's page reloads by itself.`
	const skew = mapSkew(server, client)
	if (skew === 'map_older' && client.graph > server.graph)
		return `The author's map draws an older set of steps (revision ${server.graph}) than ${tool} knows (revision ${client.graph}). Run ${switchIt} to restart it on the newer steps when no choice waits on the author; their progress stays.`
	if (skew === 'map_older')
		return `The author's map runs @extenshi/cli ${server.version}, older than this CLI (${client.version}). Run ${switchIt} to restart it on this release; the author's progress stays.`
	if (skew === 'client_older')
		return client.kind === 'cli'
			? `The author's map draws newer steps (revision ${server.graph}) than this CLI (revision ${client.graph}). Run the latest CLI: npx @extenshi/cli@latest map …`
			: `The author's map draws newer steps (revision ${server.graph}) than this MCP server (revision ${client.graph}). Restart the MCP server on the latest @extenshi/mcp so its checks match the map.`
	if (server.available)
		return `@extenshi/cli ${server.available} is out; the author's map runs ${server.version}. The author can press Update on the map, or run \`npx @extenshi/cli@latest map update\` in the project.`
	return undefined
}

/** The address that opens one step on the map. */
export const stepUrl = (url: string, node: string) => `${url.replace(/#.*$/, '')}#node=${node}`

/** A question waiting on the author, with the link that opens its step on the running map. */
export type MapAsk = BuildAsk & { link?: string }

/** What an agent does with `needsYou`; said wherever the list is given. */
export const NEEDS_YOU_HOW =
	'Each entry is a question for the author. Put every one to them in this same reply, one at a time: what it decides, the options with the current values, your recommendation, and the link. Never list step ids alone, and never answer for the author.'

/**
 * The steps waiting on the author as questions (`needsYou` of `map status
 * --json` and get_build_map): what each decides, the options and their current
 * values, where the author answers, and the steps it holds up. `url`: the
 * running map, for a link to each step.
 */
export function needsYouOf(
	view: BuildMapView,
	reviews: Record<string, BuildReview> = {},
	url?: string,
): MapAsk[] {
	return buildAsks(view, reviews).map((ask) => ({ ...ask, ...(url ? { link: stepUrl(url, ask.id) } : {}) }))
}

/**
 * The optional modules for `map status --json` and get_build_map: each with
 * its switch, where the value comes from and what it adds, and the set in
 * numbers. Undefined for a map that runs a release without them.
 */
export function modulesOf(
	view: BuildMapView,
): { summary: BuildModulesSummary; list: BuildModuleView[] } | undefined {
	const summary = buildModulesSummary(view)
	return summary && view.modules ? { summary, list: view.modules } : undefined
}

/**
 * Record the author's answer about a module from the chat: on, off, or back to
 * what the project suggests (`on: null`). The author confirms the set on the map.
 */
export async function setModule(
	home: string,
	input: { setting: string; on: boolean | null; agent: string; note?: string },
): Promise<string | undefined> {
	const at = new Date().toISOString()
	let before: BuildMapState | undefined
	const after = await updateMapState(home, (current) => {
		before = current
		return setBuildSetting(current, { ...input, via: 'chat', at })
	})
	return after === before ? undefined : at
}

/** A published skill as an agent is told about it: what it teaches and the file to download. */
export type StepSkill = { name: string; teaches: string; url: string }

/** How an agent uses the skills a step names; said wherever skills are listed. */
export const SKILLS_HOW =
	'Load the skills of a step before you work on it. Use the copy your client has installed when there is one (the Extenshi plugin ships them all); otherwise download the SKILL.md at `url` and follow it.'

/** The skills with the instructions for a step's work (the graph's `skills`), in the step's order. */
export function skillsOfStep(node: string): StepSkill[] {
	return buildStepSkills(node).map(({ name, teaches, url }) => ({ name, teaches, url }))
}

export type MapSkills = {
	how: string
	/** The skill for working on the map itself, whatever the step. */
	map?: StepSkill
	/** Step id → skill names, for every step this extension needs that is not done yet. */
	steps: Record<string, string[]>
	/** Skill name → what it teaches and the file to download, for the names in `steps`. */
	index: Record<string, { teaches: string; url: string }>
}

/**
 * The skills of the steps still ahead, for `map status --json` and
 * get_build_map: an agent choosing a step from `next` sees which instructions
 * to load first. Done and switched-off steps are left out.
 */
export function mapSkills(view: BuildMapView): MapSkills {
	const steps: MapSkills['steps'] = {}
	const index: MapSkills['index'] = {}
	for (const node of Object.values(view.nodes)) {
		if (node.status === 'inactive' || node.status === 'done') continue
		const skills = skillsOfStep(node.id)
		if (!skills.length) continue
		steps[node.id] = skills.map((skill) => skill.name)
		for (const { name, teaches, url } of skills) index[name] = { teaches, url }
	}
	const map = buildSkillRef(BUILD_MAP_SKILL)
	return {
		how: SKILLS_HOW,
		...(map ? { map: { name: map.name, teaches: map.teaches, url: map.url } } : {}),
		steps,
		index,
	}
}

/** One task of a step's checklist, as an agent reads it. */
export type StepTask = { task: number; t: string; by: 'author' | 'agent'; done: boolean }

/** The task a step is on, by its number and text; `byAuthor` when only the author does it. */
export type StepCurrent = { task: number; t: string; byAuthor?: true }

/**
 * A step's checklist with `ti` tasks closed: every task (whose it is, whether
 * it is closed) and the one the step is on. `map step` and report_build_step
 * answer with it, so an agent learns what task 1 is without reading the graph.
 */
export function stepTasks(id: string, ti: number): { todos: StepTask[]; current?: StepCurrent } {
	const todos = buildNodeById(id)?.todos ?? []
	const at = todos[ti]
	return {
		todos: todos.map((todo, task) => ({
			task,
			t: todo.t,
			by: todo.a === 'you' ? ('author' as const) : ('agent' as const),
			done: task < ti,
		})),
		...(at ? { current: { task: ti, t: at.t, ...(at.a === 'you' ? { byAuthor: true as const } : {}) } } : {}),
	}
}

/**
 * Every step this extension needs, for `map status --json` and get_build_map
 * alike (`steps`): its status, the task it is on and whose that is, who works
 * on it, a re-run, what a done step rests on, and where the owner decides it.
 */
export function stepsOf(nodes: Record<string, BuildNodeView>) {
	return Object.fromEntries(
		Object.values(nodes)
			.filter((node) => node.status !== 'inactive')
			.map((node) => {
				const todo = node.status === 'done' ? undefined : buildNodeById(node.id)?.todos[node.taskIndex]
				return [
					node.id,
					{
						status: node.status,
						...(todo
							? { task: node.taskIndex, current: todo.t, ...(todo.a === 'you' ? { byAuthor: true } : {}) }
							: {}),
						...(node.agent ? { agent: node.agent } : {}),
						...(node.redo ? { redo: true } : {}),
						...(node.basis ? { basis: node.basis } : {}),
						...(node.decide ? { decide: node.decide } : {}),
						...(node.waitsOn ? { waitsOn: node.waitsOn } : {}),
					},
				]
			}),
	)
}

export type StepInput = Omit<BuildStepReport, 'at' | 'where' | 'checked'> & {
	/** Files that show the task done: hashed, so the entry is checked. */
	files?: readonly string[]
	urls?: readonly string[]
	dojo?: readonly string[]
	command?: string
}

/**
 * Report on a step. `view` checks that the step's inputs are done; without it
 * (no project facts) nothing is refused for that. The entry is `checked` when
 * every proof is a file this call hashed.
 */
export async function reportStep(
	home: string,
	from: string,
	input: StepInput,
	view?: BuildMapView,
): Promise<{ record: BuildNodeRecord | undefined; checked: boolean }> {
	const hashed = await evidenceFiles(home, from, input.files ?? [])
	const where: BuildEvidenceWhere[] = [
		...hashed,
		...(input.urls ?? []).map((url) => ({ url })),
		...(input.dojo ?? []).map((dojo) => ({ dojo })),
		...(input.command ? [{ command: input.command }] : []),
	]
	const checked = hashed.length > 0 && hashed.length === where.length
	const { files: _files, urls: _urls, dojo: _dojo, command: _command, ...report } = input
	const state = await updateMapState(home, (current) =>
		reportBuildStep(current, view, { ...report, where, checked, at: new Date().toISOString() }),
	)
	return { record: state.nodes[input.node], checked }
}

export type VariantInput = { label: string; preview: string; image?: string }

/** Offer the author variants to choose from; files are resolved against `from`. */
export async function openReview(
	home: string,
	from: string,
	input: { node: string; agent: string; variants: readonly VariantInput[] },
	view?: BuildMapView,
): Promise<BuildReview> {
	const variants: VariantInput[] = []
	for (const variant of input.variants)
		variants.push({
			label: variant.label,
			preview: await resolveReviewFile(home, from, variant.preview),
			...(variant.image ? { image: await resolveReviewFile(home, from, variant.image) } : {}),
		})
	const state = await updateMapState(home, (current) =>
		openBuildReview(current, view, {
			node: input.node,
			agent: input.agent,
			variants,
			at: new Date().toISOString(),
		}),
	)
	return state.reviews[input.node]
}

/** Record the author's answer from the chat: the variant they picked, or what to change. */
export async function answerReview(
	home: string,
	input: { node: string; agent: string; choice?: string; redo?: string; round?: number },
	view?: BuildMapView,
): Promise<BuildReview> {
	const state = await updateMapState(home, (current) =>
		answerBuildReview(current, view, { ...input, via: 'chat', at: new Date().toISOString() }),
	)
	return state.reviews[input.node]
}

export type ReviewAnswer = {
	node: string
	round: number
	status: BuildReview['status']
	/** The variant picked. */
	choice?: { id: string; label: string; preview: string; image?: string }
	/** What to change, in the author's words. */
	feedback?: string
	via?: 'map' | 'chat'
}

export function reviewAnswer(node: string, review: BuildReview): ReviewAnswer {
	const choice = review.status === 'picked' ? review.variants.find((v) => v.id === review.choice) : undefined
	return {
		node,
		round: review.round,
		status: review.status,
		...(choice ? { choice } : {}),
		...(review.status === 'redo' && review.feedback ? { feedback: review.feedback } : {}),
		...(review.via && review.status !== 'waiting' ? { via: review.via } : {}),
	}
}

/**
 * Wait until the author answers the review of `node`, reading the state file
 * every `pollMs` (no map server needed). Resolves at once when it is answered
 * already; with `timeoutMs`, resolves with the review still waiting once that
 * passes.
 */
export async function waitForReview(
	home: string,
	node: string,
	options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {},
): Promise<ReviewAnswer> {
	const pollMs = options.pollMs ?? 1_000
	const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Number.POSITIVE_INFINITY
	for (;;) {
		const read = await readMapState(home)
		if (read.problem) throw new Error(`Cannot read the build map: ${read.problem}`)
		const review = read.state.reviews[node]
		if (!review) throw new Error(`No review is open on "${node}": open one with the variants first.`)
		if (review.status !== 'waiting' || Date.now() >= deadline || options.signal?.aborted)
			return reviewAnswer(node, review)
		await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))))
	}
}
