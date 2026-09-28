/**
 * Transport-agnostic tool registry for the Extenshi MCP server.
 *
 * The SAME tool set must run over two transports:
 *   - stdio  (`index.ts`)  — local, single `ek_…` key from the environment.
 *   - remote (`http.ts`, in the sibling `@extenshi/mcp-server`) — Streamable
 *     HTTP behind OAuth; identity is per-request (an access token → userId).
 *
 * To keep ONE source of truth for what the tools do, every tool body here is
 * identity-agnostic: it resolves its catalog client / scan auth through the
 * injected `ToolDeps` instead of reaching for a module-global key. stdio passes
 * deps that ignore the call context and use the env key; the remote server
 * passes deps that read `context.session` (the validated OAuth identity).
 *
 * Capability gating: the remote connector deliberately exposes a SUBSET — the
 * catalog/project/policy/guidance tools. `scan_extension` and `publish_extension` need
 * the caller's LOCAL filesystem and LOCAL store credentials, which a hosted
 * server has no access to (and must never store) — so they are registered only
 * when the corresponding capability is present (stdio enables all four).
 * See internal-docs/plans/2026-06-25-claude-connector-directory.md §13 #1.
 *
 *   capability → tools
 *   ─────────────────────────────────────────────────────────────
 *   'read'    → search_extensions, get_extension, get_reviews,
 *               get_security, get_risk_by_store_ids, market_overview,
 *               list_my_projects, get_project_state, get_project_scaffold,
 *               list/get/publish/update privacy policy (hosted; Pro)
 *   'docs'    → get_development_guide, search_docs, list_extension_templates, generate_icon_workflow,
 *               generate_welcome_page_workflow, generate_landing_page, localize_workflow (free; no key)
 *   'scan'    → scan_extension             (local artifact; stdio only)
 *   'publish' → publish_extension          (local creds; stdio only)
 *
 * stdout is the MCP protocol channel for stdio — nothing here may write to it.
 */

import { agentEvidenceSchema, importManifestSchema, workspacePatchSchema } from '@extenshi/contracts'
import { type FastMCP, type FastMCPSessionAuth, type Tool, type ToolParameters, UserError } from 'fastmcp'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Bff } from './bff.js'
import { buildDevelopmentGuide, GUIDE_SECTIONS, type GuideTool } from './development-guide.js'
import {
	DEFAULT_EXCERPT_CHARS,
	DocsError,
	getDocsIndex,
	MAX_EXCERPT_CHARS,
	MIN_EXCERPT_CHARS,
	searchDocs,
} from './docs.js'
import { renderIconWorkflow } from './icon-workflow.js'
import { LANDING_LIMITS } from './landing-page.js'
import { hostedLandingNextSteps, landingFormFromArgs, renderGenerateLandingPage } from './landing-workflow.js'
import { renderLocalizeWorkflow } from './localize-workflow.js'
import { PAY_OPERATIONS, paySchemas } from './pay.js'
import { describePrivacyAiUpdate } from './privacy-ai-outcome.js'
import {
	PublishSetupError,
	publishArtifact,
	readStoreCredentials,
	validateStoreCredentials,
} from './publish.js'
import { checkPublishAccess } from './publish-access.js'
import { ScanError, scanArtifact } from './scan.js'
import { describeStoreConstraints, validateSearchFilters } from './search-filters.js'
import {
	DEFAULT_MARKET_TOP_N,
	MARKET_FACETS,
	MAX_MARKET_TOP_N,
	shapeExtension,
	shapeMarketOverview,
	shapeReviews,
	shapeSearch,
	shapeSecurity,
	shapeStoreRiskBatch,
} from './shape.js'
import { captureError, captureEvent, classifyError } from './telemetry.js'
import { renderExtensionTemplates } from './templates.js'
import { renderCatalogPayload } from './untrusted.js'
import { renderWelcomeWorkflow } from './welcome-workflow.js'

// ── Public links (shared by tool bodies + server instructions) ──────────────

export const KEY_PAGE = 'https://dojo.extenshi.io/api-keys'
export const SIGNUP_PAGE = 'https://auth.extenshi.io/signup'
export const BILLING_PAGE = 'https://dojo.extenshi.io/billing'
export const HOSTED_PAGES_DOCS = 'https://docs.extenshi.io/developers/project-sync#hosted-pages-from-the-api'

// Every workspace write carries provenance; saying so up front saves the agent a
// failed first call on `provenance.toolVersion: Required`.
const PROVENANCE_HINT =
	' `provenance` is required: {source: "agent", observedAt: ISO-8601 timestamp, toolVersion: your client name and version}.'

export const MISSING_KEY_MESSAGE =
	"This tool needs an Extenshi API key, and you don't have one set up yet — " +
	"here's how to get going.\n\n" +
	'Getting started is free: no credit card required. Every account includes a ' +
	'one-time free allowance (10 catalog reads + 3 scans), so you can explore the ' +
	'catalog and run scans before paying for anything.\n\n' +
	`1. Create a free account at ${SIGNUP_PAGE}\n` +
	`2. Grab a key at ${KEY_PAGE}\n` +
	'3. Set it as the EXTENSHI_API_KEY environment variable in your MCP client ' +
	'config (or run `extenshi login`).\n\n' +
	'Tip: the `search_docs` tool is free and needs no key — use it any time to ' +
	'look up product docs and CLI commands.'

/**
 * Max extensions `get_risk_by_store_ids` accepts per call.
 *
 * CROSS-PACKAGE SYNC POINT — nothing can import across it: this is a published
 * npm package, the enforcing code is `METERED_BATCH_MAX_EXTENSIONS` in
 * `catalog/catalog-bff/src/lib/metered-batch-cap.ts`. The BFF is the authority
 * (it rejects an over-cap metered batch); this constant only keeps the tool
 * schema and description honest so an agent is told the limit up front instead
 * of discovering it as a round-tripped error. Pinned by `tools.test.ts`.
 */
export const MAX_BATCH_EXTENSIONS = 40

export const SERVER_NAME = 'extenshi'

export const SERVER_INSTRUCTIONS =
	'Extenshi helps develop and operate browser extensions. Start extension-development tasks with ' +
	'get_development_guide (free): it lists every tool on this connection, the service directory, ' +
	'account/local prerequisites, documentation links, GitHub repository guidance and the ordered ' +
	'plan from scope and research through code, assets, privacy, CI, store release and maintenance. ' +
	'Keep a checklist covering the whole requested lifecycle. For standalone Pay, start with list_pay_apps; create_pay_app needs no development project or repository. Request explicit pay.read/pay.write scopes, use get_pay_readiness, and leave agreement acceptance and KYC to the author in the browser. Only the publishable SDK key and public verification key belong in extension code. Use search_docs (free) for current ' +
	'product details and exact CLI flags. With identity, call list_my_projects then get_project_state ' +
	'to reuse the existing project and repository. Use list_extension_templates before the manifest, ' +
	'and get_project_scaffold for a new project. Preserve existing source. For an existing extension, read get_project_workspace then preview and apply import_manifest to fill Dojo from its real manifest and default-locale messages before configuring services. Review the integration diff and preserve local edits; write integration.file ' +
	'verbatim to integration.path, check integration.unwired and re-read state after cabinet edits. ' +
	'Check get_credit_balance before metered work. get_risk_by_store_ids covers up to 40 store IDs ' +
	'for one read; get_security costs three reads for detailed findings. Hosted policy tools require ' +
	'Pro; publish_privacy_policy changes the live policy, while update_privacy_policy_with_ai returns ' +
	"a proposal to review. Respect the author's authorization for publication and repository writes. " +
	'Tool registration is not proof of account entitlements or a completed release. Verify hosted ' +
	'URLs, built artifacts, store status and optional purchases before reporting completion. ' +
	`API keys: ${KEY_PAGE}. Credits: ${BILLING_PAGE}.`

/** Match initialize instructions to the same capabilities used for registration. */
export function getServerInstructions(capabilities: ReadonlySet<Capability>): string {
	const local = [
		capabilities.has('scan') ? 'scan_extension' : null,
		capabilities.has('publish') ? 'publish_extension' : null,
	].filter(Boolean)
	return (
		SERVER_INSTRUCTIONS +
		(local.length
			? ` This connection exposes ${local.join(' and ')} for local artifacts; check credentials and access before use.`
			: " This connection has no local artifact scan or store-publishing tool. Use the local stdio server or CLI on the developer's machine for those stages; hosted privacy-policy publishing is a separate capability.")
	)
}

// ── Injected dependencies ───────────────────────────────────────────────────

/** Which tool groups to register on this transport. */
export type Capability = 'read' | 'docs' | 'scan' | 'publish'

/**
 * Minimal structural view of a FastMCP tool-execute context. The real context
 * (passed by FastMCP to `execute`) carries more (`reportProgress`, `log`, …);
 * we only need `session` for per-request identity resolution. Extra props are
 * fine — this is a structural supertype.
 */
export interface ToolCallContext {
	session?: FastMCPSessionAuth
}

export interface ToolDeps {
	/** Base URLs for the BFF (reads), scan backend, and docs site. */
	cfg: { bffUrl: string; scanUrl: string; docsUrl: string }
	/** Tool groups to register. */
	capabilities: ReadonlySet<Capability>
	/**
	 * Build a catalog BFF client for THIS call's identity.
	 * stdio: ignores `ctx`, uses the env key (throws MISSING_KEY if absent).
	 * remote: reads `ctx.session` (already OAuth-authenticated) and binds the
	 * caller's userId.
	 */
	getBff: (ctx: ToolCallContext) => Bff
	/**
	 * Resolve the scan/publish API key for THIS call (paid local ops). Required
	 * only when the 'scan' or 'publish' capability is enabled. stdio supplies
	 * the env key (or throws MISSING_KEY); the remote connector never enables
	 * these capabilities, so it may omit this.
	 */
	requireApiKey?: (ctx: ToolCallContext) => string
	/**
	 * Non-throwing key accessor for the publish-access preflight, which fails
	 * OPEN when no key is present (it must not hard-require a key). Returns the
	 * key or undefined. stdio supplies the (nullable) env key.
	 */
	getApiKey?: (ctx: ToolCallContext) => string | undefined
	/** Optional override of the missing-key message (defaults to MISSING_KEY_MESSAGE). */
	missingKeyMessage?: string
}

// ── Internal helpers (ported from index.ts, now deps-parametrized) ───────────

/**
 * A `UserError` that keeps the error it renders as `cause`.
 *
 * ANY catch-all that turns a caught error into a `UserError` MUST build it here
 * rather than with `new UserError(err.message)`. isExpectedError() reads a
 * missing `cause` as "a message we authored" — i.e. expected — so a hand-rolled
 * wrapper silently drops whatever it caught (a BFF 5xx, a TypeError) from error
 * tracking. That's the bug this helper exists to prevent; the convention is not
 * enforced by the type system, so it lives here and in isExpectedError().
 *
 * Two fastmcp details force this to be a helper rather than
 * `new UserError(msg, { cause })`:
 *  1. `UserError`'s constructor is `(message, extras?)` and passes ONLY the
 *     message to `super()` — an `ErrorOptions` second argument is silently
 *     dropped, so `.cause` would stay undefined.
 *  2. `extras` is not a place to stash the origin either: fastmcp spreads it
 *     into the tool result as `structuredContent`, which would ship the raw
 *     error (stack, internal URLs) to the caller.
 * So set `cause` on the instance. fastmcp never reads it, so nothing leaks — but
 * classifyError()/isExpectedError() can see the origin behind the rendered
 * message instead of guessing from its wording.
 */
function userErrorFrom(message: string, cause: unknown): UserError {
	const err = new UserError(message)
	err.cause = cause
	return err
}

/**
 * Normalize a thrown read error into a user-facing message.
 *
 * NB: this wraps EVERY failure — a BFF 5xx and a plain bug included — so the
 * resulting `UserError` says nothing about whether the failure was expected.
 * That's why the origin is preserved as `cause`: it's the only thing left that
 * can tell a quota gate from a genuine fault. See isExpectedError().
 */
function readError(err: unknown, missingKeyMessage: string): never {
	if (err instanceof UserError) throw err
	const message = err instanceof Error ? err.message : String(err)
	// A 401 means the BFF rejected the key (enforcement landed / key invalid).
	if (/unauthorized|401|api key/i.test(message)) {
		throw userErrorFrom(`Request rejected — ${message}\n\n${missingKeyMessage}`, err)
	}
	throw userErrorFrom(message, err)
}

/** Map a scan backend failure to an actionable next step. */
function scanErrorMessage(err: ScanError, missingKeyMessage: string): string {
	switch (err.status) {
		case 401:
			return `Authentication failed: ${err.message}\n\n${missingKeyMessage}`
		case 402:
			return `Out of scan credits. Buy a scan pack at ${BILLING_PAGE} to continue — the one-time free allowance (3 scans) does not renew.`
		case 403:
			// FREE_REQUIRES_* came from the pre-credit-pack backend (free scans
			// were gated on verified ownership). Kept for skew with old backends.
			if (err.errorCode === 'FREE_REQUIRES_CLAIM' || err.errorCode === 'FREE_REQUIRES_VERIFIED_OWNERSHIP') {
				return `${err.message}\n\nBuy a scan pack at ${BILLING_PAGE} to scan arbitrary artifacts.`
			}
			return `Access denied: ${err.message}`
		case 429:
			return `Rate limited — wait ${err.retryAfterSec ?? 60}s before trying again.`
		default:
			return err.message
	}
}

/**
 * Error classes that are EXPECTED, user-facing conditions rather than faults:
 * the caller ran out of their free allowance (`quota`), got rate limited
 * (`rate_limit`), or supplied a bad/absent key (`auth`). These surface to the
 * user as an actionable message — they are not code exceptions, so they must
 * NOT be shipped to error tracking (otherwise a routine billing gate mints a
 * bogus, self-reopening issue). See classifyError() in ./telemetry.ts.
 */
const EXPECTED_ERROR_KINDS = new Set(['quota', 'rate_limit', 'auth'])

/**
 * True when a thrown error is an expected, user-facing condition rather than a
 * bug worth an exception report.
 *
 * `UserError` alone can't answer this. It has two jobs in this file: messages we
 * AUTHORED for the caller ("No extension found …", the missing-key help), and a
 * last-resort wrapper the catch-alls put around anything that escaped (readError,
 * the docs/scan handlers). Treating every `UserError` as expected would let that
 * second group launder a BFF 500 or a plain TypeError into "expected" and drop it
 * from error tracking — so the two are told apart by `cause`:
 *
 *   - authored (no `cause`)  → expected by construction: we wrote the message.
 *   - wrapping (has `cause`) → only as expected as what it wraps; classifyError
 *     follows the chain, so a 429 gate stays expected and a 500 does not.
 *
 * Corollary for anything that wraps a caught error: build it with
 * userErrorFrom(), or it reads as authored and its origin never gets captured.
 *
 * `kind` defaults to classifying `err`; pass one to reuse a classification the
 * caller already made, so the reported `error_kind` and this decision can't
 * disagree.
 */
export function isExpectedError(err: unknown, kind: string = classifyError(err)): boolean {
	if (EXPECTED_ERROR_KINDS.has(kind)) return true
	return err instanceof UserError && err.cause === undefined
}

/**
 * Attribution for a tool call, lifted from the session the surface supplies.
 *
 * Local stdio has no session at all, so both fields come back undefined and
 * captureEvent falls back to the per-install anonymous id — unchanged behaviour.
 * The hosted connector authenticates every request, so it supplies both: the
 * account id becomes the PostHog distinct_id, and the connection id threads one
 * client's calls together (see tools/extenshi-mcp-server/src/identity.ts, which
 * mints it per `authenticate()` — i.e. per connection, NOT per cached token).
 *
 * Read defensively: `session` is FastMCP's opaque auth record, and a surface
 * that carries neither field must degrade to the local behaviour rather than
 * throw inside instrumentation.
 */
function attribution(session: unknown): { userId?: string; sessionId?: string } {
	if (!session || typeof session !== 'object') return {}
	const s = session as Record<string, unknown>
	return {
		userId: typeof s.userId === 'string' && s.userId ? s.userId : undefined,
		sessionId: typeof s.sessionId === 'string' && s.sessionId ? s.sessionId : undefined,
	}
}

/**
 * Wrap a tool definition so every call is reported: which tool ran, how long it
 * took, and how it failed (coarse error_kind + sanitized exception). On the
 * hosted connector the report also carries WHO — the authenticated account id —
 * and which connection it belonged to; on local stdio it stays anonymous. Never
 * the arguments, never the result. The generic preserves the Zod-inferred
 * `args` type — `parameters` fixes Params, so the inner execute stays as
 * strongly typed as before.
 * Fail-soft: telemetry never alters the tool's result or its thrown error.
 */
/**
 * Publish every tool's input schema with all `$ref`s inlined.
 *
 * fastmcp converts `parameters` through xsschema, which runs zod-to-json-schema
 * with its default `$refStrategy: 'root'`: every zod instance used twice in one
 * schema (the shared `digest`, `provenanceSchema` strings, …) becomes a bare
 * `{"$ref": "#/properties/…"}` with no `type`. The Claude connector directory
 * rejects those ("Add a type to this parameter: inputDigest"), and weaker MCP
 * clients cannot resolve them either. xsschema prefers a Standard JSON Schema
 * `jsonSchema` hook when one is present, so we supply an inlined conversion
 * there; validation still goes through the original zod `~standard.validate`.
 */
function withInlinedJsonSchema<Params extends ToolParameters>(parameters: Params): Params {
	const input = () => zodToJsonSchema(parameters as unknown as z.ZodTypeAny, { $refStrategy: 'none' })
	return Object.create(parameters, {
		'~standard': { value: { ...parameters['~standard'], jsonSchema: { input, output: input } } },
	}) as Params
}

function instrument<Params extends ToolParameters>(
	tool: Tool<FastMCPSessionAuth, Params>,
): Tool<FastMCPSessionAuth, Params> {
	const { name } = tool
	const original = tool.execute
	return {
		...tool,
		execute: async (args, context) => {
			// The hosted connector lets a user decline analytics on the consent
			// screen; honour it for every event, including error reports.
			if ((context.session as { telemetry?: unknown } | undefined)?.telemetry === false)
				return original(args, context)
			const startedAt = Date.now()
			const { userId, sessionId } = attribution(context.session)
			const props = { tool: name, ...(sessionId ? { mcp_session_id: sessionId } : {}) }
			captureEvent('mcp_tool_called', props, userId)
			try {
				const result = await original(args, context)
				captureEvent('mcp_tool_succeeded', { ...props, duration_ms: Date.now() - startedAt }, userId)
				return result
			} catch (err) {
				// Classified once and threaded into both uses below: the reported
				// error_kind and the capture decision must never disagree about what
				// this failure was.
				const kind = classifyError(err)
				// The failure count is always tracked, so we keep visibility into
				// how often callers hit each condition (incl. the billing gate).
				captureEvent(
					'mcp_tool_failed',
					{ ...props, error_kind: kind, duration_ms: Date.now() - startedAt },
					userId,
				)
				// …but only genuine faults are shipped as exceptions. Expected
				// user-facing conditions (a quota gate, a bad key, a message we
				// authored) are not bugs and must not open error-tracking issues.
				if (!isExpectedError(err, kind)) captureError(err, { tool: name })
				throw err
			}
		},
	}
}

// ── Extension reference (numeric catalog id OR store id) ─────────────────────

/**
 * The shared parameter shape for "which extension" across the read tools. A
 * caller may point at an extension EITHER by its numeric catalog `extension_id`
 * (from search_extensions, as before) OR by its public `store_id` — the id in
 * the store URL — which is often the only precise identifier an agent has.
 *
 * `extension_id` is now optional (it used to be required); this is
 * backward-compatible — existing callers that pass it are unaffected, and
 * resolveExtensionId() enforces that exactly one form is supplied.
 */
const EXTENSION_REF_SHAPE = {
	extension_id: z.number().int().optional().describe('Numeric catalog ID (from search_extensions results).'),
	store_id: z
		.string()
		.min(1)
		.max(100)
		.optional()
		.describe(
			'Alternative to extension_id: the extension’s id in its store URL (e.g. Chrome ' +
				'"cjpalhdlnbpafiamejdnhcphjbkeiagm"). A Chrome/Edge id (32 letters a–p) also requires ' +
				'`store`: both stores share that format. Firefox ids (slug / GUID / email) are ' +
				'unambiguous. Resolving a store_id is free; only the read that follows costs a credit.',
		),
	store: z
		.enum(['CHROME', 'FIREFOX', 'EDGE'])
		.optional()
		.describe('Which store `store_id` belongs to. REQUIRED for Chrome/Edge ids (identical format).'),
} as const

/** The subset of {@link EXTENSION_REF_SHAPE}'s parsed args resolveExtensionId reads. */
type ExtensionRefArgs = {
	extension_id?: number
	store_id?: string
	store?: 'CHROME' | 'FIREFOX' | 'EDGE'
}

/**
 * Resolve an extension reference to a numeric catalog id. Prefers an explicit
 * `extension_id`; otherwise resolves `store_id` (+ `store`) via the FREE
 * `resolveExtensionRef` BFF endpoint — so a store-id read costs exactly one
 * credit (the read itself), never two. Throws an actionable UserError when
 * neither form is supplied, when the store id is ambiguous/invalid (surfaced from
 * the backend as an authored message, so it reads as expected — not a fault), or
 * when no catalog listing exists for it yet.
 */
async function resolveExtensionId(client: Bff, args: ExtensionRefArgs): Promise<number> {
	if (typeof args.extension_id === 'number') return args.extension_id
	if (args.store_id) {
		let ref: Awaited<ReturnType<Bff['resolveExtensionRef']>>
		try {
			ref = await client.resolveExtensionRef({ storeId: args.store_id, store: args.store })
		} catch (err) {
			// A BAD_REQUEST is a caller-input problem (ambiguous/invalid store id),
			// not a fault: re-throw the backend's message as an authored UserError so
			// it surfaces to the agent as guidance and doesn't open a tracking issue.
			const code = (err as { data?: { code?: string } } | null)?.data?.code
			if (code === 'BAD_REQUEST') throw new UserError(err instanceof Error ? err.message : String(err))
			throw err
		}
		if (!ref) {
			throw new UserError(
				`No catalog extension found for store id "${args.store_id}"${args.store ? ` in ${args.store}` : ''}. ` +
					'It may not be in the catalog yet — try search_extensions by name, or double-check the id.',
			)
		}
		return ref.id
	}
	throw new UserError(
		'Specify the extension: pass extension_id (numeric catalog id from search_extensions) OR ' +
			'store_id (the id in the store URL; add `store` for a Chrome/Edge id).',
	)
}

/**
 * Optional variant for tools where the extension link is not required (scan
 * association): returns the resolved id, or undefined when NEITHER form is given.
 * A supplied-but-unresolvable store_id still throws (via resolveExtensionId) so a
 * typo is caught before a scan credit is spent, rather than silently dropped.
 */
async function resolveOptionalExtensionId(client: Bff, args: ExtensionRefArgs): Promise<number | undefined> {
	if (typeof args.extension_id !== 'number' && !args.store_id) return undefined
	return resolveExtensionId(client, args)
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * MCP tool annotations (spec: title + behaviour hints). REQUIRED for the
 * Anthropic Connectors Directory — its submission portal auto-syncs tools and
 * refuses to submit any tool missing a `title` or a read/write hint. Kept as a
 * name→annotation map (not inline per tool) so the read/write split is auditable
 * in one place. Hosted policy publication writes a public page; scan uploads an artifact
 * (not read-only, not destructive); publish writes to public stores (destructive).
 */
const TOOL_ANNOTATIONS: Record<
	string,
	{
		title: string
		readOnlyHint?: boolean
		destructiveHint?: boolean
		idempotentHint?: boolean
		openWorldHint?: boolean
	}
> = {
	search_extensions: {
		title: 'Search extension catalog',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_extension: {
		title: 'Get extension details',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_reviews: {
		title: 'Get extension reviews',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_security: {
		title: 'Get extension security analysis',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_risk_by_store_ids: {
		title: 'Bulk risk lookup by store id',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	market_overview: {
		title: 'Catalog market overview',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_credit_balance: {
		title: 'Check credit balance',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_development_guide: {
		title: 'Extension development services and workflow',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	search_docs: {
		title: 'Search Extenshi documentation',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	list_extension_templates: {
		title: 'Extension types and their permissions',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	list_my_projects: {
		title: 'List my extension projects',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_project_state: {
		title: 'Read my project state',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_project_scaffold: {
		title: 'Get my starter extension files',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	list_privacy_policy_versions: {
		title: 'List hosted privacy policy versions',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	get_privacy_policy_version: {
		title: 'Read a privacy policy version',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	publish_privacy_policy: {
		title: 'Publish a hosted privacy policy',
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: true,
	},
	update_privacy_policy_with_ai: {
		title: 'Update a privacy policy with AI',
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: true,
	},
	localize_workflow: {
		title: 'Local extension localization workflow',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	generate_icon_workflow: {
		title: 'Icon design workflow guide',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	generate_welcome_page_workflow: {
		title: 'Welcome page design brief',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	generate_landing_page: {
		title: 'Generate a static landing page',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	scan_extension: {
		title: 'Scan an extension package',
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: true,
	},
	publish_extension: {
		title: 'Publish extension to stores',
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: true,
	},
	create_ci_ingest_secret: {
		title: 'Create or rotate the CI evidence ingest secret',
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: true,
	},
	upsert_hosted_page: {
		title: 'Register a hosted page URL',
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: true,
	},
	verify_hosted_artifact: {
		title: 'Verify a hosted page matches its record',
		readOnlyHint: false,
		idempotentHint: true,
		destructiveHint: false,
		openWorldHint: true,
	},
	list_hosted_pages: {
		title: 'List hosted page registrations',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	publish_landing_page: {
		title: 'Publish a landing page on extenshi.io',
		readOnlyHint: false,
		idempotentHint: false,
		destructiveHint: false,
		openWorldHint: true,
	},
	get_landing_page: {
		title: 'Read the hosted landing page',
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	unpublish_landing_page: {
		title: 'Unpublish the hosted landing page',
		readOnlyHint: false,
		idempotentHint: true,
		destructiveHint: true,
		openWorldHint: true,
	},
	remove_hosted_page: {
		title: 'Remove a hosted page registration',
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: true,
	},
}

/**
 * LandingForm fields shared by generate_landing_page (offline HTML) and
 * publish_landing_page (hosted on page.extenshi.io). Limits match the builder
 * and the BFF, so a form valid for one is valid for the other.
 */
const LANDING_FORM_SHAPE = {
	extensionName: z.string().min(1).max(LANDING_LIMITS.extensionName).describe('Extension display name.'),
	tagline: z.string().max(LANDING_LIMITS.tagline).optional().describe('One-line promise under the name.'),
	description: z
		.string()
		.max(LANDING_LIMITS.description)
		.optional()
		.describe('Short paragraph on what the extension does; also the meta description.'),
	accentColor: z
		.string()
		.max(9)
		.optional()
		.describe('Hex accent colour for the primary button and monogram (default #5e5ce6).'),
	theme: z.enum(['light', 'dark']).optional().describe('Page colour scheme (default dark).'),
	chromeUrl: z
		.string()
		.max(LANDING_LIMITS.url)
		.optional()
		.describe('Chrome Web Store listing URL. Empty or omitted hides the Chrome button.'),
	firefoxUrl: z
		.string()
		.max(LANDING_LIMITS.url)
		.optional()
		.describe('Firefox Add-ons listing URL. Empty or omitted hides the Firefox button.'),
	edgeUrl: z
		.string()
		.max(LANDING_LIMITS.url)
		.optional()
		.describe('Edge Add-ons listing URL. Empty or omitted hides the Edge button.'),
	privacyPolicyUrl: z
		.string()
		.max(LANDING_LIMITS.url)
		.optional()
		.describe('Privacy policy URL for the footer (for example the hosted privacy.extenshi.io page).'),
	supportUrl: z
		.string()
		.max(LANDING_LIMITS.url)
		.optional()
		.describe(
			'Support link for the footer: an http(s) URL, or a single mailto: address (optionally ' +
				'?subject= with a percent-encoded value).',
		),
	homepageUrl: z
		.string()
		.max(LANDING_LIMITS.url)
		.optional()
		.describe(
			'Public https URL the page will be served from: canonical link, og:url, JSON-LD url, and the ' +
				'base for relative screenshot paths in og:image.',
		),
	features: z
		.array(
			z.object({
				title: z.string().max(LANDING_LIMITS.featureTitle),
				description: z.string().max(LANDING_LIMITS.featureDescription).optional(),
			}),
		)
		.max(LANDING_LIMITS.features)
		.optional()
		.describe('Feature cards; entries with an empty title are skipped.'),
	screenshots: z
		.array(
			z.object({
				url: z.string().max(LANDING_LIMITS.url),
				alt: z.string().max(LANDING_LIMITS.screenshotAlt).optional(),
			}),
		)
		.max(LANDING_LIMITS.screenshots)
		.optional()
		.describe(
			'Screenshots as https URLs (for example store screenshots from get_extension) or paths ' +
				'relative to index.html, each with alt text.',
		),
	logoSvg: z
		.string()
		.max(LANDING_LIMITS.logoSvgBytes)
		.optional()
		.describe(
			'Inline SVG logo source. Refused (monogram shown, reason in warnings) if it contains ' +
				'scripts, event handlers, foreignObject, animation, entity references or non-fragment hrefs.',
		),
	logoUrl: z
		.string()
		.max(LANDING_LIMITS.logoUrl)
		.optional()
		.describe('Logo image as an https URL, a relative path, or a data:image/(png|jpeg|gif|webp);base64 URL.'),
}

/**
 * Register the Extenshi tools once on a FastMCP server.
 * Only the tools whose capability is present in `deps.capabilities` are added.
 */
export function registerTools(server: FastMCP, deps: ToolDeps): void {
	const registeredTools: GuideTool[] = []
	const caps = deps.capabilities
	const missingKeyMessage = deps.missingKeyMessage ?? MISSING_KEY_MESSAGE
	// Generic so each tool's Zod `parameters` infers its own `args` type (a
	// non-generic wrapper would collapse Params to `never`).
	function add<P extends ToolParameters>(tool: Tool<FastMCPSessionAuth, P>): void {
		// Attach the directory-required annotations (title + read/write hint) from
		// the central map; an explicit `tool.annotations` (none today) still wins.
		const annotations = {
			...TOOL_ANNOTATIONS[tool.name],
			...tool.annotations,
			title: tool.annotations?.title ?? TOOL_ANNOTATIONS[tool.name]?.title ?? tool.name.replaceAll('_', ' '),
		}
		const parameters = tool.parameters && withInlinedJsonSchema(tool.parameters)
		server.addTool(instrument({ ...tool, annotations, ...(parameters ? { parameters } : {}) }))
		registeredTools.push({ name: tool.name, description: tool.description ?? '', annotations })
	}
	// Per-call helpers bound to the injected deps.
	const bff = (ctx: ToolCallContext): Bff => deps.getBff(ctx)
	const requireApiKey = (ctx: ToolCallContext): string => {
		if (!deps.requireApiKey) throw new UserError(missingKeyMessage)
		return deps.requireApiKey(ctx)
	}

	// ── Read tools (free; key/identity required) ───────────────────────────────
	if (caps.has('read')) {
		for (const [method, name, , , mutation, description] of PAY_OPERATIONS) {
			add({
				name,
				description: `${description} Requires ${mutation ? 'pay.write' : 'pay.read'} permission.`,
				parameters: paySchemas[method],
				annotations: {
					readOnlyHint: !mutation,
					destructiveHint: mutation,
					idempotentHint: !['createPayApp', 'connectPaySeller', 'rotatePayKey'].includes(method),
					openWorldHint: true,
				},
				execute: async (args, context) => {
					try {
						const invoke = bff(context)[method] as (input: typeof args) => Promise<unknown>
						return JSON.stringify(await invoke(args))
					} catch (err) {
						if (err instanceof UserError && /^MCP_SCOPE_REQUIRED:pay\.(read|write)\./.test(err.message))
							throw err
						const status = (err as { data?: { httpStatus?: number } } | null)?.data?.httpStatus
						// Only OUR authored backend messages are matched, never echoed, so a
						// provider string can't leak through; they pick the precise guidance.
						const backendMessage = err instanceof Error ? err.message : ''
						const message =
							status === 403
								? 'Pay access denied. Grant pay.read/pay.write explicitly and verify application ownership.'
								: status === 412 && backendMessage.includes('Pay application is archived')
									? 'This Pay application is archived. Use an active application from list_pay_apps, or create a new one.'
									: status === 412
										? 'Pay prerequisites are incomplete. Read get_pay_readiness; the author completes legal acceptance and Stripe KYC in the browser.'
										: status === 404 && backendMessage.includes('No payment gateway connected')
											? 'No payment provider is connected to this Pay application yet. Call connect_pay_seller and have the author finish onboarding in the browser, then retry.'
											: status === 404
												? 'Pay application or resource not found. Check the appId with list_pay_apps.'
												: status === 401
													? 'Pay authentication failed. Reconnect or configure a developer API key with explicit Pay permissions.'
													: 'Pay request failed. Check authentication, application readiness and backend support before retrying a mutation.'
						// Provider failures may contain customer data or credentials; never echo them.
						throw userErrorFrom(message, err)
					}
				},
			})
		}

		add({
			name: 'import_manifest',
			description:
				'Import an existing manifest.json into the Dojo manifest editor and project labels. Input: parsed JSON and optional default-locale messages. Source import fills supported fields and preserves all other JSON; built imports remain separate observations. Default dryRun=true returns changes and expectedStateHash without writing; dryRun=false with that hash applies them. Does not infer data collection, prices, or publication. Requires project.write.' +
				PROVENANCE_HINT,
			parameters: importManifestSchema,
			annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).importManifest(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		const reads = [
			[
				'get_project_workspace',
				'Read revisioned source/built manifests, repository metadata, scope and release snapshot. These are observations, separate from scaffold drafts.',
				'getProjectWorkspace',
			],
			[
				'get_release_readiness',
				'Explain readiness for the recorded browser and artifact by locale. Local or agent reports are not treated as CI attestations. Stale evidence does not pass. Requires a Pro project. ' +
					'Readiness is measured against the release recorded in the workspace: until apply_project_patch sets patch.release ' +
					'(browser, version, artifactDigest, manifestDigest, locales, paymentRequired, and commit or dirtyTreeDigest) it reports ' +
					'RELEASE_NOT_RECORDED; after that, evidence counts only when it matches that release artifactDigest. ' +
					"When the project has a linked Pay application, the payment check also carries `platform`: what Extenshi's own " +
					'payment ledger proves (checkout, license, installation activation, recovery, refund). A live-mode purchase through ' +
					"those stages passes the check with source 'platform'; test-mode purchases are listed without passing it. Clients cannot " +
					"record source 'platform'.",
				'getReleaseReadiness',
			],
		] as const
		for (const [name, description, method] of reads)
			add({
				name,
				description,
				annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
				parameters: z.object({
					projectId: z.string().uuid(),
					browser: z
						.enum(['chrome', 'firefox', 'edge'])
						.optional()
						.describe('Release status: select a browser from release history.'),
					artifactDigest: z
						.string()
						.regex(/^[a-f0-9]{64}$/)
						.optional()
						.describe('Release status: select the exact artifact from history.'),
				}),
				execute: async (args, context) => {
					try {
						return JSON.stringify(await bff(context)[method](args))
					} catch (err) {
						return readError(err, missingKeyMessage)
					}
				},
			})
		add({
			name: 'connection_diagnostics',
			description:
				'Verify authentication, granted scopes, supported workspace contracts and actual write permissions (incl. hosted.write, evidence uploads and, for a projectId, CI ingest configuration). Includes credit balances; credentials and secrets are not included. Auth failures are recoverable with `extenshi login --recover` (CLI) or a reissued API key from dojo.extenshi.io/api-keys.',
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
			parameters: z.object({}),
			execute: async (_args, context) => {
				try {
					const client = bff(context)
					const [connection, balance] = await Promise.all([
						client.connectionDiagnostics(),
						client.getApiCallerBalance(),
					])
					return JSON.stringify({ connection, balance, registeredTools: registeredTools.map((t) => t.name) })
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		for (const [name, method, dryRun] of [
			['diff_project_state', 'diffProjectWorkspace', true],
			['apply_project_patch', 'patchProjectWorkspace', false],
		] as const)
			add({
				name,
				description: dryRun
					? `Preview a three-way metadata diff against a server-held base revision. No writes.${PROVENANCE_HINT}`
					: `Apply a typed project metadata patch with expectedRevision and idempotencyKey. Source and built manifests are stored separately, including unknown keys. Omitted fields are left unchanged; tombstones explicitly delete. No source upload or scaffold overwrite. patch.release records the release that get_release_readiness measures against. Requires project.write OAuth scope.${PROVENANCE_HINT}`,
				annotations: {
					readOnlyHint: dryRun,
					idempotentHint: true,
					destructiveHint: !dryRun,
					openWorldHint: true,
				},
				parameters: workspacePatchSchema,
				execute: async (args, context) => {
					try {
						return JSON.stringify(await bff(context)[method](args))
					} catch (err) {
						return readError(err, missingKeyMessage)
					}
				},
			})
		add({
			name: 'create_ci_ingest_secret',
			description:
				'Create or rotate the per-project secret the extenshi-evidence-action uses to POST CI evidence (POST /projects/:id/evidence/ingest). The secret is returned only once; the action reads it from the repository GitHub Actions secret EXTENSHI_EVIDENCE_SECRET. Not idempotent: creating again invalidates the previous secret. Requires project.write.',
			annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true },
			parameters: z.object({ projectId: z.string().uuid() }),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).createCiIngestSecret(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'upsert_hosted_page',
			description: `Register the project's homepage or support page URL (HTTPS only; the server fetches the public page and hashes the body, so the URL has to be publicly reachable). The registered homepage URL feeds HOMEPAGE_URL when the integration config file is regenerated. Requires hosted.write. API reference: ${HOSTED_PAGES_DOCS}`,
			annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
			parameters: z.object({
				projectId: z.string().uuid(),
				kind: z.enum(['homepage', 'support']),
				url: z.string().url().max(2000),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).upsertHostedPage(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'verify_hosted_artifact',
			description: `Verify a hosted page actually serves what its record says: re-fetches and compares content. kind=homepage|support compares against the registered body hash (verified | changed | unreachable); kind=privacy checks the published policy version's HTML is what the public page really serves. Requires hosted.write. API reference: ${HOSTED_PAGES_DOCS}`,
			annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
			parameters: z.object({
				projectId: z.string().uuid(),
				kind: z.enum(['homepage', 'support', 'privacy']),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).verifyHostedArtifact(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'remove_hosted_page',
			description: `Remove the project's registered homepage or support page — for a project moving off a URL or a mis-registered address. The public page itself keeps working; only the project record is forgotten. Requires hosted.write. API reference: ${HOSTED_PAGES_DOCS}`,
			annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
			parameters: z.object({
				projectId: z.string().uuid(),
				kind: z.enum(['homepage', 'support']),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).removeHostedPage(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'publish_landing_page',
			description:
				"Publish the project's landing page (homepage) on Extenshi hosting — the same page " +
				'generate_landing_page returns, rendered server-side from the form (no caller HTML is stored) and ' +
				'served at page.extenshi.io/{code}, or https://{custom-domain}/landing when the project has an ' +
				'active custom domain. The code is permanent: republishing creates a new version at the same URL. ' +
				'By default the URL is also registered as the project homepage, which feeds HOMEPAGE_URL. Hosted ' +
				'images are limited to store screenshot URLs (from get_extension) and images uploaded in the Dojo ' +
				'Page generator; the logo may be an inline SVG or a raster data: URL. Returns JSON {url, publicCode, ' +
				'versionNumber, contentHash, bytes, warnings, homepage, nextSteps}. Requires hosted.write. ' +
				`API reference: ${HOSTED_PAGES_DOCS}`,
			parameters: z.object({
				projectId: z.string().uuid(),
				registerAsHomepage: z
					.boolean()
					.optional()
					.describe(
						'Register the URL as the project homepage (default true). False keeps an existing homepage.',
					),
				...LANDING_FORM_SHAPE,
			}),
			execute: async (args, context) => {
				const { projectId, registerAsHomepage, ...fields } = args
				try {
					const result = (await bff(context).publishLandingPage({
						projectId,
						registerAsHomepage,
						form: landingFormFromArgs(fields) as unknown as Record<string, unknown>,
					})) as Record<string, unknown>
					return JSON.stringify({ ...result, nextSteps: hostedLandingNextSteps(result) })
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'get_landing_page',
			description:
				"The project's hosted landing page: public code, live version, publish state, URL (null when " +
				'unpublished) and the form the live version was rendered from.',
			parameters: z.object({ projectId: z.string().uuid() }),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).getLandingPage(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'unpublish_landing_page',
			description:
				'Take the hosted landing page offline (it answers 404). The public code and version history are ' +
				'kept, so publishing again restores the same URL. A homepage registration that points at this ' +
				`page is removed with it. Requires hosted.write. API reference: ${HOSTED_PAGES_DOCS}`,
			parameters: z.object({ projectId: z.string().uuid() }),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).unpublishLandingPage(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'list_hosted_pages',
			description:
				'List the project registered hosted pages (homepage/support) with their verification status, content hash and last check time.',
			annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
			parameters: z.object({ projectId: z.string().uuid() }),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).listHostedPages(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'record_project_evidence',
			description:
				'Record test/scan/listing/privacy/payment evidence metadata bound to a browser, artifact hash and input hash. Source is local or agent; CI evidence is written only by the verified ingest endpoint. Attachment files upload via the CLI (extenshi evidence push --attach); this tool records metadata only. Requires evidence.write OAuth scope.' +
				PROVENANCE_HINT,
			annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
			parameters: agentEvidenceSchema,
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).recordProjectEvidence(args))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'search_extensions',
			description:
				'Search the cross-store extension catalog (Chrome, Firefox, Edge) with hybrid relevance. ' +
				'All filters (rating/reviews thresholds, store, category, pricing, risk, permissions, ' +
				'freshness, manifest version, trader status) are applied server-side by the catalog ' +
				'database, so a filtered request returns only the matching subset. `skip` pages through ' +
				'large result sets. ' +
				`${describeStoreConstraints()} ` +
				'Returns a compact list for market research and competitive analysis.',
			parameters: z.object({
				query: z.string().optional().describe('Free-text search query (name, description, keywords).'),
				stores: z
					.array(z.enum(['CHROME', 'FIREFOX', 'EDGE']))
					.optional()
					.describe('Stores to search: CHROME, FIREFOX and/or EDGE.'),
				categories: z.array(z.string()).optional().describe('Catalog category slugs to include.'),
				pricing: z
					.array(z.enum(['FREE', 'FREEMIUM', 'IN_APP_PURCHASES', 'SUBSCRIPTION']))
					.optional()
					.describe('Pricing models to include.'),
				risk: z
					.array(z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']))
					.optional()
					.describe('Risk categories to include.'),
				permissions: z.array(z.string()).optional().describe('Only extensions requesting these permissions.'),
				minRating: z.number().min(0).max(5).optional().describe('Only ratings ≥ this (0–5).'),
				maxRating: z.number().min(0).max(5).optional().describe('Only ratings ≤ this (0–5).'),
				minWeeklyDownloads: z
					.number()
					.min(0)
					.optional()
					.describe(
						'Minimum weekly downloads — FIREFOX-ONLY metric (not reported by Chrome/Edge). ' +
							'Chrome/Edge popularity is available through sortBy:"popular". A request combining ' +
							'it with a Chrome/Edge-only `stores` filter is rejected.',
					),
				minReviews: z.number().min(0).optional().describe('Minimum number of store reviews/ratings.'),
				updatedWithin: z
					.enum(['30d', '90d', '1y', 'stale'])
					.optional()
					.describe('Freshness: updated within 30d / 90d / 1y, or "stale" (older than 1y).'),
				manifestVersions: z
					.array(z.union([z.literal(2), z.literal(3)]))
					.optional()
					.describe('Manifest version(s): 2 and/or 3.'),
				traderStatuses: z
					.array(z.enum(['TRADER', 'NON_TRADER']))
					.optional()
					.describe('EU DSA trader status.'),
				monetizationModels: z
					.array(z.enum(['FREE', 'ONE_TIME', 'SUBSCRIPTION', 'FREEMIUM', 'DONATIONS', 'ADS']))
					.optional()
					.describe('Author-declared monetization model (questionnaire).'),
				hasPaywall: z.boolean().optional().describe('Author-declared paywall present.'),
				isOpenSource: z.boolean().optional().describe('Author-declared open source.'),
				noTelemetry: z.boolean().optional().describe('Author-declared no telemetry.'),
				collectsHealthData: z.boolean().optional().describe('Author-declared collects health data.'),
				includeDelisted: z
					.boolean()
					.optional()
					.describe('Whether extensions whose store listing was removed are included (default: excluded).'),
				sortBy: z
					.enum(['relevance', 'popular', 'rating', 'recent', 'name', 'safety', 'trader', 'size'])
					.optional()
					.describe('Sort field (default: popular, or relevance when a query is given).'),
				sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc).'),
				skip: z.number().int().min(0).optional().describe('Offset for pagination (default: 0).'),
				limit: z.number().int().min(1).max(25).default(20).describe('Max results to return (1–25).'),
			}),
			execute: async (args, context) => {
				try {
					const conflict = validateSearchFilters(args as Record<string, unknown>)
					if (conflict) throw new UserError(conflict)
					const limit = args.limit ?? 20
					const result = await bff(context).searchExtensions({
						query: args.query,
						stores: args.stores,
						categories: args.categories,
						pricingModels: args.pricing,
						riskCategories: args.risk,
						permissions: args.permissions,
						minRating: args.minRating,
						maxRating: args.maxRating,
						minWeeklyDownloads: args.minWeeklyDownloads,
						minReviews: args.minReviews,
						updatedWithin: args.updatedWithin,
						manifestVersions: args.manifestVersions,
						traderStatuses: args.traderStatuses,
						monetizationModels: args.monetizationModels,
						hasPaywall: args.hasPaywall,
						isOpenSource: args.isOpenSource,
						noTelemetry: args.noTelemetry,
						collectsHealthData: args.collectsHealthData,
						includeDelisted: args.includeDelisted,
						sortBy: args.sortBy ?? (args.query ? 'relevance' : 'popular'),
						sortOrder: args.sortOrder,
						skip: args.skip,
						take: limit,
					})
					return renderCatalogPayload(shapeSearch(result, limit))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_extension',
			description:
				'Get full catalog detail for one extension: metadata, per-store ratings, install counts, ' +
				'categories, and a security badge. Identify it by numeric catalog `extension_id` OR by its ' +
				'`store_id` (the id in the store URL; add `store` for a Chrome/Edge id).',
			parameters: z.object({ ...EXTENSION_REF_SHAPE }),
			execute: async (args, context) => {
				try {
					const client = bff(context)
					const extensionId = await resolveExtensionId(client, args)
					const result = await client.getExtensionById(extensionId)
					if (!result) throw new UserError(`No extension found with catalog ID ${extensionId}.`)
					return renderCatalogPayload(shapeExtension(result))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_reviews',
			description:
				'Get store user reviews for one extension from Firefox Add-ons and Edge Add-ons: star rating, ' +
				'a short review excerpt, date and language, plus a store-level `aggregate` (rating, count, ' +
				'reviews link). Chrome Web Store review rows are NOT returned (their text cannot be redistributed) — ' +
				'for a Chrome extension the `aggregate` (with a link to the store reviews tab) is the only public ' +
				'review content. Reviewer identity is intentionally omitted. ' +
				'Paginated newest-first by default (or by highest rating); `cursor` takes the `nextCursor` ' +
				'from a previous call. Cursors are sort-specific: a cursor is valid only with the `sort` ' +
				'it was issued for. Reads existing scraped reviews; `min_rating` narrows to positive or ' +
				'critical feedback.',
			parameters: z.object({
				...EXTENSION_REF_SHAPE,
				limit: z.number().int().min(1).max(50).default(20).describe('Max reviews to return (1–50).'),
				cursor: z
					.number()
					.int()
					.optional()
					.describe('Pagination cursor: the `nextCursor` value returned by a previous call.'),
				language_id: z.number().int().optional().describe('Only reviews in this catalog language id.'),
				min_rating: z
					.number()
					.int()
					.min(1)
					.max(5)
					.optional()
					.describe('Only reviews with a star rating ≥ this (1–5).'),
				sort: z
					.enum(['recent', 'rating'])
					.optional()
					.describe('Order by newest first (default) or highest rating.'),
			}),
			execute: async (args, context) => {
				try {
					const client = bff(context)
					const extensionId = await resolveExtensionId(client, args)
					const limit = args.limit
					const result = await client.getReviews({
						extensionId,
						limit,
						cursor: args.cursor,
						languageId: args.language_id,
						minRating: args.min_rating,
						sort: args.sort ?? 'recent',
					})
					return renderCatalogPayload(shapeReviews(result, limit))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_security',
			description:
				'Get the security analysis for an extension: safety score (0–100, higher = safer — the ' +
				'same coefficient the website shows), risk category, finding counts by ' +
				'severity, and the top grouped findings (scanner, rule, severity, count). Also returns ' +
				'an approximate install-dialog preview computed from the store-listed permissions ' +
				'(consolidated + deduped), available even for unscanned extensions. Reads existing scan results — does not trigger a new scan. ' +
				'Identify the extension by numeric `extension_id` OR `store_id` (+`store` for Chrome/Edge). ' +
				'NB: this tool costs 3 read credits (it fetches security, risk, and install-preview data).',
			parameters: z.object({ ...EXTENSION_REF_SHAPE }),
			execute: async (args, context) => {
				try {
					const client = bff(context)
					const extensionId = await resolveExtensionId(client, args)
					// getExtensionById carries `installDialogPreview` (a manifest transform,
					// independent of scanning) — fetch it alongside the scan data so the
					// security view always includes the install prompt the user would see.
					const [security, riskSummary, extension] = await Promise.all([
						client.getSecurityData(extensionId).catch(() => null),
						client.getRiskSummary(extensionId).catch(() => null),
						client.getExtensionById(extensionId).catch(() => null),
					])
					const installDialogPreview =
						extension && typeof extension === 'object'
							? (extension as Record<string, unknown>).installDialogPreview
							: null
					return renderCatalogPayload(shapeSecurity(security, riskSummary, installDialogPreview))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_risk_by_store_ids',
			description:
				'Look up the safety score and risk category for MANY extensions at once, addressed by their ' +
				'STORE ids (the id in the store URL) — the inventory case: you have a list of what a user has ' +
				`installed and need risk for all of it. Up to ${MAX_BATCH_EXTENSIONS} extensions per call, and ` +
				'the WHOLE call costs 1 read credit (not 1 per extension; get_security costs 3 credits ' +
				'per extension). Returns safety score (0–100, higher ' +
				'= safer, the same number the website shows), risk category, severity counts, last scan date ' +
				'and the catalog URL per extension. Each store id is resolved through its cross-store cluster ' +
				'to the same listing the extension page renders, so these answers agree with the website. ' +
				'`store` is REQUIRED per entry — Chrome and Edge ids share one format. An extension with no ' +
				'score has not been scanned yet (`scanned: false`); ids with no catalog listing come back ' +
				'under `notInCatalog`. Neither means "safe". The full findings list of ONE extension comes ' +
				'from get_security.',
			parameters: z.object({
				extensions: z
					.array(
						z.object({
							store_id: z
								.string()
								.min(1)
								.max(100)
								.describe('The extension id from its store URL, e.g. "cjpalhdlnbpafiamejdnhcphjbkeiagm".'),
							store: z
								.enum(['CHROME', 'FIREFOX', 'EDGE'])
								.describe('Which store this id belongs to. Required — Chrome and Edge ids look identical.'),
						}),
					)
					.min(1)
					.max(MAX_BATCH_EXTENSIONS)
					.describe(
						`The extensions to look up (max ${MAX_BATCH_EXTENSIONS}). A longer list takes several ` +
							`calls of up to ${MAX_BATCH_EXTENSIONS}; each call costs 1 read credit.`,
					),
			}),
			execute: async (args, context) => {
				try {
					const refs = args.extensions.map((e) => ({ storeId: e.store_id, store: e.store }))
					const rows = await bff(context).getSecuritySummaryBatch({ extensions: refs })
					return renderCatalogPayload(shapeStoreRiskBatch(rows, refs))
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'market_overview',
			description:
				'Aggregate catalog market intelligence. Called with NO arguments it returns a full ' +
				'CATALOG-WIDE overview: totals, store split, the category tree, and the extended facet ' +
				'breakdown — Manifest V2/V3 adoption, sensitive-permission histogram, security risk-tier ' +
				'distribution, trader status, update-recency, and review-count buckets. Pass a `query` ' +
				'(and/or store/category filters) to scope those facets to a search result set instead.',
			parameters: z.object({
				query: z.string().optional().describe('Optional query to scope facets to a search.'),
				stores: z.array(z.enum(['CHROME', 'FIREFOX', 'EDGE'])).optional(),
				categories: z.array(z.string()).optional(),
				facets: z
					.array(z.enum(MARKET_FACETS))
					.optional()
					.describe(
						'Facet groups to include: stats, stores, categories, extended, questionnaire, downloads; all groups when omitted.',
					),
				top_n: z
					.number()
					.int()
					.min(1)
					.max(MAX_MARKET_TOP_N)
					.optional()
					.describe(
						`Entries kept per open-ended list (category tree levels, permissions, target sites), largest first. Default ${DEFAULT_MARKET_TOP_N}; \`truncated\` reports what was cut.`,
					),
			}),
			execute: async (args, context) => {
				try {
					const client = bff(context)
					const shapeOpts = { facets: args.facets, topN: args.top_n }
					const scoped = Boolean(args.query?.trim() || args.stores?.length || args.categories?.length)

					// Search-scoped: progressive-narrowing facets over the match set.
					if (scoped) {
						const [stats, facets] = await Promise.all([
							client.getStats().catch(() => null),
							client
								.getSearchFacets({ query: args.query, stores: args.stores, categories: args.categories })
								.catch(() => null),
						])
						return renderCatalogPayload(
							shapeMarketOverview(
								{ scope: 'search', stats: stats ?? undefined, facets: facets ?? undefined },
								shapeOpts,
							),
						)
					}

					// Catalog-wide: the unscoped search facets are all-zero by design, so build the
					// overview from the dedicated catalog-wide procedures (cached server-side).
					const STORE_LABELS: Record<string, string> = {
						CHROME: 'Chrome Web Store',
						FIREFOX: 'Firefox Add-ons',
						EDGE: 'Edge Add-ons',
					}
					const [stats, extended, categoryTree] = await Promise.all([
						client.getStats().catch(() => null),
						client.getExtendedFilterFacets().catch(() => null),
						client.getCategoryTree().catch(() => null),
					])
					const storeDistribution =
						(stats as { storeDistribution?: Array<{ store: string; count: number }> } | null)
							?.storeDistribution ?? []
					const stores = storeDistribution.map((r) => ({
						name: r.store,
						count: r.count,
						label: STORE_LABELS[r.store] ?? r.store,
					}))
					return renderCatalogPayload(
						shapeMarketOverview(
							{
								scope: 'catalog-wide',
								stats: stats ?? undefined,
								facets: {
									stores,
									categoryTree: categoryTree ?? undefined,
									extended: extended ?? undefined,
								},
								note: 'Monetization and download-volume facets are computed only for a query-scoped overview.',
							},
							shapeOpts,
						),
					)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_credit_balance',
			description:
				'Report your remaining Extenshi credits — for checking whether a large request fits the ' +
				'balance before running it. Returns every credit pool for your API key: `read` (spent one-per-call by ' +
				'search_extensions / get_extension / get_reviews / market_overview / get_risk_by_store_ids — the ' +
				'last one covers up to 40 extensions for that single credit; get_security costs 3) and ' +
				'`scan` (spent by scan_extension), plus `icon` and `inventory`. Each pool reports `remaining` — the ' +
				'number that actually gates calls (one-time free grant + purchased credits) — and `freeRemaining` ' +
				'(how much of the one-time, non-renewing signup grant is left). FREE to call: checking the balance ' +
				'spends no credit. Fetching N extensions takes read.remaining ≥ N (≥ 3N with get_security ' +
				'on each).',
			parameters: z.object({}),
			execute: async (_args, context) => {
				try {
					const balance = await bff(context).getApiCallerBalance()
					return JSON.stringify(balance, null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		// ── The developer's OWN projects ───────────────────────────────────────
		//
		// Extenshi holds the state of an extension project — its type, its
		// manifest, its live hosted pages — so an agent can read that instead of
		// being told it again in prose, and so what it builds matches what the
		// developer already configured. Both are FREE: credits pay for catalog
		// data about other people's extensions, never for your own work.
		add({
			name: 'list_my_projects',
			description:
				"List the extension projects owned by this API key — the developer's own workspaces on " +
				'extenshi.io. Returns id, name, status, target browsers, the bound GitHub repo (if any) and ' +
				'the claimed store listing (if any). Applies when the developer refers to "my extension" or ' +
				'"my project": the returned id is what get_project_state takes. FREE — reading your own ' +
				'projects spends no credit.',
			parameters: z.object({}),
			execute: async (_args, context) => {
				try {
					return JSON.stringify(await bff(context).listMyProjects(), null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_project_state',
			description:
				"Read one of the developer's own projects as state you can build from: the extension TYPES " +
				'they picked (popup / side panel / page enhancer / in-page assistant), the required ' +
				'permissions those types force, the exact manifest.json the project produces for each target ' +
				'browser, the files that type needs, live hosted URLs (uninstall survey), and an index of ' +
				'every saved tool state with its size. It reflects the site configuration at the time of the ' +
				'call; later changes on the site appear in a later read. The additive workspace envelope ' +
				'holds revisioned local observations separately from these scaffold drafts. It also returns ' +
				'the integration contract: `integration.file` is the exact content for `integration.path` ' +
				'that wires the extension to this project. Those bytes carry a fingerprint extenshi.io uses ' +
				"to tell the developer's edits from its own; a reassembled equivalent file lacks it, and the " +
				'site then stops managing the values in it. `integration.unwired` lists the links this ' +
				'project has not set up yet (no URLs exist for them). Tool-state payloads are NOT inlined by ' +
				'default (a single row can be 256 KiB); includeToolStates selects which keys to inline. ' +
				'FREE — spends no credit. Type definitions are in list_extension_templates.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				includeToolStates: z
					.array(z.string())
					.optional()
					.describe(
						'Tool keys whose saved payload to inline, e.g. ["manifest-generator", "privacy-policy-generator"]. When omitted, only the index is returned.',
					),
			}),
			execute: async (args, context) => {
				try {
					const state = await bff(context).getMyProjectState({
						projectId: args.projectId,
						includeToolStates: args.includeToolStates,
					})
					return JSON.stringify(state, null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_project_scaffold',
			description:
				"The starter extension one of the developer's own projects produces, as FILES ready to " +
				'write: manifest.json for the target browser, the background worker, the panel or ' +
				"content-script files that project's types need, placeholder icons, and " +
				'src/extenshi.config.js. The config carries a fingerprint that lets extenshi.io recognise ' +
				"the repository as this project's; a hand-rebuilt config lacks it, and the site then stops " +
				'managing those values. Intended for a NEW extension: it is a complete starter set whose ' +
				'files would replace same-named files in an existing repository. It is the same file set ' +
				"the site commits. One browser per call (default: the project's first target). " +
				'FREE — spends no credit.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				browser: z
					.enum(['chrome', 'firefox', 'edge'])
					.optional()
					.describe("Target browser; defaults to the project's first declared target."),
			}),
			execute: async (args, context) => {
				try {
					const scaffold = await bff(context).getMyProjectScaffold({
						projectId: args.projectId,
						browser: args.browser,
					})
					return JSON.stringify(scaffold, null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
		add({
			name: 'list_privacy_policy_versions',
			description:
				"List hosted privacy-policy versions for one of the developer's Pro projects: version number, " +
				'kind (generated / edited / ai_updated / reverted), and which one is live. The public URL is ' +
				'in get_project_state hostedArtifacts.privacyPolicy. Pro only — a free project returns ' +
				'PROJECT_PREMIUM_REQUIRED. Does not spend a credit.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).listPrivacyPolicyVersions(args), null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_privacy_policy_version',
			description:
				'Read the markdown (and HTML) of one hosted privacy-policy version; version numbers come from ' +
				'list_privacy_policy_versions. Pro only. Does not spend a credit.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				versionNumber: z
					.number()
					.int()
					.positive()
					.describe('Version number from list_privacy_policy_versions.'),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).getPrivacyPolicyVersion(args), null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'publish_privacy_policy',
			description:
				'Publish a hosted privacy policy for a Pro project. Changes the live public policy page. ' +
				'Without bodyMarkdown it generates the policy from the saved form and manifest (the first ' +
				'version is produced this way); with bodyMarkdown it publishes that edited (or AI-updated) ' +
				'draft at the same public URL. Once published, PRIVACY_POLICY_URL in the integration.file ' +
				'from get_project_state is the hosted URL. Pro only.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				bodyMarkdown: z
					.string()
					.optional()
					.describe(
						'Full policy markdown. When omitted, the policy is generated from the saved form and manifest.',
					),
				kind: z
					.enum(['generated', 'edited', 'ai_updated', 'reverted'])
					.optional()
					.describe(
						'How this version was produced. Default: generated if no markdown, edited if markdown is set.',
					),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).publishPrivacyPolicy(args), null, 2)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'update_privacy_policy_with_ai',
			description:
				"Propose an updated privacy policy that keeps the author's custom wording and adds sections " +
				'required by new permissions or data practices. Returns proposedMarkdown only; nothing goes ' +
				'live. aiStep states whether the AI step ran (ran | did_not_run | discarded | not_needed) and ' +
				'notice says why; unless aiStep is ran, proposedMarkdown is a deterministic section merge, not an ' +
				'AI draft. conflictHeadings and missingCategories list what still needs a manual edit. Publishing ' +
				'is a separate step (publish_privacy_policy with the returned kind). Requires a policy that is ' +
				'already published. Pro only.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(
						describePrivacyAiUpdate(await bff(context).updatePrivacyPolicyWithAi(args)),
						null,
						2,
					)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})
	}

	// ── Documentation (free; no API key required) ──────────────────────────────
	if (caps.has('docs')) {
		add({
			name: 'get_development_guide',
			description:
				'For extension-development tasks: returns the complete tool inventory for THIS connection, ' +
				'the Extenshi service directory with access requirements and docs links, GitHub/code placement ' +
				'guidance, and the ordered workflow from idea and repository through implementation, assets, ' +
				'privacy, tests/CI, store submission and maintenance. Distinguishes MCP tools from cabinet, ' +
				'CLI and external steps. Free; no key, account lookup or network request.',
			parameters: z.object({
				sections: z
					.array(z.enum(['all', ...GUIDE_SECTIONS]))
					.optional()
					.describe(
						'Full guide sections to include: tools, localActions, services, repository, workflow, handoff, or all. ' +
							'Omitted: a compact overview with tool names, workflow stages and a table of contents.',
					),
			}),
			execute: async (args) =>
				JSON.stringify(buildDevelopmentGuide(registeredTools, args?.sections), null, 2),
		})

		add({
			name: 'search_docs',
			description:
				'Search the official Extenshi documentation (docs.extenshi.io) — product guides plus the ' +
				'full @extenshi/cli command reference (scan, review-risk, publish, login). Applies to ' +
				'"how do I…" questions and to exact CLI commands and flags. Free: reads public docs, no ' +
				'API key or quota required. Without a query it lists every available documentation page.',
			parameters: z.object({
				query: z
					.string()
					.optional()
					.describe(
						'What to look up, e.g. "scan a zip in CI", "review-risk flags", "publish to edge", "get an API key". When omitted, every page is listed.',
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.default(4)
					.describe('Max documentation passages (page subsections) to return (1–10).'),
				max_chars: z
					.number()
					.int()
					.min(MIN_EXCERPT_CHARS)
					.max(MAX_EXCERPT_CHARS)
					.optional()
					.describe(
						`Max characters per passage excerpt (${MIN_EXCERPT_CHARS}–${MAX_EXCERPT_CHARS}, default ${DEFAULT_EXCERPT_CHARS}). Longer passages are cut with a link to the full page.`,
					),
			}),
			execute: async (args) => {
				try {
					const query = args.query?.trim()
					if (!query) return await getDocsIndex(deps.cfg.docsUrl)
					return await searchDocs(deps.cfg.docsUrl, query, {
						limit: args.limit ?? 4,
						maxChars: args.max_chars,
					})
				} catch (err) {
					// Both branches keep the origin as `cause` — a docs outage is a
					// fault worth capturing, not an expected condition.
					if (err instanceof DocsError) throw userErrorFrom(err.message, err)
					throw userErrorFrom(err instanceof Error ? err.message : String(err), err)
				}
			},
		})

		add({
			name: 'localize_workflow',
			description:
				'Get the FREE local browser-extension localization workflow: prepare missing or stale ' +
				'_locales messages, translate with your own coding agent, apply validated translations ' +
				'and check placeholders, protected terms and listing risks. Returns commands and the ' +
				'JSON handoff contract. Static guidance only: no API key, network or Extenshi credits; ' +
				'translation uses your agent provider. Includes release availability and human review gates.',
			parameters: z.object({}),
			execute: async () => renderLocalizeWorkflow(),
		})

		add({
			name: 'generate_icon_workflow',
			description:
				'Get the recommended FREE local workflow for creating a browser-extension icon: the ' +
				'agent draws the SVG itself, then `@extenshi/cli icon preview` renders an offline ' +
				'verification page (Chrome/Firefox/Edge toolbar mockups, palette switcher with contrast ' +
				'warnings, store-size matrix, PNG/ZIP export). Returns the icon design requirements ' +
				'(sizes, 16px legibility rules, light/dark survival) and exact commands. Static content: ' +
				'no API key, no network, no credits.',
			parameters: z.object({
				extension_name: z
					.string()
					.max(120)
					.optional()
					.describe('Extension display name to inline into the preview command (optional).'),
			}),
			execute: async (args) => renderIconWorkflow({ extensionName: args.extension_name }),
		})

		add({
			name: 'generate_welcome_page_workflow',
			description:
				'Get the design brief for a browser-extension welcome page — the page a user lands on ' +
				'right after installing. Returns the one action the page is built to drive (pin the extension, ' +
				'keep the new-tab change, use it on a site), exactly which illustrations to produce for ' +
				'that goal, how to capture and crop them, how to place numbered/arrow markers showing ' +
				'where to click, the limits enforced on save, and the block JSON format. Store screenshots ' +
				'Extenshi already hosts (from get_extension) can serve as illustrations. Static content: no ' +
				'API key, no network, no credits.',
			parameters: z.object({
				extension_name: z.string().max(120).optional().describe('Extension display name.'),
				goal: z
					.enum(['PIN_EXTENSION', 'NEW_TAB_OPT_IN', 'VISIT_SITE', 'CUSTOM'])
					.optional()
					.describe(
						'The single action the page drives. PIN_EXTENSION (default) fits ~90% of extensions; ' +
							'NEW_TAB_OPT_IN for new-tab replacements; VISIT_SITE when the extension injects a ' +
							'widget into a site.',
					),
				what_it_does: z
					.string()
					.max(1000)
					.optional()
					.describe('One or two sentences on what the extension actually does.'),
				target_site: z
					.string()
					.max(200)
					.optional()
					.describe('For VISIT_SITE: the site the extension injects into, e.g. youtube.com.'),
				store_screenshots: z
					.array(z.string().max(1000))
					.max(10)
					.optional()
					.describe(
						'Screenshot URLs from get_extension. Offered to the agent as ready-made illustration ' +
							'material that needs no upload.',
					),
				existing_steps: z
					.array(z.string().max(200))
					.max(10)
					.optional()
					.describe('Steps the author already wrote, so the brief adds visuals instead of rewriting.'),
				accent_color: z
					.string()
					.max(9)
					.optional()
					.describe("The page's accent colour as hex, so drawn illustrations match it."),
			}),
			execute: async (args) =>
				renderWelcomeWorkflow({
					extensionName: args.extension_name,
					goal: args.goal,
					whatItDoes: args.what_it_does,
					targetSite: args.target_site,
					storeScreenshots: args.store_screenshots,
					existingSteps: args.existing_steps,
					accentColor: args.accent_color,
				}),
		})

		add({
			name: 'generate_landing_page',
			description:
				'Generate a static landing page (homepage) for a browser extension as one self-contained HTML ' +
				'file: no JavaScript, escaped text, http(s)-only links (the support link may also be a mailto: ' +
				'address), and store buttons only for the store ' +
				'URLs given. Same generator as the cabinet Page generator, so a saved `page-generator` form ' +
				'from get_project_state maps field for field. Optional logo (inline SVG, validated and embedded ' +
				'as an image, or an image URL), screenshots and the canonical homepage URL for Open Graph and ' +
				'JSON-LD. Returns JSON {html, bytes, warnings, nextSteps}: warnings list input that was dropped ' +
				'or clamped; nextSteps cover hosting the file on HTTPS and registering the URL with ' +
				'upsert_hosted_page, which feeds HOMEPAGE_URL. Extenshi does not host the page. Static content: ' +
				'no API key, no network, no credits.',
			parameters: z.object(LANDING_FORM_SHAPE),
			execute: async (args) => JSON.stringify(renderGenerateLandingPage(args)),
		})

		add({
			name: 'list_extension_templates',
			description:
				'The kinds of browser extension you can build, with the permissions each one REQUIRES: ' +
				'Popup (toolbar window), Side panel (docked beside the page), Page enhancer (runs on sites ' +
				'you list), In-page assistant (your own UI over any site). Types combine, and the required ' +
				'permissions are the union. Applies when choosing manifest permissions: it gives the minimum ' +
				'each shape needs (store review flags padded permissions). Also states the cross-browser ' +
				'rules (Chromium side_panel vs Firefox sidebar_action) and the rule that a manifest may not ' +
				'name a file the package lacks. ' +
				"FREE: no API key, no quota. A specific project's chosen types are in get_project_state.",
			parameters: z.object({
				types: z
					.array(z.string())
					.optional()
					.describe('Type ids to include (popup, sidepanel, content, overlay); all four when omitted.'),
			}),
			execute: async (args) => renderExtensionTemplates(args.types),
		})
	}

	// ── Action tool (paid; key + LOCAL filesystem required; stdio only) ─────────
	if (caps.has('scan')) {
		add({
			name: 'scan_extension',
			description:
				'Run a pre-publish security scan on a local extension artifact (.zip/.crx/.xpi) and ' +
				'return the report. Uses one scan from your one-time free allowance (3 scans) or a ' +
				'purchased scan credit once that runs out. Streams live per-scanner progress.',
			parameters: z.object({
				artifact_path: z
					.string()
					.describe('Absolute or relative path to the built extension artifact (≤50 MB).'),
				// Optional association with a catalog listing — by numeric id OR store id.
				// Reuse the shared ref validators but override the descriptions: here the
				// ref is an optional ASSOCIATION for the scan, not a lookup key, so the
				// shared "from search_extensions results" wording would mislead an agent.
				extension_id: EXTENSION_REF_SHAPE.extension_id.describe(
					'Optional numeric catalog ID to associate this scan with a catalog listing.',
				),
				store_id: EXTENSION_REF_SHAPE.store_id.describe(
					'Optional: associate this scan with a catalog listing by its store id (the id in the ' +
						'store URL; add `store` for a Chrome/Edge id).',
				),
				store: EXTENSION_REF_SHAPE.store,
			}),
			execute: async (args, context) => {
				const apiKey = requireApiKey(context)
				// Resolve the optional catalog association BEFORE spending a scan credit,
				// so a mistyped store_id fails fast instead of after the scan runs.
				let extensionId: number | undefined
				try {
					extensionId = await resolveOptionalExtensionId(bff(context), args)
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
				try {
					const report = await scanArtifact({
						artifactPath: args.artifact_path,
						apiKey,
						scanUrl: deps.cfg.scanUrl,
						extensionId: extensionId?.toString(),
						onProgress: (p) => {
							if (typeof p.total === 'number' && p.total > 0) {
								void context.reportProgress({ progress: p.completed ?? 0, total: p.total })
							}
						},
					})
					// The scan report goes out as-is (defanged + labelled as data: finding
					// text quotes the artifact's own code). It used to be passed through
					// shapeExtension — the catalog-DETAIL shaper — whose field list has
					// none of the report's keys, so every scan came back as
					// {"snapshots": []} after the credit was spent.
					return renderCatalogPayload(report)
				} catch (err) {
					// Keep the ScanError as `cause`: scanErrorMessage() renders 402/429
					// and a 500 alike, so only the origin's status still says which of
					// those is a fault worth capturing.
					if (err instanceof ScanError) throw userErrorFrom(scanErrorMessage(err, missingKeyMessage), err)
					throw err
				}
			},
		})
	}

	if (caps.has('publish')) {
		add({
			name: 'publish_extension',
			description:
				'Publish an extension artifact (.zip/.crx/.xpi) to Chrome Web Store, Firefox AMO, and/or Edge Add-ons: ' +
				'uploads and submits a new version to each selected store. ' +
				'FREE and fully local: the upload goes from this machine straight to the store APIs using store ' +
				'credentials from the MCP server environment (CHROME_APP_ID/CHROME_CLIENT_ID/CHROME_CLIENT_SECRET/' +
				'CHROME_REFRESH_TOKEN, FIREFOX_ADDON_GUID/FIREFOX_JWT_ISSUER/FIREFOX_JWT_SECRET, ' +
				'EDGE_PRODUCT_ID/EDGE_CLIENT_ID/EDGE_CLIENT_SECRET/EDGE_TENANT_ID). The upload itself is local, but ' +
				'publishing is in an active testing phase: a quick Extenshi access check runs first (it identifies your ' +
				'account by EXTENSHI_API_KEY). Edge submissions are polled to a terminal status. The artifact is ' +
				'not security-scanned by this tool (scanning is scan_extension).',
			parameters: z.object({
				artifact_path: z
					.string()
					.describe('Path to the packaged extension (.zip for Chrome/Edge, .xpi/.zip for Firefox).'),
				stores: z
					.array(z.enum(['chrome', 'firefox', 'edge']))
					.optional()
					.describe(
						'Target stores; defaults to every store that has complete credentials in the environment.',
					),
				firefox_artifact_path: z
					.string()
					.optional()
					.describe('Separate Firefox artifact (.xpi); defaults to artifact_path.'),
				release_notes: z.string().optional().describe('Release notes for stores that accept them.'),
				extension_id: z
					.number()
					.optional()
					.describe('Numeric catalog ID — checks publish-beta access against this specific extension.'),
				validate_only: z
					.boolean()
					.optional()
					.describe('Only check which store credentials are configured and valid; publish nothing.'),
			}),
			execute: async (args, context) => {
				try {
					if (args.validate_only) {
						const checks = await validateStoreCredentials(args.stores)
						return JSON.stringify({ checks }, null, 2)
					}

					// Publish-access gate: `publish` is in an active testing phase. One BFF
					// preflight evaluates the `publish-access` PostHog flag for this developer
					// / extension. Fails open on any transport error — only a definitive
					// server "no" blocks here (see checkPublishAccess).
					const creds = readStoreCredentials()
					const storeIds: Partial<Record<'chrome' | 'firefox' | 'edge', string>> = {}
					if (creds.chrome) storeIds.chrome = creds.chrome.appId
					if (creds.firefox) storeIds.firefox = creds.firefox.addonGuid
					if (creds.edge) storeIds.edge = creds.edge.productId
					const access = await checkPublishAccess({
						bffUrl: deps.cfg.bffUrl,
						apiKey: deps.getApiKey?.(context) ?? null,
						storeIds,
						extensionId: args.extension_id,
					})
					if (!access.allowed) {
						throw new UserError(
							access.message ??
								"Publishing is in an active testing phase and isn't available for your account yet.",
						)
					}

					void context.reportProgress({ progress: 0, total: 1 })
					const result = await publishArtifact({
						artifactPath: args.artifact_path,
						stores: args.stores,
						firefoxArtifactPath: args.firefox_artifact_path,
						releaseNotes: args.release_notes,
					})
					void context.reportProgress({ progress: 1, total: 1 })
					return JSON.stringify(result, null, 2)
				} catch (err) {
					if (err instanceof PublishSetupError) throw new UserError(err.message)
					throw err
				}
			},
		})
	}
}
