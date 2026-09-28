# @extenshi/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that brings the
**Extenshi extension catalog** — search, security analysis, market research, and
pre-publish scanning — into your AI tools (Claude Code, Claude Desktop, Cursor, …).

It runs locally over **stdio**, so there's nothing to host. It reuses your existing
Extenshi API key (the same one `@extenshi/cli` uses) and talks to the public Extenshi
backend on your behalf.

## Get an API key

An API key is required for catalog and own-project tools. Documentation, templates and static
workflow guides, including `get_development_guide`, work without a key. The backend enforces access
and project entitlements for authenticated operations.

1. Sign up at **https://auth.extenshi.io/signup**
2. Create a key at **https://dojo.extenshi.io/api-keys**
3. Provide it via the `EXTENSHI_API_KEY` environment variable (or run
   `npx @extenshi/cli@latest login`, which the MCP server reads from
   `~/.extenshi/config.json`).

## Configure your MCP client

```json
{
  "mcpServers": {
    "extenshi": {
      "command": "npx",
      "args": ["-y", "@extenshi/mcp@latest"],
      "env": { "EXTENSHI_API_KEY": "ek_…" }
    }
  }
}
```

## Plan the whole lifecycle

Call `get_development_guide` first for the complete tool inventory on this connection, the Extenshi
service directory, prerequisites and documentation links, GitHub source/CI guidance, and the ordered
plan through implementation, testing, store release and maintenance. The inventory is built from
registered tools. The remote connector shares this guide and directs local artifact operations to
stdio or CLI. See the [development workflow](https://docs.extenshi.io/developers/development-workflow).

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `search_extensions` | Hybrid search across Chrome/Firefox/Edge with filters (store, category, pricing, rating, risk, permissions) | 1 read |
| `get_extension` | Full catalog detail for one extension — by numeric catalog ID **or** by its store id (see below) | 1 read |
| `get_reviews` | Paginated Firefox/Edge user reviews (rating, short excerpt, date, language) + a store-level aggregate (rating, count, reviews link) — Chrome Web Store review rows excluded (aggregate is the only public content for Chrome); reviewer identity omitted; sort by recent or rating | 1 read |
| `get_security` | Risk score + finding counts + top grouped findings (reads existing scans) | 3 reads |
| `get_risk_by_store_ids` | Safety scores for **up to 40** extensions in one call, by store id — for auditing a list of installed extensions instead of calling `get_security` per extension | 1 read per call |
| `market_overview` | Catalog-wide market intelligence with no args (totals, store split, category tree, and the extended breakdown — MV2/MV3, sensitive permissions, risk tiers, trader status, recency, reviews); pass a `query` to scope facets to a search; `facets` selects groups and `top_n` (default 10) trims long lists | 1 read |
| `get_credit_balance` | Remaining credits across every pool (read / scan / icon / inventory), so an agent can size a batch before running it instead of hitting a mid-batch limit | Free |
| `get_development_guide` | Complete tool inventory for this connection, service directory, GitHub guidance and the ordered development-to-maintenance plan; compact overview by default, full parts via `sections` | Free (no key) |
| `list_extension_templates` | Extension shapes, minimum permissions and browser-specific manifest requirements | Free (no key) |
| `connection_diagnostics` | Authentication, scopes, backend workspace contracts and capabilities | Free; identity required |
| `import_manifest` | Import manifest JSON into the Dojo editor and project labels; preview changes and apply with a state hash. | Requires project.write for OAuth |
| `get_project_workspace` | Revisioned repository metadata, source/built manifests, scope and release snapshot | Free; identity required |
| `diff_project_state` | Three-way metadata preview against a server-held base revision | Free; project read access |
| `apply_project_patch` | Apply a typed metadata patch with conflicts, tombstones and idempotency | Requires project.write for OAuth |
| `create_ci_ingest_secret` | Create or rotate the CI evidence ingest secret (shown once, store in Actions secrets) | Requires project.write for OAuth |
| `upsert_hosted_page` | Register the project homepage/support URL (HTTPS, reachable, hashed) | Requires hosted.write for OAuth |
| `verify_hosted_artifact` | Re-fetch and compare a hosted page against its record (verified/changed/unreachable) | Requires hosted.write for OAuth |
| `remove_hosted_page` | Forget a registered homepage/support URL (public page keeps working) | Requires hosted.write for OAuth |
| `list_hosted_pages` | Registered hosted pages with verification status | Free; identity required |
| `publish_landing_page` | Host the landing page at page.extenshi.io/{code} from the Page generator form (versioned; registered as the homepage by default) | Requires hosted.write for OAuth |
| `get_landing_page` | Hosted landing page code, live version, URL and form | Free; identity required |
| `unpublish_landing_page` | Take the hosted landing page offline (same URL on the next publish) | Requires hosted.write for OAuth |
| `record_project_evidence` | Store metadata bound to the exact artifact, input hash, browser and source revision | Requires evidence.write for OAuth |
| `get_release_readiness` | Explain current, stale and missing release checks by browser and locale | Pro project; project read access |
| `list_my_projects` | Your projects, repository bindings and claimed listings | Free; identity required |
| `get_project_state` | Manifest, selected types, saved-state index, hosted URLs and exact integration file | Free; identity required |
| `get_project_scaffold` | Starter files for one project and target browser | Free; identity required |
| `list_privacy_policy_versions` | Hosted policy version history | Pro project; no read credit |
| `get_privacy_policy_version` | One hosted policy's markdown and HTML | Pro project; no read credit |
| `update_privacy_policy_with_ai` | Propose a policy update for the author to review; `aiStep` states whether the AI step ran, otherwise the proposal is a section merge | Pro project; daily update limit applies |
| `publish_privacy_policy` | Publish a policy at the project's hosted URL | Pro project; changes the live page |
| `search_docs` | Search the Extenshi docs + `@extenshi/cli` reference so the assistant can quote exact commands; returns top `limit` passages capped at `max_chars` each | Free (no key) |
| `localize_workflow` | Local message translation contract, CLI validation and manual review gates | Free (no key) |
| `generate_icon_workflow` | Icon design requirements + the local agent-draws-SVG → `npx @extenshi/cli@latest icon preview` → export workflow | Free (no key) |
| `generate_welcome_page_workflow` | Design brief for the post-install welcome page: the one action it must drive, which illustrations to produce, where to place click markers, and the block JSON to return | Free (no key) |
| `generate_landing_page` | Static landing-page (homepage) HTML with no JavaScript — same generator as the cabinet Page generator; returns `{html, bytes, warnings, nextSteps}`. Host it on any HTTPS origin and register the URL with `upsert_hosted_page` (feeds `HOMEPAGE_URL`) | Free (no key) |
| `scan_extension` | Pre-publish security scan of a local artifact (.zip/.crx/.xpi), with live progress | 1 scan |
| `publish_extension` | Publish to Chrome/Firefox/Edge with your own store credentials (fully local) | Free |

### Identifying an extension by its store id

`get_extension`, `get_reviews`, `get_security` and `scan_extension` accept **either** the numeric
catalog `extension_id` **or** the extension's `store_id` — the id straight from the store URL, which
is usually the only precise identifier you have:

```jsonc
{ "store_id": "cjpalhdlnbpafiamejdnhcphjbkeiagm", "store": "CHROME" }  // Chrome/Edge: `store` required
{ "store_id": "dark-reader" }                                          // Firefox: unambiguous
```

`store` is required for a Chrome/Edge id because both stores use the identical 32-character format;
Firefox ids (slug, GUID, or email-style) route automatically. Resolving a store id is free — only the
read that follows costs a credit.

### Credits

Every account gets a one-time free allowance of 10 reads and 3 scans (no card required). Beyond
that, buy prepaid credit packs (up to 10,000 reads and 1,000 scans per pack) that never expire.
Call `get_credit_balance` (free) to check what's left before running a large batch.
Manage credits at https://dojo.extenshi.io/billing.

## Configuration

The backend endpoints are compiled into the package and always point at production — only the API
key is read from the environment.

| Env var | Purpose |
| --- | --- |
| `EXTENSHI_API_KEY` | Your `ek_…` developer key (required) |

## Develop

```bash
yarn build            # tsc -> dist/
# Inspect locally:
EXTENSHI_API_KEY=ek_… npx @modelcontextprotocol/inspector node dist/index.js
```

Publishing is handled by `./scripts/publish.sh` (npm Automation token from Infisical;
`DRY_RUN=1 ./scripts/publish.sh` to validate). Requires Node ≥20.

See the [project synchronization workflow](https://docs.extenshi.io/developers/project-sync) for CLI commands, revision conflicts, evidence freshness and OAuth recovery.


### Standalone Pay applications

These tools require a backend with standalone Pay support. A development project is optional. Request explicit `pay.read` and/or `pay.write` OAuth scopes, or grant Pay permissions to a local API key in [API keys](https://dojo.extenshi.io/api-keys). Older credentials have no Pay access. Tool registration does not prove backend rollout or SDK npm publication.

| Tool | Permission | Behavior |
| --- | --- | --- |
| `list_pay_apps` | `pay.read` | List your independent Pay applications. No development project required. Follow nextCursor for more results. |
| `create_pay_app` | `pay.write` | Create an independent Pay application; linking a development project is optional. Creates a new application on every call: do not retry blindly after a timeout. |
| `get_pay_app` | `pay.read` | Read your Pay application and optional project link. |
| `get_pay_readiness` | `pay.read` | Check current checkout and launch prerequisites. A passing checkout check does not prove a live external purchase or SDK publication. |
| `link_pay_app` | `pay.write` | Link your Pay application to your development project. Existing purchases remain attached to the Pay application. |
| `unlink_pay_app` | `pay.write` | Remove the optional development-project link without deleting Pay data. |
| `archive_pay_app` | `pay.write` | Archive your application and stop new checkout. Preserve payment records and existing entitlements. |
| `export_pay_data` | `pay.read` | Export one page of your application data. Follow nextCursor until null for a complete export. Customer/payment data is sensitive: save only to an author-controlled destination; never paste into public issues. |
| `get_pay_seller` | `pay.read` | Read seller connection, public profile, offers and publishable SDK key. Agreement signing and KYC require the author in the browser. |
| `connect_pay_seller` | `pay.write` | Start Stripe Connect onboarding and return a browser action URL. The author must complete KYC and legal acceptance; never do these on their behalf. |
| `refresh_pay_seller` | `pay.write` | Refresh current payment-provider onboarding status. This does not complete KYC or accept agreements. |
| `set_pay_seller_profile` | `pay.write` | Save author-confirmed public seller identity, support and terms links. Never invent legal identity or terms. |
| `upsert_pay_offer` | `pay.write` | Create or update an offer by stable SKU. Price is in minor currency units. Use only the author-approved price, billing interval and features. |
| `archive_pay_offer` | `pay.write` | Stop offering a SKU for new checkout; preserve historical purchases. |
| `set_pay_enabled` | `pay.write` | Explicitly enable or disable new payments. Enabling is a live commerce change: only do so with author authorization and after checking readiness. Backend prerequisites remain enforced. |
| `rotate_pay_key` | `pay.write` | Generate a new publishable SDK key. Prior keys remain accepted for installed extension builds; this is not secret revocation. Never retry blindly. |

The author completes legal acceptance and Stripe KYC in the browser. Read `get_pay_readiness` before enabling checkout; enablement, key rotation and offer changes require explicit author authorization. Export pages contain private financial data and must remain in an author-controlled destination. Only the publishable SDK key belongs in an extension, never a developer API key or Stripe secret.
