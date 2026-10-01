import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bff } from './bff.js'
import { amoCreateAllowed, publishArtifact, storeCredentialsFor } from './publish.js'
import { type Capability, registerTools } from './tools.js'

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
