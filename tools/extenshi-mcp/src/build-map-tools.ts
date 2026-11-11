/**
 * The agent side of the build map on the local (stdio) server (plan
 * 2026-11-03-extension-build-map §6.4, phase 2): get_build_map,
 * report_build_step and request_build_review, and show_build_map, which draws
 * the map in the conversation of a client that shows MCP Apps (build-map-app.ts
 * serves the page and the tools it calls). Same writes as the CLI's
 * `extenshi map step|review|choose` (build-map-agent.ts, a copy of the CLI's),
 * to the same state file, so the author's open map shows them within a second.
 *
 * The project facts (manifest, icons, builds, the bound Dojo project) are read
 * by the CLI. While the author's map runs, its server has them, and these tools
 * check writes against its view. Without it they still write, but nothing is
 * refused for a step whose inputs are not done, and get_build_map says that
 * steps proven only by files look not done.
 *
 * Every call tells the running map which release and graph revision this MCP
 * server knows (probeServer with `client`). When the two differ, the answer
 * carries `update`: one sentence on what to do — switch the map to the newer
 * steps, or restart this server on the latest @extenshi/mcp. get_build_map
 * also says which release the map runs (`map`), and `update` names a newer
 * @extenshi/cli on npm that the author can press Update for.
 *
 * Local only: the hosted connector has no access to the author's files and
 * registers none of these tools.
 */

import path from 'node:path'
import {
	type BuildMapView,
	type BuildNodeView,
	type BuildReview,
	BuildStepError,
	buildNodeById,
	deriveBuildMap,
} from '@extenshi/contracts'
import {
	answerReview,
	mapUpdateNote,
	openReview,
	reportStep,
	reviewAnswer,
	serverSnapshot,
	stepUrl,
	type VariantInput,
} from './build-map-agent.js'
import {
	type MapClient,
	mapSkew,
	type RunningServer,
	readMapState,
	resolveMapHome,
} from './build-map-store.js'

export type BuildStepInput = {
	step: string
	agent: string
	state?: 'start' | 'progress' | 'done' | 'stop'
	task?: number
	progress?: number
	claim?: string
	note?: string
	files?: string[]
	urls?: string[]
	choice?: string
	redo?: string
	round?: number
}

export type BuildReviewInput = { step: string; agent: string; variants: VariantInput[] }

export type BuildMapAgent = {
	getMap(projectDir?: string): Promise<unknown>
	/** What the model gets back when the map is drawn in the chat: where it stands, and the step it opens. */
	showMap(projectDir?: string, step?: string): Promise<unknown>
	reportStep(projectDir: string | undefined, input: BuildStepInput): Promise<unknown>
	requestReview(projectDir: string | undefined, input: BuildReviewInput): Promise<unknown>
}

const NOT_RUNNING =
	'The author’s map is not running, so steps only the project files prove look not done here, and nothing was refused for inputs that are not done. `npx @extenshi/cli map status --json` reads the files.'

/** A refusal reads as one sentence with its reason code; anything else passes through. */
function refusal(error: unknown): never {
	if (error instanceof BuildStepError) throw new Error(`${error.message} (${error.code})`)
	throw error
}

function reviewsOf(reviews: Record<string, BuildReview>) {
	return Object.fromEntries(
		Object.entries(reviews).map(([id, review]) => [
			id,
			{ ...reviewAnswer(id, review), variants: review.variants },
		]),
	)
}

/** Every step this extension needs: status, the task it is on, who works on it. */
function stepsOf(nodes: Record<string, BuildNodeView>) {
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
					},
				]
			}),
	)
}

function summary(view: BuildMapView) {
	return {
		progress: { done: view.done, active: view.active, percent: view.percent },
		needsYou: view.needsYou,
		running: view.running.map((id) => ({ id, agent: view.nodes[id]?.agent })),
		next: view.next,
		byHand: view.byHand,
	}
}

/**
 * `client`: this MCP server as the map sees it (mapClient('mcp', version));
 * without it the tools do not tell the map who asks and say nothing about versions.
 */
export function buildMapAgent(cwd: string = process.cwd(), client?: MapClient): BuildMapAgent {
	const place = async (projectDir?: string) => {
		const dir = path.resolve(cwd, projectDir ?? '.')
		const where = await resolveMapHome(dir)
		const running = await serverSnapshot(where.home, client)
		return { dir, home: where.home, running }
	}
	/** On a write: only a difference in steps between the map and this server, which explains a refusal. */
	const skewNote = (server: RunningServer | undefined) =>
		server && client && mapSkew(server, client) ? mapUpdateNote(server, client) : undefined
	return {
		async getMap(projectDir) {
			const { home, running } = await place(projectDir)
			if (running) {
				const snapshot = running.snapshot as { view: BuildMapView; reviews?: Record<string, BuildReview> }
				const { server } = running
				const update = client ? mapUpdateNote(server, client) : undefined
				return {
					home,
					url: running.url,
					/** The @extenshi/cli release the author's map runs and the graph revision it draws. */
					map: {
						version: server.version,
						graph: server.graph,
						...(server.available ? { available: server.available } : {}),
					},
					...(update ? { update } : {}),
					facts: true,
					...summary(snapshot.view),
					reviews: reviewsOf(snapshot.reviews ?? {}),
					steps: stepsOf(snapshot.view.nodes),
				}
			}
			const read = await readMapState(home)
			const view = deriveBuildMap(read.state, { done: {} })
			return {
				home,
				facts: false,
				note: NOT_RUNNING,
				...summary(view),
				reviews: reviewsOf(read.state.reviews),
				steps: stepsOf(view.nodes),
				...(read.problem ? { problem: read.problem } : {}),
			}
		},

		async showMap(projectDir, step) {
			const map = (await this.getMap(projectDir)) as {
				home: string
				facts: boolean
				url?: string
				note?: string
				progress: unknown
				needsYou: string[]
				steps: Record<string, unknown>
				reviews: Record<string, unknown>
			}
			if (step && !buildNodeById(step)) throw new Error(`There is no build step "${step}". (unknown_step)`)
			return {
				home: map.home,
				facts: map.facts,
				...(map.url ? { url: step ? stepUrl(map.url, step) : map.url } : {}),
				progress: map.progress,
				needsYou: map.needsYou,
				...(step
					? {
							step: {
								id: step,
								...((map.steps[step] as object | undefined) ?? { status: 'inactive' }),
								...(map.reviews[step] ? { review: map.reviews[step] } : {}),
							},
						}
					: {}),
				shown:
					'In a client that shows MCP Apps the author sees the map in the conversation and can answer there; read their answer with get_build_map. Elsewhere, give the author the url, or the command `npx @extenshi/cli map`.',
				...(map.note ? { note: map.note } : {}),
			}
		},

		async reportStep(projectDir, input) {
			const { dir, home, running } = await place(projectDir)
			const view = running?.snapshot.view
			if (input.choice !== undefined || input.redo !== undefined) {
				const review = await answerReview(
					home,
					{
						node: input.step,
						agent: input.agent,
						...(input.choice !== undefined ? { choice: input.choice } : {}),
						...(input.redo !== undefined ? { redo: input.redo } : {}),
						...(input.round !== undefined ? { round: input.round } : {}),
					},
					view,
				).catch(refusal)
				const update = skewNote(running?.server)
				return {
					...reviewAnswer(input.step, review),
					...(running ? { url: stepUrl(running.url, input.step) } : {}),
					...(update ? { update } : {}),
				}
			}
			const result = await reportStep(
				home,
				dir,
				{
					node: input.step,
					state: input.state ?? 'done',
					agent: input.agent,
					...(input.task !== undefined ? { task: input.task } : {}),
					...(input.progress !== undefined ? { progress: input.progress } : {}),
					...(input.claim ? { claim: input.claim } : {}),
					...(input.note ? { note: input.note } : {}),
					...(input.files?.length ? { files: input.files } : {}),
					...(input.urls?.length ? { urls: input.urls } : {}),
				},
				view,
			).catch(refusal)
			const step = buildNodeById(input.step)
			const update = skewNote(running?.server)
			return {
				step: input.step,
				tasksDone: result.record?.ti ?? 0,
				tasks: step?.todos.length ?? 0,
				checked: result.checked,
				inputsChecked: Boolean(view),
				...(view ? {} : { note: NOT_RUNNING }),
				...(update ? { update } : {}),
			}
		},

		async requestReview(projectDir, input) {
			const { dir, home, running } = await place(projectDir)
			const review = await openReview(
				home,
				dir,
				{ node: input.step, agent: input.agent, variants: input.variants },
				running?.snapshot.view,
			).catch(refusal)
			const update = skewNote(running?.server)
			return {
				step: input.step,
				round: review.round,
				variants: review.variants,
				...(update ? { update } : {}),
				...(running
					? { url: stepUrl(running.url, input.step) }
					: {
							note: 'The author’s map is not running: show the author the previews in the chat, then record the answer with report_build_step (choice or redo).',
						}),
			}
		},
	}
}
