import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	DEVELOPMENT_SERVICES,
	GUIDE_SECTIONS,
	type GuideSections,
	type GuideTool,
} from './development-guide.js'
import { type Capability, getServerInstructions, registerTools } from './tools.js'

vi.mock('./telemetry.js', async (original) => ({
	...(await original<typeof import('./telemetry.js')>()),
	captureEvent: vi.fn(),
	captureError: vi.fn(),
}))

interface RegisteredTool extends GuideTool {
	execute: (args: unknown, ctx: unknown) => Promise<string>
}

function register(capabilities: Capability[]) {
	const tools: RegisteredTool[] = []
	const getBff = vi.fn(() => {
		throw new Error('Guide must not access the account')
	})
	const requireApiKey = vi.fn(() => {
		throw new Error('Guide must not require credentials')
	})
	registerTools(
		{ addTool: (tool: RegisteredTool) => tools.push(tool) } as unknown as Parameters<typeof registerTools>[0],
		{
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set(capabilities),
			getBff,
			requireApiKey,
		},
	)
	return { tools, getBff, requireApiKey }
}

const repoRoot = resolve(__dirname, '../../..')
const inMonorepo = existsSync(resolve(repoRoot, 'shared-types/dev-projects.ts'))

async function callGuide(tools: RegisteredTool[], args: Record<string, unknown>): Promise<string> {
	const tool = tools.find((tool) => tool.name === 'get_development_guide')
	if (!tool) throw new Error('Development guide was not registered')
	return tool.execute(args, {})
}

async function readGuide(tools: RegisteredTool[]): Promise<GuideSections> {
	return JSON.parse(await callGuide(tools, { sections: ['all'] }))
}

afterEach(() => vi.unstubAllGlobals())

describe('development guide discovery contract', () => {
	it.each([['docs'], ['read', 'docs'], ['read', 'docs', 'scan', 'publish']] as Capability[][])(
		'reports exactly the registered tools for %j without account/network access',
		async (...capabilities) => {
			const fetch = vi.fn(() => {
				throw new Error('Guide must work offline')
			})
			vi.stubGlobal('fetch', fetch)
			const { tools, getBff, requireApiKey } = register(capabilities)
			const result = await readGuide(tools)
			expect(result.tools.map((tool: GuideTool) => tool.name)).toEqual(tools.map((tool) => tool.name))
			for (const action of result.localActions) {
				expect(action.availableInThisConnection).toBe(tools.some((tool) => tool.name === action.name))
				expect(action.fallback).toContain('npx @extenshi/cli@latest')
			}
			for (const service of result.services) {
				expect(
					service.toolsInThisConnection.every((name: string) => tools.some((tool) => tool.name === name)),
				).toBe(true)
			}
			expect(getBff).not.toHaveBeenCalled()
			expect(requireApiKey).not.toHaveBeenCalled()
			expect(fetch).not.toHaveBeenCalled()
		},
	)

	it('covers every registered tool in the service directory', () => {
		const { tools } = register(['read', 'docs', 'scan', 'publish'])
		const mapped = new Set(DEVELOPMENT_SERVICES.flatMap((service) => [...service.tools]))
		expect([...mapped].sort()).toEqual(tools.map((tool) => tool.name).sort())
	})

	it.skipIf(!inMonorepo)('covers cabinet tools with existing documentation and route targets', () => {
		const source = readFileSync(resolve(repoRoot, 'shared-types/dev-projects.ts'), 'utf8')
		const registry = source.split('export const DEV_PROJECT_TOOL_KEYS = [')[1].split('] as const')[0]
		const keys = [...registry.matchAll(/^\s*'([^']+)'/gm)].map((match) => match[1])
		expect(keys.length).toBeGreaterThan(0)
		const urls = DEVELOPMENT_SERVICES.flatMap((service) => [...service.urls])
		for (const key of keys) {
			expect(urls).toContain(`https://dojo.extenshi.io/tools/${key}`)
		}
		for (const url of urls) {
			const parsed = new URL(url)
			const workspace =
				parsed.hostname === 'docs.extenshi.io'
					? 'docs'
					: parsed.hostname === 'dojo.extenshi.io'
						? 'dojo'
						: null
			if (!workspace) continue
			const route = resolve(__dirname, '../../..', workspace, `src/app${parsed.pathname}`)
			expect(existsSync(`${route}/page.mdx`) || existsSync(`${route}/page.tsx`), url).toBe(true)
		}
	})

	it.skipIf(!inMonorepo)('keeps public reference tables complete as the registry grows', () => {
		const { tools } = register(['read', 'docs', 'scan', 'publish'])
		for (const file of ['docs/src/app/developers/mcp/page.mdx', 'tools/extenshi-mcp/README.md']) {
			const text = readFileSync(resolve(__dirname, '../../..', file), 'utf8')
			const documented = new Set([...text.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]))
			expect([...documented].sort(), file).toEqual(tools.map((tool) => tool.name).sort())
		}
	})

	it('preserves mutation hints and docs links in the discovery result', async () => {
		const { tools } = register(['read', 'docs'])
		const result = await readGuide(tools)
		expect(
			result.tools.find((tool: GuideTool) => tool.name === 'publish_privacy_policy')?.annotations
				.readOnlyHint,
		).toBe(false)
		for (const tool of result.tools) expect(tool.docs.length, tool.name).toBeGreaterThan(0)
		expect(result.workflow.at(-1)?.id).toBe('operate')
		expect(result.repository.recommendation).toContain('GitHub')
	})

	it('defaults to a compact overview with the tool inventory and a table of contents', async () => {
		const { tools } = register(['read', 'docs', 'scan', 'publish'])
		const text = await callGuide(tools, {})
		// Policy 5B: the no-argument response stays small; full sections are opt-in.
		expect(text.length).toBeLessThanOrEqual(12_000)
		const result = JSON.parse(text)
		expect(result.toolNames).toEqual(tools.map((tool) => tool.name))
		expect(result.contents.map((entry: { section: string }) => entry.section)).toEqual([...GUIDE_SECTIONS])
		expect(result.workflowStages.at(-1)?.id).toBe('operate')
		expect(result.tools).toBeUndefined()
	})

	it('returns only the requested sections', async () => {
		const { tools } = register(['read', 'docs'])
		const result = JSON.parse(await callGuide(tools, { sections: ['workflow', 'bogus'] }))
		expect(result.workflow.map((stage: { id: string }) => stage.id)).toContain('release')
		expect(result.tools).toBeUndefined()
		expect(result.services).toBeUndefined()
		expect(result.documentation).toContain('docs.extenshi.io')
	})

	it('storeMedia documents screenshots --evidence and what it binds to', async () => {
		const { tools } = register(['read', 'docs'])
		const { storeMedia } = JSON.parse(await callGuide(tools, { sections: ['storeMedia'] }))
		expect(storeMedia.screenshots.command).toContain('--evidence --listing <file>')
		expect(storeMedia.screenshots.evidence).toContain('extenshi project bind')
		expect(storeMedia.screenshots.evidence).toContain('release prepare --listing')
	})

	it('describes the workflow as reference material, with related tools as data', async () => {
		const { tools } = register(['read', 'docs', 'scan', 'publish'])
		const result = await readGuide(tools)
		const registered = new Set(tools.map((tool) => tool.name))
		for (const stage of result.workflow) {
			for (const name of stage.relatedTools) expect(registered.has(name), name).toBe(true)
			expect(stage.actions).not.toMatch(/\b(call|use|you|your)\b/i)
		}
		for (const service of result.services) expect(service.access).not.toMatch(/\b(you|your)\b/i)
	})

	it('initialize guidance distinguishes hosted operations from local artifact actions', () => {
		const remote = getServerInstructions(new Set(['read', 'docs']))
		const local = getServerInstructions(new Set(['read', 'docs', 'scan', 'publish']))
		expect(remote).toContain('get_development_guide')
		expect(remote).toContain('no local artifact scan or store-publishing tool')
		expect(local).toContain('exposes scan_extension and publish_extension')
	})
})
