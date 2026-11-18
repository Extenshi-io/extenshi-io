/**
 * publish_extension → publishArtifact → @extenshi/publisher: what the tool's
 * notes and Firefox source parameters become in the publish options. The store calls themselves
 * are the publisher's to test; here publishToStores is a spy.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishToStores } from '@extenshi/publisher'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bff } from './bff.js'
import {
	loadFirefoxListing,
	requireReviewerNotesSupport,
	requireSourceWithoutListingSupport,
} from './publish.js'
import { type Capability, registerTools } from './tools.js'

vi.mock('@extenshi/publisher', async (importOriginal) => ({
	...(await importOriginal<typeof import('@extenshi/publisher')>()),
	publishToStores: vi.fn(async () => ({
		success: true,
		results: {},
		summary: { total: 1, successful: 1, failed: 0, errors: [] },
	})),
}))
vi.mock('./publish-access.js', () => ({ checkPublishAccess: vi.fn(async () => ({ allowed: true })) }))
vi.mock('./validate-artifact.js', () => ({ assertValidArtifact: vi.fn() }))
vi.mock('./telemetry.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./telemetry.js')>()),
	captureEvent: vi.fn(),
	captureError: vi.fn(),
}))

type PublishTool = { execute: (args: Record<string, unknown>, context: unknown) => Promise<unknown> }

function publishTool(): PublishTool {
	const tools: Record<string, PublishTool> = {}
	const server = {
		addTool: (t: { name: string } & PublishTool) => {
			tools[t.name] = t
		},
	}
	registerTools(server as unknown as Parameters<typeof registerTools>[0], {
		cfg: { bffUrl: 'https://bff.test', scanUrl: 'https://scan.test', docsUrl: 'https://docs.test' },
		capabilities: new Set<Capability>(['publish']),
		getBff: () => ({}) as Bff,
		getApiKey: () => 'ek_test',
	})
	return tools.publish_extension
}

const context = { reportProgress: vi.fn() }
let dir: string
let artifact: string

const ORIGINAL_CWD = process.cwd()

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'mcp-publish-'))
	// publishArtifact confines artifacts to the workspace (cwd); run the
	// tool the way a real session in the project directory would.
	process.chdir(dir)
	artifact = join(dir, 'ext.zip')
	writeFileSync(artifact, 'zip')
	vi.stubEnv('EDGE_PRODUCT_ID', 'prod')
	vi.stubEnv('EDGE_CLIENT_ID', 'cid')
	vi.stubEnv('EDGE_API_KEY', 'key')
	vi.mocked(publishToStores).mockClear()
})
afterEach(() => {
	process.chdir(ORIGINAL_CWD)
	vi.unstubAllEnvs()
	rmSync(dir, { recursive: true, force: true })
})

describe('publish_extension notes', () => {
	it('passes release_notes and reviewer_notes to the publisher as separate fields', async () => {
		await publishTool().execute(
			{
				artifact_path: artifact,
				stores: ['edge'],
				release_notes: 'Fixes',
				reviewer_notes: ' Test account in the listing notes ',
			},
			context,
		)
		expect(vi.mocked(publishToStores).mock.calls[0][0]).toMatchObject({
			stores: ['edge'],
			releaseNotes: 'Fixes',
			reviewerNotes: 'Test account in the listing notes',
		})
	})

	it('leaves reviewer notes unset when blank', async () => {
		await publishTool().execute({ artifact_path: artifact, stores: ['edge'], reviewer_notes: '  ' }, context)
		expect(vi.mocked(publishToStores).mock.calls[0][0].reviewerNotes).toBeUndefined()
	})

	it('refuses reviewer notes with a publisher too old to send them', () => {
		expect(() => requireReviewerNotesSupport({})).toThrow(/predates reviewer_notes/)
		expect(() => requireReviewerNotesSupport({ AMO_APPROVAL_NOTES_MAX: 3000 })).not.toThrow()
	})
})

describe('publish_extension source_path without listing_path', () => {
	const firefox = { artifact_path: '', stores: ['firefox'] }
	beforeEach(() => {
		firefox.artifact_path = artifact
		vi.stubEnv('FIREFOX_ADDON_GUID', 'reader@reader.dev')
		vi.stubEnv('FIREFOX_JWT_ISSUER', 'user:1:2')
		vi.stubEnv('FIREFOX_JWT_SECRET', 'secret')
	})

	it('sends only the source archive to the publisher, with the notes and no listing', async () => {
		const source = join(dir, 'amo-source.zip')
		writeFileSync(source, 'zip')
		await publishTool().execute(
			{ ...firefox, source_path: source, release_notes: 'Fixes', reviewer_notes: 'npm ci && npm run build' },
			context,
		)
		const options = vi.mocked(publishToStores).mock.calls[0][0]
		expect(options).toMatchObject({
			stores: ['firefox'],
			releaseNotes: 'Fixes',
			reviewerNotes: 'npm ci && npm run build',
		})
		expect(options.storeConfigs.firefox).toEqual({
			addonGuid: 'reader@reader.dev',
			jwtIssuer: 'user:1:2',
			jwtSecret: 'secret',
			sourceFilePath: source,
		})
		expect(options.storeConfigs.firefox).not.toHaveProperty('listing')
	})

	it('refuses a missing source archive before any upload', async () => {
		await expect(
			publishTool().execute({ ...firefox, source_path: join(dir, 'missing.zip') }, context),
		).rejects.toThrow(/Source archive not found/)
		expect(publishToStores).not.toHaveBeenCalled()
	})

	it('refuses a source file that is not an archive AMO accepts', async () => {
		const source = join(dir, 'source.rar')
		writeFileSync(source, 'rar')
		await expect(publishTool().execute({ ...firefox, source_path: source }, context)).rejects.toThrow(
			/AMO accepts source archives as/,
		)
		expect(publishToStores).not.toHaveBeenCalled()
	})

	it('refuses source_path when firefox is not among the stores', async () => {
		const source = join(dir, 'amo-source.zip')
		writeFileSync(source, 'zip')
		await expect(
			publishTool().execute({ artifact_path: artifact, stores: ['edge'], source_path: source }, context),
		).rejects.toThrow(/include firefox in stores/)
		expect(publishToStores).not.toHaveBeenCalled()
	})

	it('still needs listing_path for screenshots_dir', async () => {
		await expect(publishTool().execute({ ...firefox, screenshots_dir: dir }, context)).rejects.toThrow(
			/screenshots_dir needs listing_path/,
		)
		const source = join(dir, 'amo-source.zip')
		writeFileSync(source, 'zip')
		await expect(
			publishTool().execute({ ...firefox, source_path: source, screenshots_dir: dir }, context),
		).rejects.toThrow(/screenshots_dir needs listing_path/)
		expect(() => loadFirefoxListing({ screenshotsDir: dir })).toThrow(/screenshots_dir needs listing_path/)
		expect(publishToStores).not.toHaveBeenCalled()
	})

	it('refuses with a publisher too old to upload source without a listing', () => {
		expect(() => requireSourceWithoutListingSupport({})).toThrow(/predates source_path without listing_path/)
		expect(() => requireSourceWithoutListingSupport({ AMO_SOURCE_WITHOUT_LISTING: true })).not.toThrow()
	})
})
