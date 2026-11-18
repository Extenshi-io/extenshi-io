import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILLS } from './generated/skills.js'
import {
	addSkillResources,
	attachSkillsExtension,
	getSkill,
	listSkills,
	SKILL_ENTRIES,
	SKILL_FILES,
	SKILLS_EXTENSION,
	skillSummaries,
	skillText,
	skillUri,
} from './skills.js'

describe('skill catalog (SEP-2640 entries)', () => {
	it('lists every bundled skill once, as a complete result', () => {
		const result = listSkills()
		expect(result.resultType).toBe('complete')
		expect(result.skills.map((s) => s.frontmatter.name)).toEqual(BUNDLED_SKILLS.map((s) => s.name))
		expect(new Set(result.skills.map((s) => s.uri)).size).toBe(result.skills.length)
		expect(result.skills.length).toBeGreaterThan(0)
	})

	it('ends each skill URI in the frontmatter name and SKILL.md', () => {
		for (const entry of SKILL_ENTRIES) {
			expect(entry.uri).toBe(`skill://${entry.frontmatter.name}/SKILL.md`)
			expect(typeof entry.frontmatter.description).toBe('string')
		}
	})

	it('lists every file of a skill with the digest and size of the bytes the resource serves', () => {
		const served = new Map(SKILL_FILES.map((file) => [file.uri, file.text]))
		for (const entry of SKILL_ENTRIES) {
			// Complete: the SKILL.md itself is one of the resources, each file exactly once.
			expect(entry.resources.filter((r) => r.uri === entry.uri)).toHaveLength(1)
			expect(new Set(entry.resources.map((r) => r.uri)).size).toBe(entry.resources.length)
			for (const resource of entry.resources) {
				const bytes = Buffer.from(served.get(resource.uri) as string, 'utf8')
				expect(resource.digest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
				expect(resource.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
				expect(resource.size).toBe(bytes.length)
			}
		}
		// No resource outside a listed skill.
		expect(SKILL_FILES).toHaveLength(SKILL_ENTRIES.reduce((n, e) => n + e.resources.length, 0))
	})

	it('stays inside the per-skill limits every host must accept', () => {
		for (const entry of SKILL_ENTRIES) {
			expect(entry.resources.length).toBeLessThanOrEqual(512)
			expect(entry.resources.reduce((n, r) => n + r.size, 0)).toBeLessThanOrEqual(16 * 1024 * 1024)
		}
	})
})

describe('skills/get', () => {
	it('returns the same entry the listing carries', () => {
		const first = SKILL_ENTRIES[0]
		expect(getSkill(first.uri)).toEqual({ resultType: 'complete', skill: first })
	})

	it('answers Invalid params (-32602) for anything that is not a skill of this server', () => {
		for (const uri of [
			'skill://no-such-skill/SKILL.md',
			`skill://${BUNDLED_SKILLS[0].name}`,
			undefined,
			42,
		]) {
			let code: unknown
			try {
				getSkill(uri)
			} catch (err) {
				code = (err as { code?: unknown }).code
			}
			expect(code).toBe(-32602)
		}
	})
})

describe('get_skill helpers', () => {
	it('returns SKILL.md as the skill:// resource serves it', () => {
		const name = BUNDLED_SKILLS[0].name
		expect(skillText(name)).toBe(SKILL_FILES.find((file) => file.uri === skillUri(name))?.text)
		expect(skillText('no-such-skill')).toBeUndefined()
	})

	it('summarises each skill on one line', () => {
		const summaries = skillSummaries()
		expect(summaries).toHaveLength(BUNDLED_SKILLS.length)
		for (const summary of summaries) {
			expect(summary.description).not.toMatch(/\n/)
			expect(summary.description.length).toBeGreaterThan(20)
		}
	})
})

describe('wiring into fastmcp', () => {
	it('registers one markdown resource per skill file', async () => {
		const added: { uri: string; mimeType: string; load: () => Promise<{ text: string }> }[] = []
		addSkillResources({ addResource: (resource) => void added.push(resource) })
		expect(added.map((r) => r.uri)).toEqual(SKILL_FILES.map((f) => f.uri))
		const skillMd = added.find((r) => r.uri === SKILL_ENTRIES[0].uri)
		expect(skillMd?.mimeType).toBe('text/markdown')
		expect((await skillMd?.load())?.text).toBe(skillText(BUNDLED_SKILLS[0].name))
	})

	it('declares the extension and both methods on a session before its transport connects', async () => {
		const calls: string[] = []
		const handlers = new Map<string, (request: { params?: { uri?: unknown } }) => unknown>()
		class Session {
			server = {
				registerCapabilities: (capabilities: Record<string, unknown>) => {
					calls.push(`capabilities:${JSON.stringify(capabilities)}`)
				},
				setRequestHandler: (
					schema: { shape: { method: { value: string } } },
					handler: (request: { params?: { uri?: unknown } }) => unknown,
				) => {
					calls.push(`handler:${schema.shape.method.value}`)
					handlers.set(schema.shape.method.value, handler)
				},
			}
			async connect(transport: string) {
				calls.push(`connect:${transport}`)
				return 'connected'
			}
		}
		attachSkillsExtension(Session)
		// A second call must not wrap connect again (both servers may share one fastmcp copy).
		attachSkillsExtension(Session)

		expect(await new Session().connect('stdio')).toBe('connected')
		expect(calls).toEqual([
			`capabilities:{"extensions":{"${SKILLS_EXTENSION}":{}}}`,
			'handler:skills/list',
			'handler:skills/get',
			'connect:stdio',
		])
		expect(handlers.get('skills/list')?.({})).toEqual(listSkills())
		expect(handlers.get('skills/get')?.({ params: { uri: SKILL_ENTRIES[0].uri } })).toEqual(
			getSkill(SKILL_ENTRIES[0].uri),
		)
	})
})
