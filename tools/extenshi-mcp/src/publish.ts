/**
 * Multi-store publishing for the MCP `publish_extension` tool.
 *
 * Thin wrapper over @extenshi/publisher: credentials come from the MCP
 * client's environment (same env vars as `extenshi publish`), the upload
 * goes straight from this machine to the store APIs. FREE — no Extenshi
 * API key, nothing passes through Extenshi servers.
 */

import * as fs from 'node:fs'
import path from 'node:path'
import { isPlaceholderGeckoId, isValidGeckoId } from '@extenshi/contracts'
import {
	ChromeAPI,
	EdgeAPI,
	FirefoxAPI,
	publishToStores,
	type StoreType,
	type UniversalPublishResult,
} from '@extenshi/publisher'
import { assertValidArtifact } from './validate-artifact.js'

export interface StoreCredentials {
	chrome?: { appId: string; clientId: string; clientSecret: string; refreshToken: string }
	firefox?: { addonGuid: string; jwtIssuer: string; jwtSecret: string }
	edge?: { productId: string; clientId: string; clientSecret: string; tenantId: string }
}

export const ENV_DOCS: Record<StoreType, string[]> = {
	chrome: ['CHROME_APP_ID', 'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN'],
	firefox: ['FIREFOX_ADDON_GUID', 'FIREFOX_JWT_ISSUER', 'FIREFOX_JWT_SECRET'],
	edge: ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_CLIENT_SECRET', 'EDGE_TENANT_ID'],
}

/**
 * Store credentials, with an explicitly stated AMO add-on id filling
 * FIREFOX_ADDON_GUID when the environment has none. A different environment
 * value is refused: one run publishes to one add-on id.
 */
export function storeCredentialsFor(
	addonId?: string,
	env: NodeJS.ProcessEnv = process.env,
): StoreCredentials {
	if (addonId && env.FIREFOX_ADDON_GUID && env.FIREFOX_ADDON_GUID !== addonId)
		throw new PublishSetupError(
			`addon_id (${addonId}) differs from FIREFOX_ADDON_GUID (${env.FIREFOX_ADDON_GUID}); state one add-on id.`,
		)
	return readStoreCredentials(
		addonId && !env.FIREFOX_ADDON_GUID ? { ...env, FIREFOX_ADDON_GUID: addonId } : env,
	)
}

export function readStoreCredentials(env: NodeJS.ProcessEnv = process.env): StoreCredentials {
	const creds: StoreCredentials = {}
	if (env.CHROME_APP_ID && env.CHROME_CLIENT_ID && env.CHROME_CLIENT_SECRET && env.CHROME_REFRESH_TOKEN) {
		creds.chrome = {
			appId: env.CHROME_APP_ID,
			clientId: env.CHROME_CLIENT_ID,
			clientSecret: env.CHROME_CLIENT_SECRET,
			refreshToken: env.CHROME_REFRESH_TOKEN,
		}
	}
	if (env.FIREFOX_ADDON_GUID && env.FIREFOX_JWT_ISSUER && env.FIREFOX_JWT_SECRET) {
		creds.firefox = {
			addonGuid: env.FIREFOX_ADDON_GUID,
			jwtIssuer: env.FIREFOX_JWT_ISSUER,
			jwtSecret: env.FIREFOX_JWT_SECRET,
		}
	}
	if (env.EDGE_PRODUCT_ID && env.EDGE_CLIENT_ID && env.EDGE_CLIENT_SECRET && env.EDGE_TENANT_ID) {
		creds.edge = {
			productId: env.EDGE_PRODUCT_ID,
			clientId: env.EDGE_CLIENT_ID,
			clientSecret: env.EDGE_CLIENT_SECRET,
			tenantId: env.EDGE_TENANT_ID,
		}
	}
	return creds
}

export function credentialsHelp(stores: StoreType[]): string {
	return stores.map((s) => `  ${s}: ${ENV_DOCS[s].join(', ')}`).join('\n')
}

export interface PublishArgs {
	artifactPath: string
	stores?: StoreType[]
	firefoxArtifactPath?: string
	releaseNotes?: string
	/** Explicit AMO add-on id; fills FIREFOX_ADDON_GUID when the environment has none. */
	addonId?: string
	/** Listed AMO submission with metadata instead of a version-only upload. */
	firefoxListing?: {
		listingPath: string
		sourcePath?: string
		screenshotsDir?: string
		/** Resolved by amoCreateAllowed — creating an add-on fixes its id permanently. */
		allowCreate: boolean
		replaceScreenshots?: boolean
	}
}

export class PublishSetupError extends Error {}

/**
 * Whether this call may CREATE a new AMO add-on. With a project, its
 * owner-decided `amo.addonId` governs (and a different FIREFOX_ADDON_GUID is
 * refused). Without one, `allowNewAddon` is the switch and `addonId` has to
 * state the id explicitly — it is never taken silently from the environment.
 * Mirrors the CLI's gate.
 */
export function amoCreateAllowed(opts: {
	addonGuid: string
	allowNewAddon?: boolean
	addonId?: string
	projectId?: string
	decision?: { status: string; value: unknown } | null
}): boolean {
	if (opts.addonId !== undefined && opts.addonId !== opts.addonGuid)
		throw new PublishSetupError(
			`addon_id (${opts.addonId}) differs from FIREFOX_ADDON_GUID (${opts.addonGuid}); state one add-on id.`,
		)
	if (!opts.projectId) {
		if (!opts.allowNewAddon) return false
		if (!opts.addonId)
			throw new PublishSetupError(
				'allow_new_addon without project_id needs addon_id: the AMO add-on id to create, stated explicitly. ' +
					'It becomes permanent at the first upload and is never invented. With project_id the owner decides it in Dojo instead.',
			)
		if (!isValidGeckoId(opts.addonId))
			throw new PublishSetupError(
				`addon_id ${opts.addonId} is not an AMO add-on id: use a braced GUID ({xxxxxxxx-xxxx-…}) or name@domain.`,
			)
		if (isPlaceholderGeckoId(opts.addonId))
			throw new PublishSetupError(
				`addon_id ${opts.addonId} is a placeholder; AMO would bind the new add-on to it forever. State the real id.`,
			)
		return true
	}
	if (opts.decision?.status === 'decided') {
		if (opts.decision.value !== opts.addonGuid)
			throw new PublishSetupError(
				`FIREFOX_ADDON_GUID (${opts.addonGuid}) differs from the add-on id the project owner decided (${String(opts.decision.value)}). ` +
					'Set the manifest gecko.id and FIREFOX_ADDON_GUID to the decided id; AMO never renames an add-on.',
			)
		return true
	}
	if (opts.allowNewAddon)
		throw new PublishSetupError(
			`The owner of project ${opts.projectId} has not decided amo.addonId, and creating the AMO add-on fixes it permanently. ` +
				'Propose it with propose_decision; the owner decides it on the Dojo project page.',
		)
	return false
}

/** Load the listing, source and screenshots for a listed AMO submission. */
export function loadFirefoxListing(listing: NonNullable<PublishArgs['firefoxListing']>) {
	if (typeof FirefoxAPI.submitListing !== 'function' || typeof FirefoxAPI.loadAmoListing !== 'function')
		throw new PublishSetupError(
			"This installation's @extenshi/publisher predates AMO listing submission. Reinstall @extenshi/mcp to update it.",
		)
	try {
		const parsed = FirefoxAPI.loadAmoListing(path.resolve(listing.listingPath))
		const sourceFilePath = listing.sourcePath ? path.resolve(listing.sourcePath) : undefined
		if (sourceFilePath) {
			if (!fs.existsSync(sourceFilePath)) throw new Error(`Source archive not found: ${listing.sourcePath}`)
			FirefoxAPI.assertSourceArchive(sourceFilePath)
		}
		const screenshotPaths = listing.screenshotsDir
			? FirefoxAPI.listScreenshots(path.resolve(listing.screenshotsDir), parsed.defaultLocale)
			: undefined
		if (screenshotPaths && !screenshotPaths.length)
			throw new Error(`No .png, .jpg or .gif screenshots in ${listing.screenshotsDir}`)
		return {
			listing: parsed,
			sourceFilePath,
			screenshotPaths,
			allowCreate: listing.allowCreate,
			replaceScreenshots: listing.replaceScreenshots ?? false,
		}
	} catch (err) {
		if (err instanceof PublishSetupError) throw err
		throw new PublishSetupError(err instanceof Error ? err.message : String(err))
	}
}

export async function publishArtifact(args: PublishArgs): Promise<UniversalPublishResult> {
	if (!fs.existsSync(args.artifactPath)) {
		throw new PublishSetupError(`Artifact not found: ${args.artifactPath}`)
	}
	if (args.firefoxArtifactPath && !fs.existsSync(args.firefoxArtifactPath)) {
		throw new PublishSetupError(`Firefox artifact not found: ${args.firefoxArtifactPath}`)
	}

	// Refuse to upload anything that isn't a real extension package.
	try {
		assertValidArtifact(args.artifactPath)
		if (args.firefoxArtifactPath) assertValidArtifact(args.firefoxArtifactPath)
	} catch (err) {
		throw new PublishSetupError(err instanceof Error ? err.message : String(err))
	}

	const creds = storeCredentialsFor(args.addonId)
	const configured = (['chrome', 'firefox', 'edge'] as StoreType[]).filter((s) => creds[s])
	const stores = args.stores?.length ? args.stores : configured

	if (!stores.length) {
		throw new PublishSetupError(
			'No store credentials found in the environment. Publishing is free and runs locally — ' +
				'add credentials for at least one store to the MCP server env:\n' +
				credentialsHelp(['chrome', 'firefox', 'edge']),
		)
	}
	const missing = stores.filter((s) => !creds[s])
	if (missing.length) {
		throw new PublishSetupError(`Missing credentials for: ${missing.join(', ')}\n${credentialsHelp(missing)}`)
	}
	if (args.firefoxListing && !stores.includes('firefox'))
		throw new PublishSetupError(
			'listing_path, source_path and screenshots_dir apply to Firefox (AMO); include firefox in stores.',
		)
	const firefoxListing = args.firefoxListing ? loadFirefoxListing(args.firefoxListing) : undefined

	return publishToStores({
		extensionId: creds.chrome?.appId ?? creds.firefox?.addonGuid ?? creds.edge?.productId ?? 'extension',
		stores,
		packagePaths: {
			chrome: stores.includes('chrome') ? args.artifactPath : undefined,
			firefox: stores.includes('firefox') ? (args.firefoxArtifactPath ?? args.artifactPath) : undefined,
			edge: stores.includes('edge') ? args.artifactPath : undefined,
		},
		storeConfigs: {
			chrome: creds.chrome,
			firefox: creds.firefox ? { ...creds.firefox, ...(firefoxListing ?? {}) } : undefined,
			edge: creds.edge,
		},
		releaseNotes: args.releaseNotes,
		parallel: true,
	})
}

export async function validateStoreCredentials(
	stores?: StoreType[],
): Promise<Array<{ store: StoreType; configured: boolean; valid: boolean }>> {
	const creds = readStoreCredentials()
	const targets = stores?.length ? stores : (['chrome', 'firefox', 'edge'] as StoreType[])
	return Promise.all(
		targets.map(async (store) => {
			if (store === 'chrome' && creds.chrome) {
				const valid = await ChromeAPI.validateCredentials(
					creds.chrome.clientId,
					creds.chrome.clientSecret,
					creds.chrome.refreshToken,
				)
				return { store, configured: true, valid }
			}
			if (store === 'firefox' && creds.firefox) {
				const valid = await FirefoxAPI.validateCredentials(creds.firefox.jwtIssuer, creds.firefox.jwtSecret)
				return { store, configured: true, valid }
			}
			if (store === 'edge' && creds.edge) {
				const valid = await EdgeAPI.validateCredentials(
					creds.edge.clientId,
					creds.edge.clientSecret,
					creds.edge.tenantId,
				)
				return { store, configured: true, valid }
			}
			return { store, configured: false, valid: false }
		}),
	)
}
