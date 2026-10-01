/** Developer lifecycle reference shared by local and hosted MCP transports.
 * Tool inventory comes from registration, so it describes this server instance.
 * Cabinet services are a directory, not a claim about the caller's entitlements.
 *
 * Written as reference material (process descriptions, requirements, related
 * tools), not as directives: every entry reads the same to a developer as to
 * any client that renders it.
 *
 * Token frugality: the default response is a compact overview plus a table of
 * contents; full sections are returned only when requested via `sections`.
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
		purpose: 'Capabilities, extension shapes, exact CLI commands and reusable skill packages.',
		tools: ['get_development_guide', 'search_docs', 'list_extension_templates'],
		access: 'Free reference; no API key. Hosted transport still requires connector sign-in.',
		urls: [docs('mcp'), DEVELOPMENT_GUIDE_URL, docs('agent-skills')],
	},
	{
		id: 'account',
		purpose: 'Sign-in, API keys for local tools and credit-pool balances ahead of paid work.',
		tools: ['get_credit_balance', 'connection_diagnostics'],
		access: 'Balance lookup is free and requires identity; catalog reads and scans use credit pools.',
		urls: [docs('scan-credits'), 'https://dojo.extenshi.io/api-keys', 'https://dojo.extenshi.io/billing'],
	},
	{
		id: 'research',
		purpose: 'Demand, competitors, user complaints, permissions and existing security findings.',
		tools: [
			'search_extensions',
			'get_extension',
			'get_reviews',
			'get_security',
			'get_risk_by_store_ids',
			'market_overview',
		],
		access:
			'Identity required. Catalog tools cost 1 read per call; get_security costs 3. Bulk risk: up to 40 per call. Chrome review text is unavailable; its aggregate rating is available.',
		urls: [docs('mcp'), 'https://catalog.extenshi.io'],
	},
	{
		id: 'projects',
		purpose:
			'Existing projects: selected browser types, manifests, repository binding, saved tool state, hosted URLs and starter files.',
		tools: [
			'list_my_projects',
			'create_project',
			'get_project_state',
			'get_project_scaffold',
			'get_decisions',
			'propose_decision',
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
			'Own-project MCP reads are free and require identity. Projects are created in the cabinet or with create_project (idempotent, project.write). Owner decisions (AMO add-on id, license, seller identity, pricing, targets) are proposed by agents and decided only by the owner in the cabinet; release readiness reports undecided ones as blockers. Repository metadata, source/built manifests and scope synchronize through typed revisioned patches. project.write, evidence.write and hosted.write require explicit OAuth consent. Repository metadata does not grant GitHub access. CI evidence (source=ci) is written only by the verified ingest endpoint, which authenticates with a secret from create_ci_ingest_secret. Automated release-readiness access requires a Pro project.',
		urls: [
			DEVELOPMENT_GUIDE_URL,
			'https://dojo.extenshi.io/projects',
			'https://dojo.extenshi.io/integrations',
		],
	},
	{
		id: 'manifest',
		purpose: 'Minimum permissions, target browsers and manifest entries, with every referenced file present.',
		tools: ['list_extension_templates', 'get_project_state', 'get_project_scaffold'],
		access:
			'Free template reference; project reads require identity. The cabinet also has a manifest editor.',
		urls: [docs('manifest-generator'), toolPage('manifest-generator')],
	},
	{
		id: 'localization',
		purpose: 'Local translation of extension messages and validation of the resulting locales.',
		tools: ['localize_workflow'],
		access:
			"Free static reference; local CLI validation requires no key or Extenshi credits. Translation uses the developer's own provider. CLI release availability is part of the reference.",
		urls: [docs('localization')],
	},
	{
		id: 'icons',
		purpose: 'SVG icon design, toolbar-size preview and store-asset export with the local CLI.',
		tools: ['generate_icon_workflow'],
		access:
			'Free. Drawing, browser preview and file export happen locally; the cabinet offers its own icon generator subject to availability and credits.',
		urls: [docs('icon-generator'), toolPage('icon-generator')],
	},
	{
		id: 'privacy',
		purpose:
			'A policy that reflects actual data practices: generated and exported, or hosted with version history.',
		tools: [
			'list_privacy_policy_versions',
			'get_privacy_policy_version',
			'update_privacy_policy_with_ai',
			'publish_privacy_policy',
			'get_legal_translations',
			'set_legal_translations',
		],
		access:
			'Hosted policy tools require an owned Pro project. Version reads spend no credit; AI updates have a per-project daily limit. publish_privacy_policy changes the live page. The browser generator supports export. The English policy (and Pay license terms) is the binding text at the base URL; translated copies for the project’s languages live at <url>/<locale> with a notice linking to the English original — Extenshi translates its template text, the developer translates edited sections and free-text answers with get_legal_translations / set_legal_translations.',
		urls: [docs('privacy-policy-generator'), docs('data-declaration'), toolPage('privacy-policy-generator')],
	},
	{
		id: 'onboarding',
		purpose:
			'Welcome page, pin guide, install instructions and uninstall survey, with verified URLs wired into the extension.',
		tools: [
			'generate_welcome_page_workflow',
			'get_project_state',
			'get_install_instructions',
			'publish_install_instructions',
			'unpublish_install_instructions',
			'get_page_translations',
			'set_page_translations',
		],
		access:
			'Free welcome-page specification. Editing, hosting and responses live in the cabinet where enabled; account/project limits apply. MCP returns specifications and saved state, and publishes the install instructions page (free; hosted.write) — the uninstall form and welcome page are published from the cabinet. The hosted uninstall form, welcome page and install instructions open in the user’s browser language (the generated snippets pass chrome.i18n.getUILanguage() as `hl`) when the project offers it, otherwise in the project’s own language: built-in text is translated by Extenshi (en + 10 languages); the developer’s own text is translated per field with get_page_translations / set_page_translations (identity; hosted.write to save).',
		urls: [
			DEVELOPMENT_GUIDE_URL,
			docs('pin-guide'),
			docs('install-instructions'),
			docs('uninstall-feedback'),
			toolPage('onboarding-page'),
			toolPage('instruction-generator'),
			toolPage('install-instructions'),
			toolPage('uninstall-feedback'),
		],
	},
	{
		id: 'listing-and-marketing',
		purpose: 'Listing copy, screenshots, landing page, support links and AI discovery assets.',
		tools: [
			'generate_landing_page',
			'draft_landing_page',
			'preview_landing_page',
			'publish_landing_page',
			'get_landing_page',
			'list_landing_page_versions',
			'rollback_landing_page',
			'unpublish_landing_page',
			'get_custom_domain',
			'set_custom_domain',
			'verify_custom_domain',
			'remove_custom_domain',
			'upload_project_media',
			'upsert_hosted_page',
		],
		access:
			"The landing-page generator is free and offline: it returns static HTML (CLI: extenshi page generate). Schema v2 (schemaVersion 2) makes it a full homepage: ordered sections (hero, about, features, screenshots, how-it-works, pricing bound to Pay offers by SKU, FAQ with FAQPage JSON-LD, attributed testimonials only, store badges, changelog, links), theme tokens from allowlists, SEO/OG fields, per-locale pages with hreflang, and llms.txt — all declarative, no HTML or JS. draft_landing_page (project.read; CLI: extenshi page draft) builds a v2 form from project state and lists what it could not fill; preview_landing_page (CLI: extenshi page preview) validates and renders exactly what publish would serve, with a path and fix per problem. The same page can be hosted by Extenshi at page.extenshi.io/{code} with publish_landing_page (identity and hosted.write; CLI: extenshi page publish), which also registers it as the project homepage; every publish is a version (list_landing_page_versions / rollback_landing_page; CLI: extenshi page versions / rollback). A custom domain (Pro, one per project; set/verify/get/remove_custom_domain, CLI: extenshi domain add|verify|status|remove) serves the homepage at the domain root after a TXT ownership check and an HTTPS certificate, and switches its canonical and HOMEPAGE_URL; ownership is re-checked every 6 hours and a domain that loses its TXT record is suspended; images there are store screenshots, Dojo uploads or files uploaded with upload_project_media (hosted.write; CLI: extenshi media upload, or page publish --upload-local) to the project's public media store. Store screenshots per locale come from CLI extenshi screenshots and listing artwork from CLI extenshi icon store-assets (formats and sizes: guide section storeMedia). A page hosted elsewhere on HTTPS is registered with upsert_hosted_page (CLI: extenshi page register). The registered homepage feeds HOMEPAGE_URL. Listing copy and store-risk review are covered by CLI generate-listing / review-risk and cabinet tools where enabled. MCP has no listing or SEO execution tool.",
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
			'Reproducible per-browser packages, installed smoke tests of the exact package in Chromium, Edge and Firefox, store-risk review, final package scan, and release evidence recorded from those results.',
		tools: ['scan_extension', 'record_project_evidence', 'get_release_readiness'],
		access:
			'Local CLI, free: `extenshi package <dir> --browser chrome,edge,firefox` writes byte-reproducible zips plus extenshi-packages.json (sha256 per browser; refuses a placeholder Firefox add-on ID; --fix-war expands wildcard web_accessible_resources). `extenshi test smoke <zip|extenshi-packages.json> --browser chromium|edge|firefox --json` installs that exact zip and checks service worker/background start, manifest errors and console errors on popup/options pages (Playwright for Chromium/Edge, any Firefox binary). `--evidence` on scan, review-risk, generate-listing, test smoke and screenshots records scan / permissions / listing (per locale) / installed / screenshots (per locale and store) evidence for the project bound with `extenshi project bind` (advisory listing findings stay passed and are listed in the evidence summary); release prepare accepts extenshi-packages.json. Scan requires an API key and spends 1 scan credit. CI: the scaffold writes .github/workflows/extenshi-verify.yml and extenshi-evidence.yml; CI-sourced evidence arrives through `extenshi evidence ingest` with the create_ci_ingest_secret secret.',
		urls: [docs('cli'), docs('cli-github-actions'), docs('store-policies')],
	},
	{
		id: 'publishing',
		purpose:
			'Store credential validation, submission of the exact tested package to Chrome Web Store, Firefox Add-ons and/or Edge Add-ons, and verification of review status and the public listing.',
		tools: ['publish_extension'],
		access:
			'Local stdio or CLI with local store credentials; publishing access is checked. Store registration, disclosures and review are separate steps. Upload success alone does not establish a live release. ' +
			'CLI: extenshi publish --stores chrome,edge,firefox (comma-separated; a subset also works, e.g. --stores firefox,edge) submits to every named store from the tested artifact. ' +
			'Firefox/AMO adds requirements the other stores do not have: browser_specific_settings.gecko.id is required to sign a Manifest V3 add-on and should be treated as permanent once first published; ' +
			'new add-ons submitted since 2025-11-03 must declare browser_specific_settings.gecko.data_collection_permissions; minified/bundled/transpiled code needs a source-code submission with reproducible build instructions (extenshi amo-source generates the archive and BUILD.md); and `web-ext lint` should report 0 errors before submission. ' +
			"Microsoft Edge Add-ons: a NEW extension's first submission must be created by hand in Partner Center — the REST API (publisher/src/services/edge.ts) only uploads a package and publishes an EXISTING submission, it cannot create one.",
		urls: [
			docs('cli'),
			docs('publish-to-chrome-web-store'),
			docs('publish-to-edge-add-ons'),
			docs('publish-to-firefox-add-ons'),
			toolPage('publish'),
		],
	},
	{
		id: 'maintenance',
		purpose:
			'Listing claims, finding responses, reviews and uninstall feedback, policy updates and ongoing releases.',
		tools: ['get_reviews', 'get_security', 'get_project_state'],
		access:
			'Catalog reads are metered. Ownership, declarations, responses, badges and feedback management live in the cabinet and depend on account access.',
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
			'get_pay_payment_evidence',
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
			'get_pay_offer_translations',
			'set_pay_offer_translations',
			'set_pay_enabled',
			'rotate_pay_key',
		],
		access:
			'Pay applications work independently of development projects. Explicit pay.read/pay.write permission is required; older connections and API keys have no Pay grant. Readiness (get_pay_readiness) and the actual SDK distribution determine whether integration is possible. The author completes the seller agreement and Stripe KYC in the browser. Checkout is enabled only after offers and profile are configured, and only with explicit authorization. Registration does not prove production deployment or npm publication.',
		urls: [docs('pay-sdk'), 'https://dojo.extenshi.io/payments'],
	},
] as const

/**
 * The development lifecycle as a process description. `actions` describes what
 * the stage consists of; `relatedTools` is a factual list of the tools that
 * cover it (not an instruction to call them); `doneWhen` is the exit criterion.
 */
const WORKFLOW = [
	{
		id: 'scope',
		actions:
			'Stage 1 — Scope: the user problem, target sites and browsers, MVP, permissions/data needs, acceptance criteria, distribution and optional monetization are written down. Deferred features stay out of release promises.',
		relatedTools: ['get_development_guide', 'search_docs'],
		doneWhen:
			'A written scope and acceptance checklist cover implementation, testing, assets, release and maintenance.',
	},
	{
		id: 'research',
		actions:
			'Stage 2 — Research (optional): demand, competitors, user complaints and security findings for a small relevant set of existing extensions; gaps and constraints are recorded. Catalog reads are metered, so the credit balance matters here.',
		relatedTools: [
			'get_credit_balance',
			'search_extensions',
			'market_overview',
			'get_extension',
			'get_reviews',
			'get_security',
			'get_risk_by_store_ids',
		],
		doneWhen:
			'The chosen feature and supported surfaces have evidence; skipped research is recorded as skipped with a reason.',
	},
	{
		id: 'project-and-repository',
		actions:
			'Stage 3 — Project and repository: an existing dojo project and its bound repository are reused. Without a project, one is created in dojo where available, or work continues locally with integration recorded as pending. A Git remote (GitHub preferred) exists before substantial implementation.',
		relatedTools: ['list_my_projects', 'get_project_state'],
		doneWhen:
			'Project ID (or explicit pending status), repository URL, branch, README, build commands and release checklist are recorded.',
	},
	{
		id: 'architecture-and-scaffold',
		actions:
			'Stage 4 — Architecture and scaffold: extension types, minimum permissions and browser-specific files are chosen. A new project gets one scaffold per browser in separate outputs; an existing repository keeps its code. Tool states are read only for the keys the extension needs. integration.file is written verbatim to integration.path, integration.unwired lists what is still unconnected, and project state is re-read after cabinet changes.',
		relatedTools: ['list_extension_templates', 'get_project_scaffold', 'get_project_state'],
		doneWhen:
			'Each manifest references real packaged files; browser variants and the project integration contract are preserved.',
	},
	{
		id: 'implementation',
		actions:
			'Stage 5 — Implementation: the MVP, accessible popup/options, storage and error handling, tested on the actual target sites and across the extension lifecycle, including service-worker restart and permission denial. Localization covers message translation, structural validation and manual language/RTL review. Payments or user accounts depend on a verified supported integration with its prerequisites complete.',
		relatedTools: ['localize_workflow'],
		doneWhen:
			'Acceptance criteria pass on real target surfaces; optional integrations have end-to-end evidence or remain explicit blockers.',
	},
	{
		id: 'assets-and-hosted-pages',
		actions:
			"Stage 6 — Assets and hosted pages: icon, welcome page, screenshots, pin/install instructions, privacy policy, uninstall feedback, support and landing URLs. A landing page is generated as static HTML and either hosted by Extenshi (page.extenshi.io, or the project's custom domain root) or on any HTTPS origin; it is registered as the project homepage, which sets HOMEPAGE_URL. The homepage is drafted from project state (draft_landing_page), checked with preview_landing_page, published as a version and can be rolled back. An existing Pro policy is updated as a reviewed proposal (proposedMarkdown) and published within the author's authorization. Returned URLs are verified against project state.",
		relatedTools: [
			'generate_icon_workflow',
			'generate_welcome_page_workflow',
			'generate_landing_page',
			'draft_landing_page',
			'preview_landing_page',
			'publish_landing_page',
			'set_custom_domain',
			'verify_custom_domain',
			'upload_project_media',
			'upsert_hosted_page',
			'list_privacy_policy_versions',
			'get_privacy_policy_version',
			'update_privacy_policy_with_ai',
			'publish_privacy_policy',
			'get_project_state',
		],
		doneWhen:
			'Assets show the real product; hosted links load and match actual data practices; installation/uninstallation flows work.',
	},
	{
		id: 'quality-and-listing',
		actions:
			'Stage 7 — Quality and listing: each browser package is built reproducibly (CLI package), and that exact zip is installed and smoke-tested per browser (CLI test smoke); unit/integration checks and manual browser scenarios run. Disclosures, permission justifications, listing copy and screenshots are reviewed against the build (CLI review-risk and generate-listing --store chrome|edge|firefox, which draft CHROMEWEBSTORE.md / EDGE.md / AMO.md — the same listing draft review-risk --listing reads back regardless of which one). A Firefox build with minified/bundled code additionally needs extenshi amo-source (source archive + BUILD.md) and a clean `web-ext lint`. With --evidence, scan, review-risk, generate-listing, test smoke and screenshots record their release evidence for the bound project; the final package is scanned. Exact commands: the CLI docs. CI runs the scaffolded extenshi-verify workflow.',
		relatedTools: ['search_docs', 'scan_extension', 'get_release_readiness'],
		doneWhen:
			'The exact versioned artifact has passing checks, retained scan/review reports and truthful store materials; unresolved findings have a disposition.',
	},
	{
		id: 'release',
		actions:
			"Stage 8 — Release: store accounts, credentials and submission access are verified; a validate-only run precedes submission where available. The tested artifact is submitted within the user's publishing authorization through local MCP, CLI or the store console. Upload, submission, approval and public-listing status are recorded separately.",
		relatedTools: ['publish_extension'],
		doneWhen:
			'Store status and installed version are verified; pending store review is reported as pending, with artifact and source commit recorded.',
	},
	{
		id: 'operate',
		actions:
			'Stage 9 — Operate: catalog listing claim, declarations and security badge, findings and uninstall feedback, optional purchase/license flow checks, and planned updates. Later versions repeat the build, review, scan, policy and release checks.',
		relatedTools: ['get_reviews', 'get_security', 'get_project_state'],
		doneWhen:
			'A handoff records repository/commit, artifacts, URLs, checks, remaining blockers, support owner and follow-up work.',
	},
] as const

/** Top-level sections of the full guide, selectable via the `sections` parameter. */
export const GUIDE_SECTIONS = [
	'tools',
	'localActions',
	'services',
	'repository',
	'workflow',
	'handoff',
	'storeMedia',
] as const
export type GuideSection = (typeof GUIDE_SECTIONS)[number]

const SECTION_SUMMARIES: Record<GuideSection, string> = {
	tools: 'Every tool registered on this connection: description, read-only/destructive hints and docs links.',
	localActions: 'Artifact scan and store publishing: availability on this connection and the local fallback.',
	services: 'Service directory: purpose, related tools, access requirements and URLs per lifecycle area.',
	repository: 'Git repository recommendation, setup, layout and secret-handling practice.',
	workflow: 'The nine lifecycle stages with descriptions, related tools and exit criteria.',
	handoff: 'Items a completed handoff records.',
	storeMedia:
		'Store screenshots per locale (CLI screenshots + scenes.json format), listing artwork sizes per store (CLI icon store-assets) and the public project media store.',
}

/**
 * Store image requirements and the scenes format. Static reference: the CLI
 * (tools/extenshi-cli/src/store-assets.ts, screenshots-scenes.ts) is the
 * implementation; sizes cite the stores' own pages.
 */
const STORE_MEDIA = {
	screenshots: {
		command:
			'npx @extenshi/cli@latest screenshots <unpacked-dir|zip> --scenes scenes.json [--locales en,de] [--store chrome,edge,firefox] [--small] [--out store-screenshots] [--json] [--evidence --listing <file> [--evidence-browser chrome,edge,firefox]]',
		requires:
			'Playwright with the full Chromium build in the project (npm i -D playwright && npx playwright install chromium); the headless shell cannot load extensions. The source build is never modified: it is staged into a temporary copy.',
		output:
			'<out>/<store>/<locale>/NN-<scene>-WxH.png, plus <out>/screenshots.json (files with sha256, verified locales, warnings).',
		evidence:
			'--evidence records one `screenshots` readiness check per shot locale and store (the store is the browser) for the project bound with `extenshi project bind`, through the same path as `extenshi evidence push`. It binds to the zip that was shot (artifactDigest; an unpacked folder is refused) and to the --listing file (inputDigest — pass the same file to release prepare --listing). The browsers are --store when given, else the extenshi-packages.json next to the zip, and each must be a store the run shoots. A store whose listing file differs (AMO.md for Firefox) needs its own run with --store and that file. Status is failed when a store and locale have no screenshots or more than the store takes (Chrome 5, Edge 6). Binding, zip and listing are checked before Chromium starts. Each record carries the PNGs of that store for the locale as attachments in the private evidence storage of the project (the evidence push --attach upload: 10 MB per file, 20 per record); identical images upload once, and uploading needs a connection.',
		localeSwitching:
			'Each locale runs in a fresh Chromium with its UI language set (--lang; LANGUAGE on Linux; -AppleLanguages on macOS, where --lang has no effect). chrome.i18n inside the extension has to report the locale and render a message from _locales/<locale>; a mismatch fails the run. A locale missing from _locales is refused.',
		determinism:
			'Fixed viewport and device scale factor, reduced motion, animations/transitions/caret disabled, UTC timezone, optional fixed clock (time), fonts and images awaited before capture, store canvas composed by a WebAssembly renderer. Identical inputs produce byte-identical PNGs on the same machine.',
		sizes: {
			chrome:
				'1280×800 (default) or 640×400 with --small; full bleed; 1–5 per locale — https://developer.chrome.com/docs/webstore/images',
			edge: '1280×800 or 640×480 with --small; up to 6 — https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension',
			firefox:
				'1280×800 recommended (1.6:1), uploaded as AMO previews — https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/',
		},
		scenesFormat: {
			example: {
				version: 1,
				viewport: { width: 1280, height: 800 },
				deviceScaleFactor: 2,
				fixtures: 'fixtures',
				frame: { background: '#eef2ff', backgroundTo: '#e0e7ff', margin: 48, shadow: true, radius: 12 },
				setup: [{ storage: { area: 'local', set: { onboarded: true } } }],
				scenes: [
					{ name: 'popup', open: 'popup', steps: [{ click: '#enable' }, { wait: 300 }] },
					{
						name: 'on-a-page',
						open: 'fixture:article.{locale}.html',
						steps: [{ mouse: { x: 640, y: 330 } }],
					},
					{ name: 'options', open: 'options', crop: { selector: 'main', padding: 24 } },
				],
			},
			open: 'popup | options (from the manifest) | page:<path inside the extension> | fixture:<file under fixtures, served from 127.0.0.1> | url:https://…. {locale} and {lang} expand to the _locales code (pt_BR) and BCP 47 tag (pt-BR).',
			steps:
				'click <selector>, hover <selector>, type <selector> + text, press <key>, mouse {x,y}, scroll {x?,y}, wait <ms up to 30000>, waitFor <selector> (+state), storage {area: local|sync|session, set?, remove?, clear?} in the extension context, eval <JS expression> in the scene page.',
			sceneOptions:
				'viewport, colorScheme (light|dark), init (JS before the page scripts, e.g. stubbing chrome.tabs.query for a popup opened as a tab), crop (viewport | content — default for popup | fullPage | {selector, padding}), fit (contain — centered on the frame, not magnified past its captured pixels | cover), frame, stores (subset).',
			fileOptions:
				'viewport (default 1280×800), deviceScaleFactor (1–3), colorScheme, time (ISO date for Date.now), fixtures (dir, default the scenes file dir), animations (disabled|allow), frame {background, backgroundTo, margin, shadow, radius}, setup (steps run once per locale before the scenes), scenes (1–12).',
		},
	},
	storeAssets: {
		command:
			'npx @extenshi/cli@latest icon store-assets <icon.svg|png> [--store chrome,edge,firefox] [--out store-assets] [--background <color>] [--promo <file>] [--marquee <file>] [--font <file.ttf>]',
		outputs: {
			chrome:
				'icon-128.png (96×96 artwork + 16 px transparent padding), promo-small-440x280.png (required), marquee-1400x560.png — https://developer.chrome.com/docs/webstore/images',
			edge: 'logo-300x300.png (1:1, min 128), promo-small-440x280.png, promo-large-1400x560.png — https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension',
			firefox:
				'icon-128.png (AMO listing icon; AMO derives 32/64), icon-64.png and icon-32.png (manifest icons) — https://mozilla.github.io/addons-server/topics/api/addons.html#addon-icon',
		},
		notes:
			'Offline WebAssembly renderer, no API key. Built-in padding in the source is trimmed rather than doubled. Tiles are composed from the icon on a tint of its colour unless --promo / --marquee artwork is given; clipped content, wrong aspect ratios and upscaled rasters are reported as warnings. <style> blocks in SVG sources are removed by the scrubber; text uses matching system fonts or --font.',
	},
	publicMedia: {
		tool: 'upload_project_media (hosted.write)',
		cli: 'npx @extenshi/cli@latest media upload <file…> --project <id>, or page publish --upload-local',
		accepts:
			'PNG, JPEG or WebP up to 2 MB, 16–4096 px per side; SVG is rasterized by the CLI (the MCP tool refuses it). Magic bytes are checked, EXIF/XMP/text metadata and trailing bytes are stripped, and the key is the SHA-256 of the stored bytes, so the URL is stable and a re-upload returns the same URL. Quota: 100 files / 50 MB per project, Dojo uploads included.',
		use: 'The returned url is accepted by publish_landing_page as screenshots[].url, a screenshots section item url, seo.ogImageUrl or logoUrl.',
	},
} as const

const AVAILABILITY =
	'Tool lists describe the tools registered on THIS connection. Registration does not prove account access, remaining credits or local prerequisites. Service URLs describe where work happens; account/project access is checked live. Exact input schemas come from MCP tools/list. This guide makes no network calls.'

function buildSections(registeredTools: readonly GuideTool[]) {
	const names = new Set(registeredTools.map((tool) => tool.name))
	return {
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
				'Available through local @extenshi/mcp (stdio), or npx @extenshi/cli@latest on the machine holding the artifact. Exact commands and prerequisites: the CLI documentation.',
			docs: docs('cli'),
		})),
		services: DEVELOPMENT_SERVICES.map(({ tools, ...service }) => ({
			...service,
			toolsInThisConnection: tools.filter((name) => names.has(name)),
		})),
		repository: {
			recommendation:
				'Source lives in a developer-owned Git repository; GitHub fits the existing dojo integration and GitHub Actions. An already-bound repository is reused. GitLab, Bitbucket or self-hosted Git also work with local code and CI; automatic dojo binding for them is not provided by these MCP tools.',
			setup:
				"Repository owner and visibility are the developer's choice; private unless public source is intended. GitHub connects at https://dojo.extenshi.io/integrations, and the repository is selected in the project where enabled. Repository creation and writes go through GitHub, its connector/CLI or the cabinet, with the user's authorization.",
			layout: [
				'README.md: setup, target browsers, build/test/release commands',
				'src/: extension logic and extenshi.config.js at the path supplied by the project',
				'assets/ and _locales/: icons and translations (following the chosen framework layout)',
				'tests/: behavior and browser scenarios',
				'docs/: privacy source, listing copy, support and release checklist',
				'.github/workflows/: build, tests and artifact scan',
				'dist/: generated per-browser packages; versioned artifacts attached to CI/releases',
			],
			practice:
				'Committed: source, dependency lockfile and .env.example with placeholders. Kept in local/CI secret storage: tokens, store credentials, signing keys, .env and user data. Changes go through branches and reviewable pull requests; release artifacts are associated with a source commit/tag.',
			docs: [
				'https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories',
				docs('cli-github-actions'),
				DEVELOPMENT_GUIDE_URL,
			],
		},
		workflow: WORKFLOW,
		storeMedia: STORE_MEDIA,
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

export type GuideSections = ReturnType<typeof buildSections>

/** Normalise a caller's `sections` argument: unknown ids are dropped, `all` expands. */
export function resolveGuideSections(requested?: readonly string[]): GuideSection[] {
	if (!requested || requested.length === 0) return []
	if (requested.includes('all')) return [...GUIDE_SECTIONS]
	return GUIDE_SECTIONS.filter((section) => requested.includes(section))
}

/**
 * Build the guide. With no `sections`, returns the compact overview: tool names,
 * workflow stage ids with exit criteria, and a table of contents. Listed
 * sections (or `all`) are returned in full.
 */
export function buildDevelopmentGuide(
	registeredTools: readonly GuideTool[],
	requested?: readonly string[],
): { schemaVersion: 2; documentation: string; availability: string } & Partial<GuideSections> &
	Record<string, unknown> {
	const sections = resolveGuideSections(requested)
	const full = buildSections(registeredTools)
	const base = { schemaVersion: 2 as const, documentation: DEVELOPMENT_GUIDE_URL, availability: AVAILABILITY }

	if (sections.length > 0) {
		return { ...base, ...Object.fromEntries(sections.map((section) => [section, full[section]])) }
	}

	return {
		...base,
		overview:
			'Extenshi development lifecycle reference: idea and research, project and repository, scaffold, implementation, assets and hosted pages, quality and listing, store release, maintenance.',
		toolNames: registeredTools.map((tool) => tool.name),
		workflowStages: WORKFLOW.map(({ id, doneWhen }) => ({ id, doneWhen })),
		contents: GUIDE_SECTIONS.map((id) => ({
			section: id,
			summary: SECTION_SUMMARIES[id],
			entries: Array.isArray(full[id]) ? (full[id] as readonly unknown[]).length : undefined,
		})),
		sectionsParameter:
			'Full sections are included when named in the `sections` argument (e.g. ["workflow", "services"]); "all" returns every section.',
	}
}
