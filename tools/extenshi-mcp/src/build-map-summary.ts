/**
 * `buildMap` in the local server's create_project and get_project_state answers
 * (plan 2026-11-03-extension-build-map §6.7): whether the author's build map is
 * open, its address, and how offering it went. Read from the same home and the
 * same server record the CLI uses (build-map-store.ts, a copy of the CLI's), so
 * every agent, from any git worktree of the project, sees the one map there is.
 *
 * Local only. The hosted connector has no access to the author's files and
 * registers the tools without `readBuildMap`, so the field is absent there.
 * Reading never starts a server and never writes the state file.
 */

import { type MapClient, probeServer, readMapState, resolveMapHome } from './build-map-store.js'

export type BuildMapSummary = {
	/** A map server for this project answers on this machine. */
	running: boolean
	/** The page while it runs; `#node=<step>` opens one step. */
	url?: string
	/** The author has been asked about the map at least once. */
	offered: boolean
	/** The author's latest answer was no, and no map runs. */
	declined: boolean
	/** How many times the author answered the offer, yes or no. */
	offers: number
	/** The project directory whose `.extenshi/` holds the map: the main checkout when the given one is a linked git worktree. */
	home: string
	/** Why the state file could not be read, when it exists but could not. */
	problem?: string
	/**
	 * One sentence on where the offer stands and what comes next: ask (never asked), reopen (said yes, the
	 * server stopped), once more at the first visual choice (one no) or not again (two). Absent while a map runs.
	 */
	next?: string
}

type OfferRecord = { count: number; offeredAt?: string; acceptedAt?: string; declinedAt?: string }

/** How offering the map went, from the state file's `offer` record and whether a map server answers now. */
export function offerState(offer: OfferRecord, running: boolean) {
	const declinedAt = Date.parse(offer.declinedAt ?? '')
	const acceptedAt = Date.parse(offer.acceptedAt ?? '')
	return {
		offered: offer.count > 0 || Boolean(offer.offeredAt ?? offer.acceptedAt ?? offer.declinedAt),
		// A map the author opened after saying no (acceptedAt later, or a server up now) is not declined.
		declined: !running && Number.isFinite(declinedAt) && !(acceptedAt > declinedAt),
		offers: offer.count,
	}
}

/** The commands both answers are recorded with: a yes starts the map, a no only writes the answer. */
const OPEN = 'npx @extenshi/cli@latest map --no-open'
const DECLINE = 'npx @extenshi/cli@latest map decline'

/**
 * `next` for the build map: the step the offer is at, as one sentence (plan §6.7). An agent reads a project's
 * state at the start of a session, so the sentence for a project whose author was never asked is the offer
 * itself, worded so it reads as a step to take now rather than a fact about the data.
 */
export function buildMapNext(map: {
	running: boolean
	offered: boolean
	declined: boolean
	offers: number
	home: string
}): string | undefined {
	if (map.running) return undefined
	if (!map.offered)
		return (
			`The author has not been asked about the build map for ${map.home} yet. Ask in this reply: one yes/no ` +
			'question in the author’s language that ends the reply, separate from any list of next steps rather than one ' +
			'of them, saying the map is a local page that shows what is done, what is in progress and where their ' +
			`choice is needed. On a yes, run \`${OPEN}\` in that directory yourself, then show_build_map (or give the ` +
			`address it prints); on a no, run ` +
			`\`${DECLINE}\`. The extension-build skill (get_skill) has the full wording. Pass projectDir when the ` +
			'extension lives in another directory.'
		)
	if (!map.declined)
		return (
			'The author said yes to the build map earlier; its server is not running now (it stops after an idle hour). ' +
			`\`${OPEN}\` in ${map.home} starts it again when the author is next needed, and an open tab reconnects by itself.`
		)
	if (map.offers < 2)
		return 'The author declined the build map once. It comes up once more, in one sentence, at the first visual choice (usually the icon).'
	return 'The author declined the build map twice; it is not offered again in this project.'
}

/** `client` tells a running map which release and graph revision this MCP server knows. */
export async function readBuildMapSummary(dir: string, client?: MapClient): Promise<BuildMapSummary> {
	const where = await resolveMapHome(dir)
	const [read, server] = await Promise.all([readMapState(where.home), probeServer(where.home, client)])
	const running = Boolean(server)
	const offer = offerState(read.state.offer, running)
	// An unreadable state file says nothing reliable about the offer, so it gets no step of its own.
	const next = read.problem ? undefined : buildMapNext({ running, ...offer, home: where.home })
	return {
		...(next ? { next } : {}),
		running,
		...(server ? { url: server.url } : {}),
		...offer,
		home: where.home,
		...(read.problem ? { problem: read.problem } : {}),
	}
}
