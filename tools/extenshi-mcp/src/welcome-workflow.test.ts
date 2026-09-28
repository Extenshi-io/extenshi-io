import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildWelcomeAgentBrief, WELCOME_GOAL_PRESETS } from './welcome-agent-brief.js'
import { CONSTRUCTOR_URL, renderWelcomeWorkflow } from './welcome-workflow.js'

describe('synced copy of welcome-agent-brief', () => {
	// Gate on the shared-types workspace being present, NOT on the file itself.
	// shared-types is absent when this package is extracted standalone (the npm
	// tarball, and the isolated copy mirror-mcp.yml builds), so there the test
	// skips — reported as a skip rather than passing vacuously. Inside the
	// monorepo it always runs, so renaming or moving welcome-agent-brief.ts fails
	// here instead of silently retiring the guard.
	const sharedTypes = new URL('../../../shared-types/package.json', import.meta.url)
	const inMonorepo = fs.existsSync(sharedTypes)

	it.skipIf(!inMonorepo)('is byte-identical to the canonical shared-types file', () => {
		const canonical = new URL('../../../shared-types/welcome-agent-brief.ts', import.meta.url)
		const copy = new URL('./welcome-agent-brief.ts', import.meta.url)
		expect(fs.readFileSync(copy, 'utf8')).toBe(fs.readFileSync(canonical, 'utf8'))
	})
})

describe('renderWelcomeWorkflow', () => {
	it('defaults to the pin-the-extension goal for an unknown or missing goal', () => {
		for (const goal of [undefined, 'NONSENSE', '']) {
			const out = renderWelcomeWorkflow({ extensionName: 'Study Timer', goal })
			expect(out).toContain(WELCOME_GOAL_PRESETS.PIN_EXTENSION.label)
			// The pin flow's first illustration is the toolbar puzzle icon.
			expect(out).toContain('puzzle')
		}
	})

	it('honours an explicit goal instead of the default', () => {
		const out = renderWelcomeWorkflow({ extensionName: 'New Tab Pro', goal: 'NEW_TAB_OPT_IN' })
		expect(out).toContain(WELCOME_GOAL_PRESETS.NEW_TAB_OPT_IN.label)
		expect(out).not.toContain(WELCOME_GOAL_PRESETS.PIN_EXTENSION.label)
	})

	it('flags the missing target site as an open question when VISIT_SITE has none', () => {
		const out = renderWelcomeWorkflow({ extensionName: 'YT Transcriber', goal: 'VISIT_SITE' })
		expect(out).toMatch(/open question for the developer/i)
	})

	it('uses the supplied target site when given one', () => {
		const out = renderWelcomeWorkflow({
			extensionName: 'YT Transcriber',
			goal: 'VISIT_SITE',
			targetSite: 'youtube.com',
		})
		expect(out).toContain('youtube.com')
		expect(out).not.toMatch(/open question for the developer/i)
	})

	it('offers hosted store screenshots as no-upload material', () => {
		const out = renderWelcomeWorkflow({
			extensionName: 'Study Timer',
			storeScreenshots: ['https://s3.example.com/pipeline/screenshots/abc.png'],
		})
		expect(out).toContain('https://s3.example.com/pipeline/screenshots/abc.png')
		expect(out).toContain('"source": "store"')
	})

	it('always states the annotation contract and the block JSON shape', () => {
		const out = renderWelcomeWorkflow({ extensionName: 'Study Timer' })
		expect(out).toContain('kind: "number"')
		expect(out).toContain('kind: "arrow"')
		// Percentage coordinates are the part an agent most often gets wrong.
		expect(out).toMatch(/percentages/i)
		expect(out).toContain('"annotations"')
	})

	it('points the author at the constructor and explains hosting either way', () => {
		const out = renderWelcomeWorkflow({ extensionName: 'Study Timer' })
		expect(out).toContain(CONSTRUCTOR_URL)
		expect(out).toContain('welcome.extenshi.io')
		expect(out).toMatch(/host the page themselves/i)
	})

	it('is a pure function — same args produce identical output', () => {
		const args = { extensionName: 'Study Timer', goal: 'PIN_EXTENSION' }
		expect(renderWelcomeWorkflow(args)).toBe(renderWelcomeWorkflow(args))
	})
})

describe('buildWelcomeAgentBrief', () => {
	it('falls back to a generic sequence description for the CUSTOM goal', () => {
		const out = buildWelcomeAgentBrief({ extensionName: 'Thing', goal: 'CUSTOM' })
		expect(out).toMatch(/No preset applies/i)
	})

	it('names the extension, or a neutral placeholder when it is blank', () => {
		expect(buildWelcomeAgentBrief({ extensionName: 'Study Timer', goal: 'PIN_EXTENSION' })).toContain(
			'Study Timer',
		)
		expect(buildWelcomeAgentBrief({ extensionName: '  ', goal: 'PIN_EXTENSION' })).toContain('the extension')
	})

	it('echoes the accent colour so drawn art matches the page', () => {
		const out = buildWelcomeAgentBrief({
			extensionName: 'Thing',
			goal: 'PIN_EXTENSION',
			accentColor: '#ff0055',
		})
		expect(out).toContain('#ff0055')
	})

	it("keeps the author's existing steps rather than replacing them", () => {
		const out = buildWelcomeAgentBrief({
			extensionName: 'Thing',
			goal: 'PIN_EXTENSION',
			existingSteps: ['Open the options page', '   ', 'Set your timezone'],
		})
		expect(out).toContain('Open the options page')
		expect(out).toContain('Set your timezone')
		expect(out).toMatch(/wording and intent stay/i)
	})
})
