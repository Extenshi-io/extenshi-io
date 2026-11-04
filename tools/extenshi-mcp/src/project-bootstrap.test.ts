import * as contracts from '@extenshi/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bff } from './bff.js'
import { amoCreateAllowed, publishArtifact, storeCredentialsFor } from './publish.js'
import { BUILD_MAP_READ_MS, type Capability, registerTools } from './tools.js'

vi.mock('./telemetry.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./telemetry.js')>()),
	captureEvent: vi.fn(),
	captureError: vi.fn(),
}))
vi.mock('./publish-access.js', () => ({ checkPublishAccess: vi.fn(async () => ({ allowed: true })) }))
vi.mock('./publish.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./publish.js')>()),
	publishArtifact: vi.fn(async () => ({ success: true, results: {}, summary: {} })),
}))

const projectId = '11111111-1111-4111-8111-111111111111'
const key = '22222222-2222-4222-8222-222222222222'
const guid = '{8d2c6b1e-4f7a-4c3e-9b1d-0a5e7c9f2b4d}'
function toolsWith(bff: Partial<Bff>, capabilities: Capability[] = ['read']): Record<string, any> {
	const tools: Record<string, any> = {}
	const addTool = (t: { name: string }) => {
		tools[t.name] = t
	}
	registerTools({ addTool } as never, {
		cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
		capabilities: new Set(capabilities),
		getBff: () => bff as Bff,
		requireApiKey: () => 'ek_test',
		getApiKey: () => 'ek_test',
	})
	return tools
}

describe('create_project', () => {
	it('requires an idempotency key and forwards the parsed request', async () => {
		const createProject = vi.fn(async () => ({ projectId, created: true, nextSteps: [] }))
		const tool = toolsWith({ createProject }).create_project
		expect(() => tool.parameters.parse({ name: 'Reader' })).toThrow()
		const input = tool.parameters.parse({ name: ' Reader ', browsers: ['firefox'], idempotencyKey: key })
		expect(JSON.parse(await tool.execute(input, {}))).toMatchObject({ projectId })
		expect(createProject).toHaveBeenCalledWith({ name: 'Reader', browsers: ['firefox'], idempotencyKey: key })
		expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
	})
})

describe('buildMap in project answers (local server only)', () => {
	const summary = {
		running: true,
		url: 'http://127.0.0.1:4321/',
		offered: true,
		declined: false,
		offers: 1,
		home: '/repo/ext',
	}
	function localTools(bff: Partial<Bff>, readBuildMap: (projectDir?: string) => Promise<typeof summary>) {
		const tools: Record<string, any> = {}
		const addTool = (t: { name: string }) => {
			tools[t.name] = t
		}
		registerTools({ addTool } as never, {
			cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
			capabilities: new Set<Capability>(['read']),
			getBff: () => bff as Bff,
			readBuildMap,
		})
		return tools
	}

	it('create_project adds buildMap for projectDir and keeps projectDir away from the service', async () => {
		const createProject = vi.fn(async () => ({ projectId, created: true, nextSteps: [] }))
		const readBuildMap = vi.fn(async () => summary)
		const tool = localTools({ createProject }, readBuildMap).create_project
		const input = tool.parameters.parse({ name: 'Reader', idempotencyKey: key, projectDir: 'ext' })
		expect(JSON.parse(await tool.execute(input, {}))).toEqual({
			projectId,
			created: true,
			nextSteps: [],
			buildMap: summary,
		})
		expect(createProject).toHaveBeenCalledWith({ name: 'Reader', browsers: [], idempotencyKey: key })
		expect(readBuildMap).toHaveBeenCalledWith('ext')
		expect(tool.description).toContain('`buildMap`')
	})

	it('get_project_state adds buildMap, defaulting to the working directory', async () => {
		const getMyProjectState = vi.fn(async () => ({ schemaVersion: 5 }))
		const readBuildMap = vi.fn(async () => summary)
		const tool = localTools({ getMyProjectState }, readBuildMap).get_project_state
		expect(JSON.parse(await tool.execute(tool.parameters.parse({ projectId }), {}))).toEqual({
			schemaVersion: 5,
			buildMap: summary,
		})
		expect(readBuildMap).toHaveBeenCalledWith(undefined)
		expect(getMyProjectState).toHaveBeenCalledWith({
			projectId,
			includeToolStates: undefined,
			manifests: 'summary',
		})
	})

	it('a map that cannot be read leaves the answer as it was', async () => {
		const getMyProjectState = vi.fn(async () => ({ schemaVersion: 5 }))
		const tool = localTools({ getMyProjectState }, async () => {
			throw new Error('ENOENT')
		}).get_project_state
		expect(JSON.parse(await tool.execute({ projectId, projectDir: '/missing' }, {}))).toEqual({
			schemaVersion: 5,
		})
	})

	it('a map read that hangs does not hold up the answer', async () => {
		vi.useFakeTimers()
		try {
			const getMyProjectState = vi.fn(async () => ({ schemaVersion: 5 }))
			const tool = localTools({ getMyProjectState }, () => new Promise(() => {})).get_project_state
			const pending = tool.execute({ projectId }, {})
			await vi.advanceTimersByTimeAsync(BUILD_MAP_READ_MS)
			expect(JSON.parse(await pending)).toEqual({ schemaVersion: 5 })
		} finally {
			vi.useRealTimers()
		}
	})

	it('without local files (the hosted connector) there is no projectDir and no buildMap', async () => {
		const createProject = vi.fn(async () => ({ projectId }))
		const getMyProjectState = vi.fn(async () => ({ schemaVersion: 5 }))
		const tools = toolsWith({ createProject, getMyProjectState })
		expect(
			tools.create_project.parameters.safeParse({ name: 'R', idempotencyKey: key, projectDir: '.' }).success,
		).toBe(false)
		expect(tools.get_project_state.parameters.parse({ projectId, projectDir: '.' })).not.toHaveProperty(
			'projectDir',
		)
		expect(tools.get_project_state.description).not.toContain('buildMap')
		expect(JSON.parse(await tools.get_project_state.execute({ projectId }, {}))).toEqual({ schemaVersion: 5 })
	})
})

describe('decisions tools', () => {
	it('reads the decision view', async () => {
		const getDecisions = vi.fn(async () => ({ pending: ['license'], decisions: [] }))
		const tool = toolsWith({ getDecisions }).get_decisions
		expect(JSON.parse(await tool.execute({ projectId }, {}))).toEqual({ pending: ['license'], decisions: [] })
		expect(getDecisions).toHaveBeenCalledWith({ projectId })
	})

	it('validates a proposal against its key before it leaves the machine', async () => {
		const proposeDecision = vi.fn(async () => ({ entry: { status: 'proposed' } }))
		const tool = toolsWith({ proposeDecision }).propose_decision
		const base = { projectId, idempotencyKey: key }
		expect(tool.parameters.safeParse({ ...base, key: 'amo.addonId', value: 'not an id' }).success).toBe(false)
		expect(tool.parameters.safeParse({ ...base, key: 'targetBrowsers', value: ['safari'] }).success).toBe(
			false,
		)
		// There is no way to express "decided" through this tool.
		expect(
			tool.parameters.safeParse({ ...base, key: 'license', value: 'MIT', status: 'decided' }).success,
		).toBe(false)
		const input = tool.parameters.parse({
			...base,
			key: 'amo.addonId',
			value: guid,
			rationale: 'derived default',
		})
		await tool.execute(input, {})
		expect(proposeDecision).toHaveBeenCalledWith(input)
	})
})

// The public mirror (mirror-mcp.yml) tests against @extenshi/contracts from npm,
// which may predate AMO_EXTENSION_LICENSES and the misspelled-slug refusal (new in
// 0.2.1). The monorepo resolves contracts to its source, so everything runs there.
const CONTRACT_LICENSES = (contracts as Record<string, unknown>).AMO_EXTENSION_LICENSES as
	| readonly string[]
	| undefined
const AMO_LICENSES = [
	'all-rights-reserved',
	'MPL-2.0',
	'Apache-2.0',
	'GPL-2.0-only',
	'GPL-3.0-only',
	'LGPL-2.1-only',
	'LGPL-3.0-only',
	'AGPL-3.0-only',
	'MIT',
	'ISC',
	'BSD-2-Clause',
	'Unlicense',
]

describe('license proposals', () => {
	it('lists every AMO slug and tells UNLICENSED apart from Unlicense', () => {
		if (CONTRACT_LICENSES) expect([...CONTRACT_LICENSES]).toEqual(AMO_LICENSES)
		const { description } = toolsWith({}).propose_decision
		for (const slug of AMO_LICENSES) expect(description).toContain(slug)
		expect(description).toMatch(
			/UNLICENSED in package\.json means proprietary, so propose all-rights-reserved/,
		)
		expect(description).toMatch(/customLicense \(name \+ text\)/)
	})

	// The only check that needs contracts 0.2.1. The BFF refuses a misspelled slug
	// whatever contracts the client runs, so the description holds either way.
	it.skipIf(!CONTRACT_LICENSES)(
		'refuses a misspelled slug before it leaves the machine and keeps custom licenses',
		() => {
			const tool = toolsWith({}).propose_decision
			const parse = (value: string) =>
				tool.parameters.safeParse({ projectId, idempotencyKey: key, key: 'license', value })
			expect(parse('mit').error?.issues[0]?.message).toMatch(/AMO's slug for this license is MIT/)
			expect(parse('UNLICENSED').success).toBe(false)
			expect(parse('BSD-3-Clause').success).toBe(true)
		},
	)
})

describe('AMO first-time creation gate', () => {
	it('follows the project decision and refuses a mismatched id', () => {
		// Without a project the id has to be stated explicitly — never invented.
		expect(() => amoCreateAllowed({ addonGuid: guid, allowNewAddon: true })).toThrow(/needs addon_id/)
		const placeholder = 'extension@example.com'
		expect(() =>
			amoCreateAllowed({ addonGuid: placeholder, allowNewAddon: true, addonId: placeholder }),
		).toThrow(/is a placeholder/)
		expect(amoCreateAllowed({ addonGuid: guid, allowNewAddon: true, addonId: guid })).toBe(true)
		expect(() => amoCreateAllowed({ addonGuid: guid, allowNewAddon: true, addonId: 'x@y.dev' })).toThrow(
			/differs from FIREFOX_ADDON_GUID/,
		)
		expect(amoCreateAllowed({ addonGuid: guid })).toBe(false)
		expect(
			amoCreateAllowed({ addonGuid: guid, projectId, decision: { status: 'decided', value: guid } }),
		).toBe(true)
		expect(() =>
			amoCreateAllowed({ addonGuid: guid, projectId, decision: { status: 'decided', value: 'x@y.dev' } }),
		).toThrow(/differs from the add-on id the project owner decided/)
		expect(
			amoCreateAllowed({ addonGuid: guid, projectId, decision: { status: 'proposed', value: guid } }),
		).toBe(false)
		expect(() =>
			amoCreateAllowed({ addonGuid: guid, projectId, allowNewAddon: true, decision: null }),
		).toThrow(/has not decided amo.addonId/)
	})
})

describe('publish_extension with an AMO listing', () => {
	const env = { ...process.env }
	beforeEach(() => {
		process.env.FIREFOX_ADDON_GUID = guid
		process.env.FIREFOX_JWT_ISSUER = 'user:1:2'
		process.env.FIREFOX_JWT_SECRET = 'secret'
		vi.mocked(publishArtifact).mockClear()
	})
	afterEach(() => {
		process.env = { ...env }
	})

	it('passes the listing through with creation allowed by the decided add-on id', async () => {
		const getDecisions = vi.fn(async () => ({
			decisions: [{ key: 'amo.addonId', status: 'decided', value: guid }],
		}))
		const tool = toolsWith({ getDecisions }, ['publish']).publish_extension
		await tool.execute(
			{
				artifact_path: '/build/reader.xpi',
				stores: ['firefox'],
				listing_path: '/repo/AMO.md',
				source_path: '/build/source.zip',
				screenshots_dir: '/repo/screenshots',
				project_id: projectId,
			},
			{ reportProgress: vi.fn() },
		)
		expect(getDecisions).toHaveBeenCalledWith({ projectId })
		expect(vi.mocked(publishArtifact).mock.calls[0][0]).toMatchObject({
			firefoxListing: {
				listingPath: '/repo/AMO.md',
				sourcePath: '/build/source.zip',
				screenshotsDir: '/repo/screenshots',
				allowCreate: true,
			},
		})
	})

	it('creates without a project only with an explicitly stated addon_id', async () => {
		delete process.env.FIREFOX_ADDON_GUID
		const tool = toolsWith({}, ['publish']).publish_extension
		const args = { artifact_path: '/build/reader.xpi', stores: ['firefox'], listing_path: '/repo/AMO.md' }
		await expect(
			tool.execute({ ...args, allow_new_addon: true }, { reportProgress: vi.fn() }),
		).rejects.toThrow(/needs addon_id/)
		await tool.execute({ ...args, allow_new_addon: true, addon_id: guid }, { reportProgress: vi.fn() })
		expect(vi.mocked(publishArtifact).mock.calls[0][0]).toMatchObject({
			addonId: guid,
			firefoxListing: { allowCreate: true },
		})
		expect(storeCredentialsFor(guid).firefox?.addonGuid).toBe(guid)
		process.env.FIREFOX_ADDON_GUID = 'other@reader.dev'
		expect(() => storeCredentialsFor(guid)).toThrow(/differs from FIREFOX_ADDON_GUID/)
	})

	it('needs a listing for source and screenshots', async () => {
		const tool = toolsWith({}, ['publish']).publish_extension
		await expect(
			tool.execute(
				{ artifact_path: '/build/reader.xpi', source_path: '/build/source.zip' },
				{ reportProgress: vi.fn() },
			),
		).rejects.toThrow(/need listing_path/)
		expect(publishArtifact).not.toHaveBeenCalled()
	})
})
