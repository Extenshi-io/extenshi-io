/** Developer lifecycle guidance shared by local and hosted MCP transports.
 * Tool inventory comes from registration, so it describes this server instance.
 * Cabinet services are a directory, not a claim about the caller's entitlements.
 */
export interface GuideTool {
	name: string
	description: string
	annotations: {
		readOnlyHint?: boolean
		destructiveHint?: boolean
	}
}

const docs = (page: string) => `https://docs.extenshi.io/developers/${page}`
const toolPage = (key: string) => `https://dojo.extenshi.io/tools/${key}`

export const DEVELOPMENT_GUIDE_URL = docs('development-workflow')

export const DEVELOPMENT_SERVICES = [
	{
		id: 'documentation',
		purpose: 'Discover capabilities, extension shapes, exact CLI commands and reusable agent skills.',
		tools: ['get_development_guide', 'search_docs', 'list_extension_templates'],
		access: 'Free guidance; no API key. Hosted transport still requires connector sign-in.',
		urls: [docs('mcp'), DEVELOPMENT_GUIDE_URL, docs('agent-skills')],
	},
	{
		id: 'account',
		purpose: 'Sign in, provision an API key for local tools and check credit pools before paid work.',
		tools: ['get_credit_balance', 'connection_diagnostics'],
		access: 'Balance lookup is free and requires identity; catalog reads and scans use credit pools.',
		urls: [docs('scan-credits'), 'https://dojo.extenshi.io/api-keys', 'https://dojo.extenshi.io/billing'],
	},
	{
		id: 'research',
		purpose: 'Validate demand, competitors, user complaints, permissions and existing security findings.',
		tools: [
			'search_extensions',
			'get_extension',
			'get_reviews',
			'get_security',
			'get_risk_by_store_ids',
			'market_overview',
		],
		access:
			'Identity required. Catalog tools cost 1 read per call; get_security costs 3. Bulk risk: up to 40 per call. Chrome review text is unavailable; use its aggregate.',
		urls: [docs('mcp'), 'https://catalog.extenshi.io'],
	},
	{
		id: 'projects',
		purpose:
			'Read an existing project, selected browser types, manifests, repository binding, saved tool state, hosted URLs and starter files.',
		tools: [
			'list_my_projects',
			'get_project_state',
			'get_project_scaffold',
			'get_project_workspace',
			'import_manifest',
			'diff_project_state',
			'apply_project_patch',
			'record_project_evidence',
			'create_ci_ingest_secret',
			'upsert_hosted_page',
			'verify_hosted_artifact',
			'remove_hosted_page',
			'list_hosted_pages',
			'get_release_readiness',
		],
		access:
			'Own-project MCP reads are free and require identity. Create projects in the cabinet. Synchronize repository metadata, source/built manifests and scope with typed revisioned patches. project.write, evidence.write and hosted.write require explicit OAuth consent. Repository metadata does not grant GitHub access. CI evidence (source=ci) is written only by the verified ingest endpoint — create its secret with create_ci_ingest_secret. Automated release-readiness access requires a Pro project.',
		urls: [
			DEVELOPMENT_GUIDE_URL,
			'https://dojo.extenshi.io/projects',
			'https://dojo.extenshi.io/integrations',
		],
	},
	{
		id: 'manifest',
		purpose:
			'Choose minimum permissions, target browsers and manifest entries; validate every referenced file.',
		tools: ['list_extension_templates', 'get_project_state', 'get_project_scaffold'],
		access: 'Free template guidance; project reads require identity. The cabinet also has a manifest editor.',
		urls: [docs('manifest-generator'), toolPage('manifest-generator')],
	},
	{
		id: 'localization',
		purpose:
			'Translate extension messages locally with your coding agent and validate the resulting locales.',
		tools: ['localize_workflow'],
		access:
			'Free static workflow; local CLI validation requires no key or Extenshi credits. Translation uses your agent provider. Check CLI release availability before invoking commands.',
		urls: [docs('localization')],
	},
	{
		id: 'icons',
		purpose: 'Design the SVG, preview at toolbar sizes and export store assets with the local CLI.',
		tools: ['generate_icon_workflow'],
		access:
			'Free workflow. Drawing, browser preview and file export happen in the local agent environment; the cabinet offers its own icon generator subject to availability and credits.',
		urls: [docs('icon-generator'), toolPage('icon-generator')],
	},
	{
		id: 'privacy',
		purpose:
			'Describe actual data practices; generate/export a policy or maintain a hosted policy and its version history.',
		tools: [
			'list_privacy_policy_versions',
			'get_privacy_policy_version',
			'update_privacy_policy_with_ai',
			'publish_privacy_policy',
		],
		access:
			'Hosted policy tools require an owned Pro project. Version reads spend no credit; AI updates have a per-project daily limit. publish_privacy_policy changes the live page. The browser generator supports export.',
		urls: [docs('privacy-policy-generator'), docs('data-declaration'), toolPage('privacy-policy-generator')],
	},
	{
		id: 'onboarding',
		purpose:
			'Prepare a welcome page, pin guide, install instructions and uninstall survey; wire verified URLs into the extension.',
		tools: ['generate_welcome_page_workflow', 'get_project_state'],
		access:
			'Free welcome-page brief. Edit, host and inspect responses in the cabinet where enabled; account/project limits apply. MCP returns guidance and saved state, not a page-publishing tool.',
		urls: [
			DEVELOPMENT_GUIDE_URL,
			docs('pin-guide'),
			docs('uninstall-feedback'),
			toolPage('onboarding-page'),
			toolPage('instruction-generator'),
			toolPage('install-instructions'),
			toolPage('uninstall-feedback'),
		],
	},
	{
		id: 'listing-and-marketing',
		purpose: 'Prepare listing copy, screenshots, landing page, support links and AI discovery assets.',
		tools: [],
		access:
			'Use CLI generate-listing / review-risk and cabinet tools where enabled. MCP has no listing, landing-page or SEO execution tool.',
		urls: [
			docs('cli'),
			docs('ai-visibility'),
			docs('store-policies'),
			toolPage('page-generator'),
			toolPage('seo-optimizer'),
			toolPage('ai-visibility'),
		],
	},
	{
		id: 'verification-and-ci',
		purpose:
			'Test the built extension in each target browser, review store risks, scan the final package and retain reports in CI.',
		tools: ['scan_extension'],
		access:
			'Scan requires a local artifact and API key, and spends 1 scan credit. CLI review-risk is local. Configure GitHub Actions in the repository; browser tests use the agent environment.',
		urls: [docs('cli'), docs('cli-github-actions'), docs('store-policies')],
	},
	{
		id: 'publishing',
		purpose:
			'Validate store credentials, submit the exact tested package and verify review status and the public listing.',
		tools: ['publish_extension'],
		access:
			'Local stdio or CLI with local store credentials; publishing access is checked. Store registration, disclosures and review are separate steps. Upload success alone does not establish a live release.',
		urls: [docs('cli'), docs('publish-to-chrome-web-store'), toolPage('publish')],
	},
	{
		id: 'maintenance',
		purpose:
			'Claim the listing, respond to findings, inspect reviews/uninstall feedback, update policies and maintain releases.',
		tools: ['get_reviews', 'get_security', 'get_project_state'],
		access:
			'Catalog reads are metered. Ownership, declarations, responses, badges and feedback management use the cabinet; consult account access.',
		urls: [
			docs('claim-your-extension'),
			docs('respond-to-findings'),
			docs('security-badge'),
			docs('uninstall-feedback'),
			docs('data-declaration'),
		],
	},
	{
		id: 'monetization',
		purpose:
			'Optional paid-feature integration: seller setup, offers, checkout, signed entitlements and purchase verification.',
		tools: [
			'list_pay_apps',
			'create_pay_app',
			'get_pay_app',
			'get_pay_readiness',
			'link_pay_app',
			'unlink_pay_app',
			'archive_pay_app',
			'export_pay_data',
			'get_pay_seller',
			'connect_pay_seller',
			'refresh_pay_seller',
			'set_pay_seller_profile',
			'upsert_pay_offer',
			'archive_pay_offer',
			'set_pay_enabled',
			'rotate_pay_key',
		],
		access:
			'Pay applications work independently of development projects. Explicit pay.read/pay.write permission is required; older connections and API keys have no Pay grant. Check get_pay_readiness and actual SDK distribution before integrating. Author completes seller agreement and Stripe KYC in the browser. Configure offers and profile, then enable checkout only with explicit authorization. Registration does not prove production deployment or npm publication.',
		urls: [docs('pay-sdk'), 'https://dojo.extenshi.io/payments'],
	},
] as const

const WORKFLOW = [
	{
		id: 'scope',
		actions:
			'Record the user problem, target sites and browsers, MVP, permissions/data needs, acceptance criteria, distribution and optional monetization. Inspect available tools with get_development_guide; use search_docs for current details. Keep deferred features out of release promises.',
		doneWhen:
			'A written scope and acceptance checklist cover implementation, testing, assets, release and maintenance.',
	},
	{
		id: 'research',
		actions:
			'If market research is needed, check get_credit_balance, then search_extensions / market_overview, get_extension and get_reviews for a small relevant set. Use get_security for detailed findings or get_risk_by_store_ids for a batch. Record gaps and constraints.',
		doneWhen:
			'The chosen feature and supported surfaces have evidence; optional research is marked skipped with a reason.',
	},
	{
		id: 'project-and-repository',
		actions:
			'With identity, call list_my_projects then get_project_state for the selected project. Reuse its repository. If no project exists, create/configure one in dojo where available; otherwise continue locally and record that integration is pending. Create or reuse a Git remote, preferably GitHub, before substantial implementation.',
		doneWhen:
			'Project ID (or explicit pending status), repository URL, branch, README, build commands and release checklist are recorded.',
	},
	{
		id: 'architecture-and-scaffold',
		actions:
			'Call list_extension_templates, choose minimum permissions and browser-specific files. For a new project call get_project_scaffold once per browser into separate outputs; preserve existing code when integrating an existing repository. Read includeToolStates only for needed keys. Write integration.file verbatim to integration.path, review integration.unwired and re-read state after cabinet changes.',
		doneWhen:
			'Each manifest references real packaged files; browser variants and the project integration contract are preserved.',
	},
	{
		id: 'implementation',
		actions:
			'Implement the MVP, accessible popup/options, storage and error handling. Test actual target sites and extension lifecycle, including service-worker restart and permission denial. Use localize_workflow for local message translation, structural validation and manual language/RTL review. If payments or user accounts are needed, verify the supported integration and complete its prerequisites before depending on it.',
		doneWhen:
			'Acceptance criteria pass on real target surfaces; optional integrations have end-to-end evidence or remain explicit blockers.',
	},
	{
		id: 'assets-and-hosted-pages',
		actions:
			"Use generate_icon_workflow and generate_welcome_page_workflow as needed. Prepare screenshots, pin/install instructions, a privacy policy, uninstall feedback, support and landing URLs. For an existing Pro policy, list/read versions, then update_privacy_policy_with_ai when needed, review proposedMarkdown and publish within the author's authorization. Re-read get_project_state and verify the returned URLs.",
		doneWhen:
			'Assets show the real product; hosted links load and match actual data practices; installation/uninstallation flows work.',
	},
	{
		id: 'quality-and-listing',
		actions:
			'Build each browser package; run unit/integration checks and manual browser scenarios. Get exact review-risk and generate-listing commands from search_docs; review disclosures, permission justifications, listing copy and screenshots against the build. Run scan_extension if available, otherwise the local CLI. Add CI using cli-github-actions docs.',
		doneWhen:
			'The exact versioned artifact has passing checks, retained scan/review reports and truthful store materials; unresolved findings have a disposition.',
	},
	{
		id: 'release',
		actions:
			"Verify store accounts, credentials and submission access; use publish_extension with validate_only first when available. Submit the tested artifact within the user's publishing authorization through local MCP, CLI or the store console. Record upload, submission, approval and public-listing status separately.",
		doneWhen:
			'Store status and installed version are verified; pending store review is reported as pending, with artifact and source commit recorded.',
	},
	{
		id: 'operate',
		actions:
			'Claim the catalog listing, maintain declarations and a security badge, review findings and uninstall feedback, verify optional purchase/license flows, and plan updates. Repeat build, review, scan, policy and release checks for later versions.',
		doneWhen:
			'A handoff records repository/commit, artifacts, URLs, checks, remaining blockers, support owner and follow-up work.',
	},
] as const

export function buildDevelopmentGuide(registeredTools: readonly GuideTool[]) {
	const names = new Set(registeredTools.map((tool) => tool.name))
	return {
		schemaVersion: 1,
		documentation: DEVELOPMENT_GUIDE_URL,
		availability:
			'tools lists the tools registered on THIS connection. Registration does not prove account access, remaining credits or local prerequisites. Service URLs describe where work happens; check live account/project access. Use MCP tools/list for the exact input schemas. This guide makes no network calls.',
		tools: registeredTools.map((tool) => ({
			...tool,
			docs: [
				...new Set(
					DEVELOPMENT_SERVICES.filter((s) => (s.tools as readonly string[]).includes(tool.name)).flatMap(
						(s) => s.urls.filter((url) => url.startsWith('https://docs.extenshi.io/')),
					),
				),
			],
		})),
		localActions: ['scan_extension', 'publish_extension'].map((name) => ({
			name,
			availableInThisConnection: names.has(name),
			fallback:
				'Use local @extenshi/mcp (stdio), or npx @extenshi/cli@latest on the machine holding the artifact. Read search_docs for exact commands and prerequisites.',
			docs: docs('cli'),
		})),
		services: DEVELOPMENT_SERVICES.map(({ tools, ...service }) => ({
			...service,
			toolsInThisConnection: tools.filter((name) => names.has(name)),
		})),
		repository: {
			recommendation:
				'Keep source in a developer-owned Git repository; prefer GitHub for the existing dojo integration and GitHub Actions. Reuse the bound repository. GitLab, Bitbucket or self-hosted Git also work with local code and CI; their automatic dojo binding is not provided by these MCP tools.',
			setup:
				"Choose repository owner and visibility with the developer; use a private repository unless public source is intended. Connect GitHub at https://dojo.extenshi.io/integrations and select the repository in the project where enabled. Repository creation/writes use GitHub, its connector/CLI or the cabinet, with the user's authorization.",
			layout: [
				'README.md: setup, target browsers, build/test/release commands',
				'src/: extension logic and extenshi.config.js at the path supplied by the project',
				'assets/ and _locales/: icons and translations (follow the chosen framework layout)',
				'tests/: behavior and browser scenarios',
				'docs/: privacy source, listing copy, support and release checklist',
				'.github/workflows/: build, tests and artifact scan',
				'dist/: generated per-browser packages; attach versioned artifacts to CI/releases',
			],
			practice:
				'Commit source, dependency lockfile and .env.example with placeholders. Keep tokens, store credentials, signing keys, .env and user data in local/CI secret storage. Use branches and reviewable pull requests; associate release artifacts with a source commit/tag.',
			docs: [
				'https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories',
				docs('cli-github-actions'),
				DEVELOPMENT_GUIDE_URL,
			],
		},
		workflow: WORKFLOW,
		handoff: [
			'scope and acceptance criteria',
			'project ID, repository URL, branch and commit',
			'completed/skipped/blocked stages with reasons',
			'per-browser artifact version and checks',
			'hosted policy/onboarding/support URLs',
			'store submission versus live status',
			'optional payment verification',
			'remaining actions and owners',
		],
	}
}
