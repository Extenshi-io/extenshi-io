import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PinGuideKitError } from './pin-guide-kit.js'
import { renderPinGuide } from './pin-guide-tool.js'

describe('synced copies of the pin guide generator', () => {
	// Same gate as welcome-workflow.test.ts: shared-types is absent when this
	// package is extracted standalone (npm tarball, mirror-mcp.yml), so there the
	// test skips; inside the monorepo it always runs.
	const sharedTypes = new URL('../../../shared-types/package.json', import.meta.url)
	const inMonorepo = fs.existsSync(sharedTypes)

	for (const file of ['pin-guide.ts', 'pin-guide-strings.ts', 'pin-guide-kit.ts']) {
		it.skipIf(!inMonorepo)(`${file} matches the canonical shared-types file`, () => {
			const canonical = fs.readFileSync(new URL(`../../../shared-types/${file}`, import.meta.url), 'utf8')
			const copy = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
			// The only difference allowed is the import specifier (see pin-guide-strings.ts).
			expect(copy).toBe(canonical.replaceAll("from 'shared-types/", "from './"))
		})
	}
})

describe('renderPinGuide', () => {
	it('defaults to a proportionate overview (policy 5B)', () => {
		const out = renderPinGuide({ extensionName: 'Tab Keeper', iconHref: '../icons/icon-48.png' })
		expect(out.length).toBeLessThanOrEqual(6_000)
		expect(out).toContain('# Pin guide kit for "Tab Keeper"')
		expect(out).toContain('pinGuideChrome1Title')
		expect(out).toContain(
			"npx @extenshi/cli pin-guide --name 'Tab Keeper' --icon-href '../icons/icon-48.png'",
		)
		// Overview only: no SVG payload in the default response.
		expect(out).not.toContain('<svg')
	})

	it('returns each part on request, narrowed by browser and language', () => {
		const html = renderPinGuide({ extensionName: 'Tab Keeper', part: 'html', browsers: ['edge'] })
		expect(html.match(/<section /g)).toHaveLength(1)
		expect(html).toContain('data-pin-guide-browser="edge"')

		const messages = JSON.parse(
			renderPinGuide({ extensionName: 'Tab Keeper', part: 'messages', locales: ['pt-BR'] }),
		)
		expect(Object.keys(messages)).toEqual(['en', 'pt_BR'])
		expect(messages.pt_BR.pinGuideFirefox3Title.message).toContain('Fixar na barra de ferramentas')

		expect(renderPinGuide({ extensionName: 'x', part: 'script' })).toContain(
			'export async function isPinnedToToolbar',
		)
		expect(renderPinGuide({ extensionName: 'x', part: 'css', theme: 'auto' })).toContain(
			'prefers-color-scheme',
		)
	})

	it('reports unusable input as an authored error', () => {
		expect(() => renderPinGuide({ extensionName: 'x', iconHref: 'https://cdn.example/i.png' })).toThrow(
			PinGuideKitError,
		)
		expect(() => renderPinGuide({ extensionName: 'x', locales: ['pl'] })).toThrow(/No pin guide captions/)
	})
})
