/**
 * The build map in a chat (plan 2026-11-03-extension-build-map §6.6, phase 4):
 * MCP Apps (2026-01-26) on the local (stdio) server.
 *
 * show_build_map (tools.ts) links to the page `ui://extenshi/build-map`, the
 * same page `extenshi map` serves (build-map-page.ts, a byte-identical copy of
 * the CLI's) built with `app`. A client that shows apps draws it in the
 * conversation; the page then talks to the host, which calls three tools on
 * this server for it, tools the host keeps from the model (`visibility: app`):
 *
 *   - build_map_view: the snapshot the page draws. While the author's map server
 *     runs, its snapshot as it is (the project facts are read by the CLI only);
 *     otherwise one derived from the state file, which says it has no facts.
 *   - build_map_answer: the author's answers, the same three writes the map
 *     server takes from its page (a mark, a route, a pick or another round),
 *     to the same state file under the same lock, checked the same way.
 *   - build_map_file: a variant's thumbnail as a data: URL, since the page in a
 *     chat may show data: images only (the default MCP Apps CSP).
 *
 * The answers are the author's (`via: 'map'`, who `you`), so build_map_answer
 * refuses unless the client said it shows apps, and index.ts removes all three
 * tools from a client that did not: a client that ignores `visibility` would
 * otherwise list them to the model.
 *
 * Local only: the hosted connector has no access to the author's files and
 * registers none of this.
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
	answerBuildReview,
	BUILD_EVIDENCE_NOTE_MAX,
	BUILD_REVIEW_FEEDBACK_MAX,
	BUILD_ROUTE_TEXT_MAX,
	BuildConfirmError,
	BuildRouteError,
	BuildStepError,
	confirmBuildTask,
	deriveBuildMap,
	setBuildRoute,
} from '@extenshi/contracts'
import type { FastMCP, ResourceResult } from 'fastmcp'
import { z } from 'zod'
import { reviewFileOnDisk, serverSnapshot } from './build-map-agent.js'
import { buildMapPage } from './build-map-page.js'
import { MAP_PROTOCOL, readMapState, resolveMapHome, updateMapState } from './build-map-store.js'
import { BUILD_MAP_UI, MCP_APP_MIME } from './build-map-ui.js'

/** A thumbnail larger than this shows as its number. */
export const THUMB_MAX_BYTES = 512 * 1024

const noteField = z
	.string()
	.max(BUILD_EVIDENCE_NOTE_MAX * 4)
	.optional()
	.transform((note) => (note?.trim() ? note : undefined))
const nodeField = z.string().min(1).max(64)

/** The bodies the map server's /api/confirm, /api/route and /api/review take (build-map-server.ts). */
const ANSWERS = {
	confirm: z.object({ node: nodeField, task: z.number().int().min(0), done: z.boolean(), note: noteField }),
	route: z.object({
		node: nodeField,
		how: z.enum(['self', 'skip']).nullable(),
		value: z
			.string()
			.max(BUILD_ROUTE_TEXT_MAX * 2)
			.optional(),
		since: z.string().nullable().optional(),
		note: noteField,
	}),
	review: z.object({
		node: nodeField,
		round: z.number().int().min(1),
		revision: z.number().int().min(1).optional(),
		choice: z.string().min(1).max(16).optional(),
		redo: z
			.string()
			.min(1)
			.max(BUILD_REVIEW_FEEDBACK_MAX * 2)
			.optional(),
	}),
} as const

export type BuildMapAnswerKind = keyof typeof ANSWERS

/** Like the map server's answer: ok, or the HTTP status it would send and why. */
export type BuildMapAnswerResult =
	| { ok: true }
	| { ok: false; status: number; error: string; message: string }

export type BuildMapFileRef = { step: string; round: number; variant: string; which: 'image' | 'preview' }

export type BuildMapApp = {
	/** The page, built for a chat. */
	page(): string
	/** The snapshot to draw; `unchanged` when it is the one `since` names. */
	view(
		projectDir?: string,
		since?: string,
	): Promise<{ etag: string; unchanged: true } | { etag: string; snapshot: Record<string, unknown> }>
	answer(
		projectDir: string | undefined,
		kind: BuildMapAnswerKind,
		body: unknown,
	): Promise<BuildMapAnswerResult>
	/** A variant's image as a data: URL, when it is an image the map may show. */
	file(projectDir: string | undefined, ref: BuildMapFileRef): Promise<{ src?: string }>
}

const refused = (status: number, error: string, message: string): BuildMapAnswerResult => ({
	ok: false,
	status,
	error,
	message,
})

/** The snapshot without the time it was made, which changes on every read. */
function etagOf(snapshot: Record<string, unknown>): string {
	const { generatedAt: _generatedAt, ...rest } = snapshot
	return createHash('sha256').update(JSON.stringify(rest)).digest('base64url').slice(0, 22)
}

export function buildMapApp(options: {
	version: string
	/** Whether the client shows apps, so the page's answers are the author's. */
	writable: () => boolean
	cwd?: string
}): BuildMapApp {
	const cwd = options.cwd ?? process.cwd()
	const homeOf = async (projectDir?: string) =>
		(await resolveMapHome(path.resolve(cwd, projectDir ?? '.'))).home

	return {
		page() {
			return buildMapPage({ nonce: randomBytes(16).toString('base64url'), app: { version: options.version } })
		},

		async view(projectDir, since) {
			const home = await homeOf(projectDir)
			const writable = options.writable()
			const running = await serverSnapshot(home)
			let snapshot: Record<string, unknown>
			if (running) snapshot = { ...running.snapshot, app: { facts: true, url: running.url, writable } }
			else {
				const read = await readMapState(home)
				const { state } = read
				snapshot = {
					protocol: MAP_PROTOCOL,
					home,
					project: { name: path.basename(home) },
					checkouts: 1,
					view: deriveBuildMap(state, { done: {} }),
					reviews: state.reviews,
					log: state.log,
					evidence: state.evidence,
					routes: state.routes,
					offer: state.offer,
					...(read.problem ? { problem: read.problem } : {}),
					generatedAt: new Date().toISOString(),
					app: { facts: false, writable },
				}
			}
			const etag = etagOf(snapshot)
			return since === etag ? { etag, unchanged: true } : { etag, snapshot }
		},

		async answer(projectDir, kind, body) {
			if (!options.writable())
				return refused(
					403,
					'not_an_app',
					'Only the build map drawn in a chat that shows MCP Apps answers here. An agent records the author’s answer from the chat with report_build_step.',
				)
			const schema = ANSWERS[kind]
			const parsed = schema?.safeParse(body)
			if (!parsed?.success) return refused(400, 'bad_request', `That is not a ${kind} answer the map takes.`)
			const home = await homeOf(projectDir)
			const at = new Date().toISOString()
			try {
				if (kind === 'confirm') {
					const change = parsed.data as z.infer<(typeof ANSWERS)['confirm']>
					await updateMapState(home, (state) => confirmBuildTask(state, { ...change, at }))
				} else if (kind === 'route') {
					const change = parsed.data as z.infer<(typeof ANSWERS)['route']>
					// The credits the author's map server knows: "did it myself" opens once the free ones are spent.
					const account = (await serverSnapshot(home))?.snapshot.account as
						| { signedIn?: boolean; credits?: Parameters<typeof setBuildRoute>[1]['credits'] }
						| undefined
					const credits = account?.signedIn ? account.credits : undefined
					await updateMapState(home, (state) => setBuildRoute(state, { ...change, credits, at }))
				} else {
					const change = parsed.data as z.infer<(typeof ANSWERS)['review']>
					// The view the page showed: a changed pick sends the steps built from the old one back to run again.
					const view = (await serverSnapshot(home))?.snapshot.view
					await updateMapState(home, (state) => answerBuildReview(state, view, { ...change, via: 'map', at }))
				}
			} catch (error) {
				if (error instanceof BuildConfirmError)
					return refused(error.code === 'out_of_order' ? 409 : 400, error.code, error.message)
				if (error instanceof BuildRouteError)
					return refused(
						error.code === 'stale' || error.code === 'credits' ? 409 : 400,
						error.code,
						error.message,
					)
				if (error instanceof BuildStepError)
					return refused(error.code === 'stale' ? 409 : 400, error.code, error.message)
				throw error
			}
			return { ok: true }
		},

		async file(projectDir, ref) {
			const home = await homeOf(projectDir)
			const { state } = await readMapState(home)
			const review = state.reviews[ref.step]
			const variants =
				review?.round === ref.round
					? review.variants
					: review?.history.find((round) => round.round === ref.round)?.variants
			const variant = variants?.find((candidate) => candidate.id === ref.variant)
			const stored = ref.which === 'image' ? variant?.image : variant?.preview
			const file = stored ? await reviewFileOnDisk(home, stored) : undefined
			if (!file || !file.type.startsWith('image/') || file.bytes > THUMB_MAX_BYTES) return {}
			return { src: `data:${file.type};base64,${(await readFile(file.file)).toString('base64')}` }
		},
	}
}

/**
 * The page resource and its three app-only tools. Not through registerTools:
 * they are not the agent's tools (no guide entry, no docs table), and the page
 * calls build_map_view every few seconds, which must not reach the usage events.
 */
export function registerBuildMapApp(server: FastMCP, app: BuildMapApp): void {
	// The page they belong to, and only the page may call them (MCP Apps visibility).
	const appOnly = { ui: { resourceUri: BUILD_MAP_UI, visibility: ['app'] } }
	const projectDir = z.string().min(1).optional()
	const json = (value: unknown) => JSON.stringify(value)
	server.addResource({
		uri: BUILD_MAP_UI,
		name: 'Extension Build Map',
		description: 'The author’s build map of the extension project, drawn in the conversation.',
		mimeType: MCP_APP_MIME,
		load: async () =>
			// _meta reaches the client as it is: no outside origins (the default CSP), and a border around the map.
			({
				text: app.page(),
				mimeType: MCP_APP_MIME,
				_meta: { ui: { prefersBorder: true } },
			}) as ResourceResult,
	})
	server.addTool({
		name: 'build_map_view',
		description: 'The build map page reads its snapshot. Called by the page only.',
		annotations: { title: 'Build map: read for the page', readOnlyHint: true, openWorldHint: false },
		_meta: appOnly,
		parameters: z.object({ projectDir, since: z.string().max(64).optional() }),
		execute: async (args) => json(await app.view(args.projectDir, args.since)),
	})
	server.addTool({
		name: 'build_map_answer',
		description:
			'The author answers on the build map page: marks a task, does a step themselves or skips it, picks a variant or asks for another round. Called by the page only, when the author clicks.',
		annotations: {
			title: 'Build map: the author’s answer',
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		_meta: appOnly,
		parameters: z.object({
			projectDir,
			kind: z.enum(['confirm', 'route', 'review']),
			body: z.record(z.string(), z.unknown()),
		}),
		execute: async (args) => json(await app.answer(args.projectDir, args.kind, args.body)),
	})
	server.addTool({
		name: 'build_map_file',
		description: 'The build map page loads a variant thumbnail. Called by the page only.',
		annotations: { title: 'Build map: a variant thumbnail', readOnlyHint: true, openWorldHint: false },
		_meta: appOnly,
		parameters: z.object({
			projectDir,
			step: z.string().min(1).max(64),
			round: z.number().int().min(1),
			variant: z.string().min(1).max(16),
			which: z.enum(['image', 'preview']),
		}),
		execute: async (args) => {
			const { projectDir: dir, ...ref } = args
			return json(await app.file(dir, ref))
		},
	})
}
