import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The published package cannot import workspace shared-types, so it ships
 * copies of the landing-page builder, its schema-v2 sections module and the
 * JSON-LD helper. Gate on the shared-types workspace being present (not on
 * the files): standalone extractions of this package skip, while inside the
 * monorepo a moved or renamed canonical file fails here instead of silently
 * retiring the guard. To resync, run the commands in the header of
 * shared-types/landing-page.ts and shared-types/landing-sections.ts.
 */
const sharedTypes = new URL('../../../shared-types/package.json', import.meta.url)
const inMonorepo = fs.existsSync(sharedTypes)
const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

/** The only allowed difference: `from 'shared-types/x.js'` → `from './x.js'`. */
const vendored = (canonical: string) => canonical.replaceAll("from 'shared-types/", "from './")

describe('synced copies of the shared-types landing-page builder', () => {
	it.skipIf(!inMonorepo)('json-ld.ts is byte-identical to shared-types/json-ld.ts', () => {
		expect(read('./json-ld.ts')).toBe(read('../../../shared-types/json-ld.ts'))
	})

	for (const file of ['landing-page.ts', 'landing-sections.ts']) {
		it.skipIf(!inMonorepo)(`${file} differs only in its shared-types import specifiers`, () => {
			const canonical = read(`../../../shared-types/${file}`)
			expect(canonical).toContain("from 'shared-types/json-ld.js'")
			const copy = read(`./${file}`)
			expect(copy).not.toContain("from 'shared-types/")
			expect(copy).toBe(vendored(canonical))
		})
	}
})
