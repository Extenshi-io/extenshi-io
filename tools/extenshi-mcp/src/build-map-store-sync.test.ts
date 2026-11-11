import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * One map per project is enforced by where the map lives and how its server is
 * found (plan 2026-11-03-extension-build-map §6.1.1). The CLI and this server
 * must agree on both, or an agent reading `buildMap` here would look at another
 * map than the one the author has open. The published package cannot import the
 * CLI, so it ships a copy of its module. Gate on the CLI workspace being present
 * (not on the file): standalone extractions of this package skip, while inside
 * the monorepo a moved or renamed canonical file fails here instead of silently
 * retiring the guard. To resync, copy tools/extenshi-cli/src/build-map-store.ts,
 * build-map-agent.ts (the agent's writes: step reports, review rounds and
 * answers, phase 2) and build-map-page.ts (the page, which this server draws in
 * a chat that shows MCP Apps, phase 4) over the files of the same name here.
 */
const cliPackage = new URL('../../extenshi-cli/package.json', import.meta.url)
const inMonorepo = fs.existsSync(cliPackage)
const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('synced copies of the CLI build-map modules', () => {
	it.skipIf(!inMonorepo)('build-map-store.ts is byte-identical to the CLI module', () => {
		expect(read('./build-map-store.ts')).toBe(read('../../extenshi-cli/src/build-map-store.ts'))
	})

	it.skipIf(!inMonorepo)('build-map-agent.ts is byte-identical to the CLI module', () => {
		expect(read('./build-map-agent.ts')).toBe(read('../../extenshi-cli/src/build-map-agent.ts'))
	})

	it.skipIf(!inMonorepo)('build-map-page.ts is byte-identical to the CLI module', () => {
		expect(read('./build-map-page.ts')).toBe(read('../../extenshi-cli/src/build-map-page.ts'))
	})
})
