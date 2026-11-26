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
 * check writes against its view. Without it, get_build_map reads what the
 * project files prove itself (build-map-files.ts, a copy of the CLI's module;
 * `facts: 'files'`), without the records of `extenshi scan` and `extenshi
 * ai-visibility` or the live Dojo readiness; writes still go through, but
 * nothing is refused for a step whose inputs are not done.
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
	type BuildReview,
	BuildSettingError,
	BuildStepError,
	buildNodeById,
	deriveBuildMap,
} from '@extenshi/contracts'
import {
	answerReview,
	mapSkills,
	mapUpdateNote,
	modulesOf,
	NEEDS_YOU_HOW,
	needsYouOf,
	openReview,
	reportStep,
	reviewAnswer,
	SKILLS_HOW,
	serverSnapshot,
	setModule,
	skillsOfStep,
	stepsOf,
	stepTasks,
	stepUrl,
	type VariantInput,
} from './build-map-agent.js'
import { readFileFacts } from './build-map-files.js'
import {
	type MapClient,
	mapSkew,
	projectCheckouts,
	type RunningServer,
	readMapState,
	resolveMapHome,
} from './build-map-store.js'
import { buildMapNext, offerState } from './build-map-summary.js'

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

export type BuildModuleInput = { module: string; value: 'on' | 'off' | 'auto'; agent: string; note?: string }

export type BuildMapAgent = {
	getMap(projectDir?: string): Promise<unknown>
	/** What the model gets back when the map is drawn in the chat: where it stands, and the step it opens. */
	showMap(projectDir?: string, step?: string): Promise<unknown>
	reportStep(projectDir: string | undefined, input: BuildStepInput): Promise<unknown>
	requestReview(projectDir: string | undefined, input: BuildReviewInput): Promise<unknown>
	/** Record the author's answer about an optional module; the author confirms the set on the map. */
	setModule(projectDir: string | undefined, input: BuildModuleInput): Promise<unknown>
}

const NOT_RUNNING =
	'The author’s map is not running, so nothing was refused for inputs that are not done. The steps above are read from the project files on this computer; scans, AI visibility checks and Dojo release readiness count only while the map runs (`npx @extenshi/cli map status --json` reads them all).'

/** How long set_build_module waits for the running map to show its write; the map polls about once a second. */
const SNAPSHOT_WAIT_MS = 4_000

/** A refusal reads as one sentence with its reason code; anything else passes through. */
function refusal(error: unknown): never {
	if (error instanceof BuildStepError || error instanceof BuildSettingError)
		throw new Error(`${error.message} (${error.code})`)
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

function summary(view: BuildMapView, reviews: Record<string, BuildReview>, url?: string) {
	const needsYou = needsYouOf(view, reviews, url)
	const modules = modulesOf(view)
	return {
		progress: { done: view.done, active: view.active, percent: view.percent },
		/**
		 * What waits on the author, as questions: what each decides, the options with their current
		 * values, where it is answered (the map, Dojo, the chat) and the steps it holds up.
		 */
		needsYou,
		...(needsYou.length ? { needsYouHow: NEEDS_YOU_HOW } : {}),
		/** The optional modules: on or off, where that comes from, what each adds; and the set in numbers. */
		...(modules ? { modules } : {}),
		running: view.running.map((id) => ({ id, agent: view.nodes[id]?.agent })),
		next: view.next,
		byHand: view.byHand,
		/** Published skills with the instructions for the steps not done yet, and how to load them. */
		skills: mapSkills(view),
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
	/**
	 * Wait until the running map's snapshot has the module switch written at `at` (its entry in the
	 * evidence journal of the Modules step). Gives up after a few seconds; no map running: nothing to wait for.
	 */
	const shows = async (home: string, at: string) => {
		const until = Date.now() + SNAPSHOT_WAIT_MS
		for (;;) {
			const running = await serverSnapshot(home, client)
			const journal = (running?.snapshot.evidence ?? {}) as Record<string, { t?: string }[] | undefined>
			if (!running || journal.features?.some((entry) => entry.t === at) || Date.now() >= until) return
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
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
					...summary(snapshot.view, snapshot.reviews ?? {}, running.url),
					reviews: reviewsOf(snapshot.reviews ?? {}),
					steps: stepsOf(snapshot.view.nodes),
				}
			}
			const read = await readMapState(home)
			const facts = await readFileFacts(home, await projectCheckouts(home))
			const view = deriveBuildMap(read.state, facts)
			// No map runs: say first where offering it to the author stands, so a never-asked author is asked.
			// (`next` at the top level is the steps that can start now, so the sentence lives in `offer`.)
			const state = offerState(read.state.offer, false)
			const next = read.problem ? undefined : buildMapNext({ running: false, ...state, home })
			return {
				offer: { ...(next ? { next } : {}), ...state },
				home,
				facts: 'files',
				note: NOT_RUNNING,
				...summary(view, read.state.reviews),
				reviews: reviewsOf(read.state.reviews),
				steps: stepsOf(view.nodes),
				...(read.problem ? { problem: read.problem } : {}),
			}
		},

		async showMap(projectDir, step) {
			const map = (await this.getMap(projectDir)) as {
				home: string
				facts: boolean | 'files'
				url?: string
				note?: string
				progress: unknown
				needsYou: unknown[]
				needsYouHow?: string
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
				...(map.needsYouHow ? { needsYouHow: map.needsYouHow } : {}),
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
			// The moment an agent takes a step is when it needs the step's instructions.
			const skills = input.state === 'start' ? skillsOfStep(input.step) : []
			return {
				step: input.step,
				tasksDone: result.record?.ti ?? 0,
				tasks: step?.todos.length ?? 0,
				// What each task is and whose, and the one the step is on now.
				...stepTasks(input.step, result.record?.ti ?? 0),
				checked: result.checked,
				inputsChecked: Boolean(view),
				...(skills.length ? { skills, skillsHow: SKILLS_HOW } : {}),
				...(view ? {} : { note: NOT_RUNNING }),
				...(update ? { update } : {}),
			}
		},

		async setModule(projectDir, input) {
			const { home } = await place(projectDir)
			const setting = input.module.includes('.') ? input.module : `features.${input.module}`
			const at = await setModule(home, {
				setting,
				on: input.value === 'auto' ? null : input.value === 'on',
				agent: input.agent,
				...(input.note ? { note: input.note } : {}),
			}).catch(refusal)
			// A running map reads the state file about once a second: answer from its view only once
			// that view has this write, or the answer would be the module as it was before.
			if (at) await shows(home, at)
			// Read again: the running map's view when there is one, else what the files prove.
			const map = (await this.getMap(projectDir)) as {
				url?: string
				modules?: ReturnType<typeof modulesOf>
				needsYou: { id: string; link?: string }[]
			}
			const id = setting.split('.')[1]
			const step = buildNodeById('features')
			const waiting = map.needsYou.find((ask) => ask.id === step?.id)
			return {
				module: map.modules?.list.find((module) => module.id === id),
				...(map.modules ? { summary: map.modules.summary } : {}),
				...(waiting
					? {
							confirm: `The author confirms the modules on the map${waiting.link ? `: ${waiting.link}` : ' (show_build_map with step "features", or `npx @extenshi/cli map`)'}. The steps of a module start after that.`,
						}
					: {}),
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
