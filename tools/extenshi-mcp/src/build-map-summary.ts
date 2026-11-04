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

import { probeServer, readMapState, resolveMapHome } from './build-map-store.js'

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
}

export async function readBuildMapSummary(dir: string): Promise<BuildMapSummary> {
	const where = await resolveMapHome(dir)
	const [read, server] = await Promise.all([readMapState(where.home), probeServer(where.home)])
	const { offer } = read.state
	const declinedAt = Date.parse(offer.declinedAt ?? '')
	const acceptedAt = Date.parse(offer.acceptedAt ?? '')
	return {
		running: Boolean(server),
		...(server ? { url: server.url } : {}),
		offered: offer.count > 0 || Boolean(offer.offeredAt ?? offer.acceptedAt ?? offer.declinedAt),
		// A map the author opened after saying no (acceptedAt later, or a server up now) is not declined.
		declined: !server && Number.isFinite(declinedAt) && !(acceptedAt > declinedAt),
		offers: offer.count,
		home: where.home,
		...(read.problem ? { problem: read.problem } : {}),
	}
}
