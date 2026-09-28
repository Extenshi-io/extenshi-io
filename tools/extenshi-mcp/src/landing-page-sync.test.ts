import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The published package cannot import workspace shared-types, so it ships
 * copies of the landing-page builder and its JSON-LD helper. Gate on the
 * shared-types workspace being present (not on the files): standalone
 * extractions of this package skip, while inside the monorepo a moved or
 * renamed canonical file fails here instead of silently retiring the guard.
 * To resync, run the commands in the header of shared-types/landing-page.ts.
 */
const sharedTypes = new URL('../../../shared-types/package.json', import.meta.url)
const inMonorepo = fs.existsSync(sharedTypes)
const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('synced copies of the shared-types landing-page builder', () => {
	it.skipIf(!inMonorepo)('json-ld.ts is byte-identical to shared-types/json-ld.ts', () => {
		expect(read('./json-ld.ts')).toBe(read('../../../shared-types/json-ld.ts'))
	})

	it.skipIf(!inMonorepo)('landing-page.ts differs only in the json-ld import specifier', () => {
		const canonical = read('../../../shared-types/landing-page.ts')
		expect(canonical).toContain("from 'shared-types/json-ld.js'")
		const expected = canonical
			.split('\n')
			.map((line) => (line.startsWith('import') ? line.replace('shared-types/', './') : line))
			.join('\n')
		expect(read('./landing-page.ts')).toBe(expected)
	})
})
