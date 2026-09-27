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
 *               generate_welcome_page_workflow, localize_workflow (free; no key)
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
import { buildDevelopmentGuide, type GuideTool } from './development-guide.js'
import { DocsError, getDocsIndex, searchDocs } from './docs.js'
import { renderIconWorkflow } from './icon-workflow.js'
import { renderLocalizeWorkflow } from './localize-workflow.js'
import { PAY_OPERATIONS, paySchemas } from './pay.js'
import {
	PublishSetupError,
	publishArtifact,
	readStoreCredentials,
	validateStoreCredentials,
} from './publish.js'
import { checkPublishAccess } from './publish-access.js'
import { ScanError, scanArtifact } from './scan.js'
import { describeStoreConstraints, validateSearchFilters } from './search-filters.js'
import { shapeExtension, shapeReviews, shapeSearch, shapeSecurity, shapeStoreRiskBatch } from './shape.js'
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
				'"cjpalhdlnbpafiamejdnhcphjbkeiagm"). For a Chrome/Edge id (32 letters a–p) you MUST also ' +
				'pass `store` — both stores share that format. Firefox ids (slug / GUID / email) are ' +
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
	remove_hosted_page: {
		title: 'Remove a hosted page registration',
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: true,
	},
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
				description: `${description} Requires ${mutation ? 'pay.write' : 'pay.read'} permission. Never put developer API keys or Stripe secrets in extension code.`,
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
				'Import an existing manifest.json into the Dojo manifest editor and project labels. Pass parsed JSON and optional default-locale messages. Source import fills supported fields and preserves all other JSON; built imports remain separate observations. Default dryRun=true returns changes and expectedStateHash; apply with dryRun=false and that hash. Never infers data collection, prices, or publication. Requires project.write.' +
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
				'Explain readiness for the recorded browser and artifact by locale. Local or agent reports never become CI attestations. Stale evidence does not pass. Requires a Pro project. ' +
					'Readiness is measured against the release recorded in the workspace: until apply_project_patch sets patch.release ' +
					'(browser, version, artifactDigest, manifestDigest, locales, paymentRequired, and commit or dirtyTreeDigest) it reports ' +
					'RELEASE_NOT_RECORDED; evidence must then match that release artifactDigest.',
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
				'Verify authentication, granted scopes, supported workspace contracts and actual write permissions (incl. hosted.write, evidence uploads and, for a projectId, CI ingest configuration). Includes credit balances; never returns credentials or secrets. On auth failures run `extenshi login --recover` (CLI) or reissue the API key from dojo.extenshi.io/api-keys.',
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
					: `Apply a typed project metadata patch with expectedRevision and idempotencyKey. Preserve source and built manifests separately, including unknown keys. Missing fields never delete; tombstones explicitly delete. No source upload or scaffold overwrite. Record a release (patch.release) here before asking get_release_readiness. Requires project.write OAuth scope.${PROVENANCE_HINT}`,
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
				'Create or rotate the per-project secret the extenshi-evidence-action uses to POST CI evidence (POST /projects/:id/evidence/ingest). The secret is displayed ONCE — put it into the repository GitHub Actions secret EXTENSHI_EVIDENCE_SECRET. Creating again invalidates the previous secret. Requires project.write.',
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
			description: `Register the project's homepage or support page URL (HTTPS only, must be publicly reachable; the server hashes the body). The registered homepage URL feeds HOMEPAGE_URL when the integration config file is regenerated. Requires hosted.write. API reference: ${HOSTED_PAGES_DOCS}`,
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
				'Record test/scan/listing/privacy/payment evidence metadata bound to a browser, artifact hash and input hash. Source is local or agent, never CI — CI evidence is written by the verified ingest endpoint only. Attachment files upload via the CLI (extenshi evidence push --attach); this tool records metadata only. Requires evidence.write OAuth scope.' +
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
				'ALL filters are applied server-side by the catalog database — always narrow with the ' +
				'parameters below (rating/users/reviews thresholds, store, category, pricing, risk, ' +
				'permissions, freshness, manifest version, trader status) rather than fetching a broad ' +
				'list and filtering the results yourself. Use `skip` to page through large result sets. ' +
				`${describeStoreConstraints()} ` +
				'Returns a compact list for market research and competitive analysis.',
			parameters: z.object({
				query: z.string().optional().describe('Free-text search query (name, description, keywords).'),
				stores: z
					.array(z.enum(['CHROME', 'FIREFOX', 'EDGE']))
					.optional()
					.describe('Limit to stores: CHROME, FIREFOX, and/or EDGE.'),
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
						'Minimum weekly downloads — FIREFOX-ONLY metric (Chrome/Edge do not report it). ' +
							'For Chrome/Edge popularity use sortBy:"popular" instead. Conflicts with a ' +
							'Chrome/Edge-only `stores` filter and will be rejected.',
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
					.describe('Include extensions whose store listing was removed (default: hidden).'),
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
				'Paginated newest-first by default — pass `cursor` (the `nextCursor` from a previous ' +
				'call) to fetch the next page, or sort by highest rating. Cursors are sort-specific: ' +
				'keep the same `sort` while paging, and start over if you change it. Reads existing ' +
				'scraped reviews; use `min_rating` to see only positive or only critical feedback.',
			parameters: z.object({
				...EXTENSION_REF_SHAPE,
				limit: z.number().int().min(1).max(50).default(20).describe('Max reviews to return (1–50).'),
				cursor: z
					.number()
					.int()
					.optional()
					.describe('Pagination cursor — pass the `nextCursor` returned by a previous call.'),
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
				'the install-dialog preview — exactly what Chrome/Firefox show users in the permission ' +
				'prompt at install (consolidated + deduped from the manifest), available even for ' +
				'unscanned extensions. Reads existing scan results — does not trigger a new scan. ' +
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
				'the WHOLE call costs 1 read credit (not 1 per extension), so prefer this over calling ' +
				'get_security in a loop — that would cost 3 credits each. Returns safety score (0–100, higher ' +
				'= safer, the same number the website shows), risk category, severity counts, last scan date ' +
				'and the catalog URL per extension. Each store id is resolved through its cross-store cluster ' +
				'to the same listing the extension page renders, so these answers agree with the website. ' +
				'`store` is REQUIRED per entry — Chrome and Edge ids share one format. An extension with no ' +
				'score has not been scanned yet (`scanned: false`); ids with no catalog listing come back ' +
				'under `notInCatalog`. Neither means "safe". For the full findings list of ONE extension, use ' +
				'get_security instead.',
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
						`The extensions to look up (max ${MAX_BATCH_EXTENSIONS}). Split a longer list into ` +
							`batches of ${MAX_BATCH_EXTENSIONS}; each batch costs 1 read credit.`,
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
			}),
			execute: async (args, context) => {
				try {
					const client = bff(context)
					const scoped = Boolean(args.query?.trim() || args.stores?.length || args.categories?.length)

					// Search-scoped: progressive-narrowing facets over the match set.
					if (scoped) {
						const [stats, facets] = await Promise.all([
							client.getStats().catch(() => null),
							client
								.getSearchFacets({ query: args.query, stores: args.stores, categories: args.categories })
								.catch(() => null),
						])
						return renderCatalogPayload({
							scope: 'search',
							stats: stats ?? undefined,
							facets: facets ?? undefined,
						})
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
					return renderCatalogPayload({
						scope: 'catalog-wide',
						stats: stats ?? undefined,
						facets: {
							stores,
							categoryTree: categoryTree ?? undefined,
							extended: extended ?? undefined,
						},
						note: 'Monetization and download-volume facets are only computed when scoped to a query — pass `query` to get those.',
					})
				} catch (err) {
					return readError(err, missingKeyMessage)
				}
			},
		})

		add({
			name: 'get_credit_balance',
			description:
				'Check your remaining Extenshi credits BEFORE running a batch, so you never guess whether a ' +
				'large request is safe. Returns every credit pool for your API key: `read` (spent one-per-call by ' +
				'search_extensions / get_extension / get_reviews / market_overview / get_risk_by_store_ids — the ' +
				'last one covers up to 40 extensions for that single credit; get_security costs 3) and ' +
				'`scan` (spent by scan_extension), plus `icon` and `inventory`. Each pool reports `remaining` — the ' +
				'number that actually gates calls (one-time free grant + purchased credits) — and `freeRemaining` ' +
				'(how much of the never-renewing signup grant is left). FREE to call: checking your balance never ' +
				'spends a credit. Rule of thumb: to fetch N extensions you need read.remaining ≥ N (≥ 3N if you ' +
				'also call get_security on each).',
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
				'the claimed store listing (if any). Start here when the developer says "my extension" or ' +
				'"my project": the id you get back is what get_project_state takes. FREE — reading your own ' +
				'projects never spends a credit.',
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
				'every saved tool state with its size. Use it before writing code so the manifest you ship ' +
				'matches what the developer configured on the site — and re-read it after they change ' +
				'something rather than assuming. The additive workspace envelope holds revisioned local observations separately from these scaffold drafts. It also returns the integration contract: review local changes before writing ' +
				'`integration.file` to `integration.path` VERBATIM to wire the extension to this project — ' +
				"those bytes carry a fingerprint extenshi.io uses to tell the developer's edits from its " +
				'own, so an equivalent file you assemble yourself makes the site stop managing every value ' +
				'in it. `integration.unwired` names the links this project has not set up yet — offer them ' +
				'rather than inventing URLs. Tool-state payloads are NOT inlined by default (a single ' +
				'row can be 256 KiB); name the keys you actually need in includeToolStates. FREE — never ' +
				'spends a credit. Combine with list_extension_templates for what each type means.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				includeToolStates: z
					.array(z.string())
					.optional()
					.describe(
						'Tool keys whose saved payload to inline, e.g. ["manifest-generator", "privacy-policy-generator"]. Omit to get the index only.',
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
				'src/extenshi.config.js. Write the files VERBATIM — the config carries a fingerprint ' +
				"that lets extenshi.io keep recognising the repository as this project's, and rebuilding " +
				'it by hand makes the site stop managing those values. Use this for a NEW extension; never overwrite an existing repository. Prefer this over writing a manifest ' +
				'yourself: it is the same set the site commits, so what you write and what the site ' +
				"expects cannot disagree. One browser per call (default: the project's first target). " +
				'FREE — never spends a credit.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				browser: z
					.enum(['chrome', 'firefox', 'edge'])
					.optional()
					.describe("Target browser. Omit for the project's first declared target."),
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
				'Read the markdown (and HTML) of one hosted privacy-policy version. Use list_privacy_policy_versions ' +
				'first. Pro only. Does not spend a credit.',
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
				'Publish a hosted privacy policy for a Pro project. Omit bodyMarkdown to generate version 1 from ' +
				'the saved form and manifest (always the first version). Pass bodyMarkdown to publish an edited ' +
				'(or AI-updated) draft — that goes live at the same public URL. After a successful publish, ' +
				're-read get_project_state so PRIVACY_POLICY_URL in integration.file is the hosted URL. ' +
				'Show the author the URL before telling them it is live. Pro only.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
				bodyMarkdown: z
					.string()
					.optional()
					.describe('Full policy markdown. Omit to generate from current form + manifest.'),
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
				'required by new permissions or data practices. Does NOT go live — show proposedMarkdown to the ' +
				'author, then call publish_privacy_policy with that markdown (kind ai_updated). Requires a ' +
				'policy that is already published. Pro only.',
			parameters: z.object({
				projectId: z.string().describe('Project id from list_my_projects.'),
			}),
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).updatePrivacyPolicyWithAi(args), null, 2)
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
				'Start here when developing an extension: get the complete tool inventory for THIS connection, ' +
				'the Extenshi service directory with access requirements and docs links, GitHub/code placement ' +
				'guidance, and the ordered workflow from idea and repository through implementation, assets, ' +
				'privacy, tests/CI, store submission and maintenance. Distinguishes MCP tools from cabinet, ' +
				'CLI and external steps. Free; no key, account lookup or network request.',
			parameters: z.object({}),
			execute: async () => JSON.stringify(buildDevelopmentGuide(registeredTools), null, 2),
		})

		add({
			name: 'search_docs',
			description:
				'Search the official Extenshi documentation (docs.extenshi.io) — product guides plus the ' +
				'full @extenshi/cli command reference (scan, review-risk, publish, login). Use it to answer ' +
				'"how do I…" questions and to give developers exact CLI commands and flags instead of ' +
				'guessing. Free: reads public docs, no API key or quota required. Omit the query to list ' +
				'every available documentation page.',
			parameters: z.object({
				query: z
					.string()
					.optional()
					.describe(
						'What to look up, e.g. "scan a zip in CI", "review-risk flags", "publish to edge", "get an API key". Omit to list every page.',
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.default(4)
					.describe('Max documentation sections to return (1–10).'),
			}),
			execute: async (args) => {
				try {
					const query = args.query?.trim()
					if (!query) return await getDocsIndex(deps.cfg.docsUrl)
					return await searchDocs(deps.cfg.docsUrl, query, args.limit ?? 4)
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
				'right after installing. Returns the one action the page must drive (pin the extension, ' +
				'keep the new-tab change, use it on a site), exactly which illustrations to produce for ' +
				'that goal, how to capture and crop them, how to place numbered/arrow markers showing ' +
				'where to click, the limits enforced on save, and the block JSON to hand back. Pair with ' +
				'get_extension to reuse the store screenshots Extenshi already hosts. Static content: no ' +
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
			name: 'list_extension_templates',
			description:
				'The kinds of browser extension you can build, with the permissions each one REQUIRES: ' +
				'Popup (toolbar window), Side panel (docked beside the page), Page enhancer (runs on sites ' +
				'you list), In-page assistant (your own UI over any site). Types combine, and the required ' +
				'permissions are the union. Call this BEFORE writing a manifest so you request the minimum ' +
				'a shape actually needs instead of guessing — padded permissions are what store review ' +
				'pushes back on. Also states the cross-browser rules (Chromium side_panel vs Firefox ' +
				'sidebar_action) and the rule that a manifest must never name a file the package lacks. ' +
				"FREE: no API key, no quota. For a specific project's chosen types use get_project_state.",
			parameters: z.object({
				types: z
					.array(z.string())
					.optional()
					.describe('Limit to these type ids (popup, sidepanel, content, overlay). Omit for all four.'),
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
					return renderCatalogPayload(shapeExtension(report))
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
				'Publish an extension artifact (.zip/.crx/.xpi) to Chrome Web Store, Firefox AMO, and/or Edge Add-ons. ' +
				'FREE and fully local: the upload goes from this machine straight to the store APIs using store ' +
				'credentials from the MCP server environment (CHROME_APP_ID/CHROME_CLIENT_ID/CHROME_CLIENT_SECRET/' +
				'CHROME_REFRESH_TOKEN, FIREFOX_ADDON_GUID/FIREFOX_JWT_ISSUER/FIREFOX_JWT_SECRET, ' +
				'EDGE_PRODUCT_ID/EDGE_CLIENT_ID/EDGE_CLIENT_SECRET/EDGE_TENANT_ID). The upload itself is local, but ' +
				'publishing is in an active testing phase: a quick Extenshi access check runs first (set EXTENSHI_API_KEY ' +
				'so it can recognize your account). Edge submissions are polled to a terminal status. ' +
				'Recommended flow: scan_extension first, then publish.',
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
