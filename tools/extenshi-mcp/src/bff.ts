/**
 * Thin tRPC client for the public catalog BFF (`bff.extenshi.io`).
 *
 * The BFF tRPC server is configured WITHOUT a data transformer (no superjson),
 * so this client must match — plain JSON over the wire. We type the proxy as
 * `any` on purpose: catalog-api emits no `.d.ts`, so the BFF↔API type chain
 * can't be imported reliably across a published-package boundary. The runtime
 * proxy builds the procedure path from property access regardless of types.
 *
 * Every call carries `Authorization: Bearer <ek_…>`. Today the BFF read
 * procedures are anonymous, but they are moving to mandatory key-enforcement
 * (no anonymous data access) — sending the key now is forward-compatible and
 * needs no client change when enforcement lands.
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { PAY_OPERATIONS, type PayBff, payWireInput } from './pay.js'

type AnyTRPCClient = any

/** One credit pool as reported by `getApiCallerBalance`. */
export interface CreditPool {
	/** Total calls this pool can still fund (free grant + purchased) — the single number that gates a call. */
	remaining: number
	/** The slice of `remaining` still coming from the one-time signup grant (always ≤ remaining). */
	freeRemaining: number
	freeGranted: number
	freeUsed: number
}

/** Read/scan/icon/inventory balances for the `ek_` key or remote-MCP identity. */
export interface ApiCallerBalance {
	read: CreditPool
	scan: CreditPool
	icon: CreditPool
	inventory: CreditPool
	billingUrl: string
}

/** A resolved store→catalog reference (`resolveExtensionRef`). */
export interface ExtensionRef {
	id: number
	store: 'CHROME' | 'FIREFOX' | 'EDGE'
}

export interface Bff extends PayBff {
	importManifest(input: import('@extenshi/contracts').ManifestImport): Promise<unknown>
	getProjectWorkspace(input: { projectId: string }): Promise<unknown>
	diffProjectWorkspace(input: import('@extenshi/contracts').WorkspacePatch): Promise<unknown>
	patchProjectWorkspace(input: import('@extenshi/contracts').WorkspacePatch): Promise<unknown>
	recordProjectEvidence(
		input: Omit<import('@extenshi/contracts').Evidence, 'id' | 'recordedAt'>,
	): Promise<unknown>
	getReleaseReadiness(input: {
		projectId: string
		browser?: 'chrome' | 'firefox' | 'edge'
		artifactDigest?: string
	}): Promise<unknown>
	connectionDiagnostics(): Promise<unknown>
	searchExtensions(input: Record<string, unknown>): Promise<unknown>
	getExtensionById(id: number): Promise<unknown>
	/** Paginated store user reviews for an extension (PII-free projection). */
	getReviews(input: Record<string, unknown>): Promise<unknown>
	getSecurityData(extensionId: number): Promise<unknown>
	getRiskSummary(extensionId: number): Promise<unknown>
	getSearchFacets(input: Record<string, unknown>): Promise<unknown>
	getStats(): Promise<unknown>
	/** Catalog-wide extended facets (manifest / permissions / risk / freshness …), cached server-side. */
	getExtendedFilterFacets(): Promise<unknown>
	/** Catalog-wide category tree with per-category counts. */
	getCategoryTree(): Promise<unknown>
	/** This caller's credit balances across all pools. FREE — never spends a read credit. */
	getApiCallerBalance(): Promise<ApiCallerBalance>
	/**
	 * Resolve a public STORE extension id (from the store URL) to the numeric
	 * catalog id the read tools take. FREE — the read that follows is what's
	 * metered. Returns null when no catalog listing exists for it yet.
	 */
	resolveExtensionRef(input: {
		storeId: string
		store?: 'CHROME' | 'FIREFOX' | 'EDGE'
	}): Promise<ExtensionRef | null>
	/**
	 * Risk for MANY extensions addressed by store id, in ONE metered read.
	 * Cluster-resolved server-side, so each row describes the same listing the
	 * extension page renders. Capped at 40 extensions per call for metered
	 * callers — the BFF rejects a larger batch with a message naming the limit.
	 */
	getSecuritySummaryBatch(input: {
		extensions: Array<{ storeId: string; store: 'CHROME' | 'FIREFOX' | 'EDGE' }>
	}): Promise<unknown>
	/**
	 * The caller's OWN extension projects. FREE — credits pay for catalog data
	 * about other people's extensions, never for reading your own work.
	 */
	listMyProjects(): Promise<unknown>
	/**
	 * One own project as state an agent can act on: chosen extension types, the
	 * manifest.json that project produces per browser, live hosted URLs, and an
	 * index of saved tool state. FREE, same reasoning. `includeToolStates` inlines
	 * named payloads; without it the response lists what exists and how big.
	 */
	getMyProjectState(input: { projectId: string; includeToolStates?: string[] }): Promise<unknown>
	/**
	 * The starter extension one own project produces, as files — the same set the
	 * site commits and packs into its download. FREE, same reasoning. One browser
	 * per call: the manifests differ between them and the rest does not.
	 */
	getMyProjectScaffold(input: { projectId: string; browser?: string }): Promise<unknown>
	listPrivacyPolicyVersions(input: { projectId: string }): Promise<unknown>
	getPrivacyPolicyVersion(input: { projectId: string; versionNumber: number }): Promise<unknown>
	publishPrivacyPolicy(input: { projectId: string; bodyMarkdown?: string; kind?: string }): Promise<unknown>
	updatePrivacyPolicyWithAi(input: { projectId: string }): Promise<unknown>
	/**
	 * Create (or ROTATE) the per-project CI evidence ingest secret. The
	 * plaintext is shown once and belongs in the repository's Actions secrets.
	 */
	createCiIngestSecret(input: { projectId: string }): Promise<unknown>
	revokeCiIngestSecret(input: { projectId: string }): Promise<unknown>
	/** Register a project's homepage/support URL (HTTPS, reachable, hashed). */
	upsertHostedPage(input: { projectId: string; kind: string; url: string }): Promise<unknown>
	/** Re-fetch and compare: verified | changed | unreachable per kind. */
	verifyHostedArtifact(input: { projectId: string; kind: string }): Promise<unknown>
	/** Forget a registration (a project moving off a URL needs a real delete). */
	removeHostedPage(input: { projectId: string; kind: string }): Promise<unknown>
	listHostedPages(input: { projectId: string }): Promise<unknown>
	/** Publish (create or update) the project's landing page on page.extenshi.io. */
	publishLandingPage(input: {
		projectId: string
		form: Record<string, unknown>
		registerAsHomepage?: boolean
	}): Promise<unknown>
	getLandingPage(input: { projectId: string }): Promise<unknown>
	unpublishLandingPage(input: { projectId: string }): Promise<unknown>
	/**
	 * Upload one PNG/JPEG/WebP to the project's PUBLIC media store (the same one
	 * Dojo uploads use). The BFF re-checks magic bytes, strips metadata, enforces
	 * size/dimension/quota limits and returns a stable content-addressed URL.
	 */
	uploadProjectMedia(input: {
		projectId: string
		mime: 'image/png' | 'image/jpeg' | 'image/webp'
		dataBase64: string
	}): Promise<unknown>
}

/** Build a BFF client from a static `ek_…` key (stdio path). */
export function makeBff(bffUrl: string, apiKey: string): Bff {
	return makeBffWithAuth(bffUrl, () => `Bearer ${apiKey}`)
}

/**
 * Build a BFF client whose Authorization header is produced per request by
 * `authHeader` (may be async). The remote OAuth server uses this to mint a
 * fresh, short-lived genkan JWT for each call instead of holding a static key.
 * The provider returns the FULL header value (e.g. `Bearer eyJ…`).
 */
export function makeBffWithAuth(bffUrl: string, authHeader: () => string | Promise<string>): Bff {
	const client: AnyTRPCClient = createTRPCClient({
		links: [
			httpBatchLink({
				url: `${bffUrl}/api/trpc`,
				headers: async () => ({ authorization: await authHeader() }),
			}),
		],
	})

	// NB: the store router is mounted under `catalog` in the BFF appRouter
	// (routers/index.ts: `catalog: storeRouter`), NOT `store`. Security is `security`.
	const pay = Object.fromEntries(
		PAY_OPERATIONS.map(([method, , , procedure, mutation]) => [
			method,
			(input: Record<string, unknown>) => {
				const [router, action] = procedure.split('.')
				return client[router][action][mutation ? 'mutate' : 'query'](payWireInput(method, input))
			},
		]),
	) as unknown as PayBff
	return {
		...pay,
		importManifest: (input) => client.devProject.agentImportManifest.mutate(input),
		getProjectWorkspace: (input) => client.devProject.agentGetWorkspace.query(input),
		diffProjectWorkspace: (input) => client.devProject.agentDiffWorkspace.mutate(input),
		patchProjectWorkspace: (input) => client.devProject.agentPatchWorkspace.mutate(input),
		recordProjectEvidence: (input) => client.devProject.agentRecordEvidence.mutate(input),
		getReleaseReadiness: (input) => client.devProject.agentReleaseReadiness.query(input),
		connectionDiagnostics: () => client.devProject.agentConnectionDiagnostics.query(),
		searchExtensions: (input) => client.catalog.searchExtensions.query(input),
		getExtensionById: (id) => client.catalog.getExtensionById.query({ id }),
		getReviews: (input) => client.catalog.getReviewsForExtension.query(input),
		getSecurityData: (extensionId) => client.security.getSecurityData.query({ extensionId }),
		getRiskSummary: (extensionId) => client.security.getRiskSummary.query({ extensionId }),
		getSearchFacets: (input) => client.catalog.getSearchFacets.query(input),
		getStats: () => client.catalog.getStats.query(),
		getExtendedFilterFacets: () => client.catalog.getExtendedFilterFacets.query(),
		getCategoryTree: () => client.catalog.getCategoryTree.query(),
		getApiCallerBalance: () => client.cli.getApiCallerBalance.query(),
		resolveExtensionRef: (input) => client.catalog.resolveExtensionRef.query(input),
		getSecuritySummaryBatch: (input) => client.security.getSecuritySummaryBatch.query(input),
		listMyProjects: () => client.devProject.agentListProjects.query(),
		getMyProjectState: (input) => client.devProject.agentGetProjectState.query(input),
		getMyProjectScaffold: (input) => client.devProject.agentGetProjectScaffold.query(input),
		listPrivacyPolicyVersions: (input) => client.privacyPolicy.agentListVersions.query(input),
		getPrivacyPolicyVersion: (input) => client.privacyPolicy.agentGetVersion.query(input),
		publishPrivacyPolicy: (input) => client.privacyPolicy.agentPublish.mutate(input),
		updatePrivacyPolicyWithAi: (input) => client.privacyPolicy.agentUpdateWithAi.mutate(input),
		createCiIngestSecret: (input) => client.devProject.agentCreateCiIngestSecret.mutate(input),
		revokeCiIngestSecret: (input) => client.devProject.agentRevokeCiIngestSecret.mutate(input),
		upsertHostedPage: (input) => client.devProject.agentUpsertHostedPage.mutate(input),
		verifyHostedArtifact: (input) => client.devProject.agentVerifyHostedArtifact.mutate(input),
		removeHostedPage: (input) => client.devProject.agentRemoveHostedPage.mutate(input),
		listHostedPages: (input) => client.devProject.agentListHostedPages.query(input),
		publishLandingPage: (input) => client.devProject.agentPublishLandingPage.mutate(input as never),
		getLandingPage: (input) => client.devProject.agentGetLandingPage.query(input),
		unpublishLandingPage: (input) => client.devProject.agentUnpublishLandingPage.mutate(input),
		uploadProjectMedia: (input) => client.devProject.agentUploadProjectMedia.mutate(input),
	}
}
