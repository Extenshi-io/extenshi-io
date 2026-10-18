# Developer tools

extenshi.io ships three public tools to npm. Catalog and scan calls authenticate
with your own Extenshi API key and talk to the public backend — there is nothing
to self-host, and with `npx` there is nothing to install either.

> **Get an API key** (free): sign up at <https://auth.extenshi.io/signup>, then
> create a key at <https://dojo.extenshi.io/api-keys>.
> Every account starts with a **one-time free allowance — 10 catalog reads and
> 3 scans**; beyond it, prepaid credit packs **never expire**. The `search_docs`
> and icon/welcome workflow capabilities are free and need no key at all.

**Always pin `@latest`.** `npx @extenshi/cli@latest` re-resolves the newest
published version on every run; a bare `npx @extenshi/cli` reuses whatever is in
your npx cache, and a global `npm i -g` install pins the version you installed
until you remember to upgrade it.

---

## `@extenshi/cli` — scan, predict the review, draft the listing, localize, sync the project, preview the icon, publish

[![npm](https://img.shields.io/npm/v/@extenshi/cli)](https://www.npmjs.com/package/@extenshi/cli)

→ **[Full command reference](./extenshi-cli/)** · **[Example output](../examples/)**

Scan a built extension artifact (`.zip` / `.crx` / `.xpi`) for security and
supply-chain risks **before** you ship it — and check the things that actually
get releases rejected. Designed to run in CI. Requires Node 20+.

```bash
npx @extenshi/cli@latest login                                        # once — browser sign-in, key saved to ~/.extenshi
npx @extenshi/cli@latest scan ./dist/my-extension.zip                 # security scan → HTML report (1 scan credit)
npx @extenshi/cli@latest review-risk ./dist/my-extension.zip          # store-review prediction (free, offline)
npx @extenshi/cli@latest generate-listing ./dist/my-extension.zip     # CHROMEWEBSTORE.md (free, offline)
npx @extenshi/cli@latest localize check ./extension                   # locale messages (free, offline)
npx @extenshi/cli@latest icon preview ./icon.svg                      # icon in real toolbars (free, offline)
npx @extenshi/cli@latest package ./extension --browser chrome,edge,firefox   # one store zip per browser (free, offline)
npx @extenshi/cli@latest test smoke ./dist/chrome.zip --browser chromium     # boots in a real browser (free, local)
npx @extenshi/cli@latest risk --file ./installed.txt                  # safety scores in bulk (1 read credit / 40 ids)
npx @extenshi/cli@latest project diff                                 # Dojo project metadata (API key)
npx @extenshi/cli@latest publish ./dist/my-extension.zip              # push to Chrome / Firefox / Edge, your own store creds
```

Only `scan` (1 scan credit) and `risk` (1 read credit per call, up to 40
extensions) spend credits. `review-risk`, `generate-listing`, `localize`, and
`icon preview` run without an Extenshi account. `publish` uses *your* store
credentials and uploads straight from your machine; it is in an active testing
phase, so sign in once and the CLI checks whether your account can publish.
`doctor`, `project`, `release`, and `evidence` use the same API key and do not
spend catalog read or scan credits. The long form is
[`extenshi-cli/README.md`](./extenshi-cli/) and
[the project sync guide](https://docs.extenshi.io/developers/project-sync).

Tired of typing it? `alias extenshi="npx @extenshi/cli@latest"` keeps every run
on the current version.

In CI, set `EXTENSHI_API_KEY` as a secret and fail the build on high-risk
findings. Every command and flag is documented in
[`extenshi-cli/README.md`](./extenshi-cli/) (and
`npx @extenshi/cli@latest --help`).

---

## `@extenshi/guard` — what is installed on this machine

[![npm](https://img.shields.io/npm/v/@extenshi/guard)](https://www.npmjs.com/package/@extenshi/guard)

→ **[Command reference](./extenshi-guard/)** · **[guard.extenshi.io](https://guard.extenshi.io)**

Reads the on-disk profiles of Chrome, Edge, Brave, Vivaldi, Opera, Arc, Yandex,
Chromium, and Firefox. `list` stays on the machine. `scan` asks before it sends
a privacy-minimal inventory (store id, store, version, enabled state, install
origin, install time, update URL) and then offers to remove or disable what you
pick. `undo` puts back what Guard changed.

```bash
npx @extenshi/guard@latest list          # local, no account
npx @extenshi/guard@latest login         # once, same ~/.extenshi key as the CLI
npx @extenshi/guard@latest scan          # catalog check + cleanup
```

---

## `@extenshi/mcp` — the catalog and your projects inside your AI tools

[![npm](https://img.shields.io/npm/v/@extenshi/mcp)](https://www.npmjs.com/package/@extenshi/mcp)

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the Extenshi catalog, security analysis, market research, your Dojo projects and
their hosted pages, and pre-publish scanning to **Claude, Cursor**, and any other
MCP client. It comes in two forms:

| | Remote connector | Local (stdio) |
| --- | --- | --- |
| **Where** | Hosted at `https://mcp.extenshi.io/mcp` | `npx -y @extenshi/mcp@latest` on your machine |
| **Sign-in** | Your Extenshi account in the browser (OAuth); no key to copy | `EXTENSHI_API_KEY` (`ek_…`) |
| **Clients** | Claude.ai, Claude Desktop, Cowork (custom connector by URL), or the [Extenshi plugin](../plugins/extenshi/) | Claude Code, Cursor, and any client that runs local servers |
| **Tools** | Everything except the two that work on local files | All tools, including `scan_extension` and `publish_extension` |

**Remote:** open **Settings → Connectors → Add custom connector**, paste
`https://mcp.extenshi.io/mcp`, sign in, and approve the consent screen.
[Setup guide](https://docs.extenshi.io/developers/mcp).

**Local:** add this to your MCP client config:

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

`-y @extenshi/mcp@latest` is deliberate: the client re-resolves the package on
launch, so a long-lived MCP config doesn't freeze on an old server build.

**What the tools cover.** The complete list, with the cost of every tool, is in
[`extenshi-mcp/README.md`](./extenshi-mcp/README.md#tools) (the server's source is
mirrored there from our monorepo on every release). In short:

| Area | Tools | Cost |
| --- | --- | --- |
| Catalog research | `search_extensions`, `get_extension`, `get_reviews`, `get_security`, `get_risk_by_store_ids`, `market_overview` | Read credits (`get_security` = 3, the rest 1 per call) |
| Guidance | `get_development_guide`, `list_extension_templates`, `search_docs`, `generate_icon_workflow`, `generate_welcome_page_workflow`, `localize_workflow`, `generate_landing_page` | **Free, no key** |
| Account | `get_credit_balance`, `connection_diagnostics` | **Free** |
| Projects | `list_my_projects`, `create_project`, `get_project_state`, `import_manifest`, `apply_project_patch`, `get_decisions`, `propose_decision`, `get_release_readiness`, … | Free of credits; project scopes for OAuth; `get_release_readiness` needs a Pro project |
| Hosted pages | Landing page (`draft_landing_page`, `preview_landing_page`, `publish_landing_page`, versions, rollback), custom domain (Pro), install instructions, uninstall surveys, page translations, `upload_project_media` | Free of credits; `hosted.write` for changes |
| Legal pages | Privacy policy versions, AI update and publish (Pro), license terms questionnaire and draft, translations of both | Pro project or Pay scopes, per tool |
| Local artifacts | `scan_extension`, `publish_extension` | 1 scan credit / free with your own store credentials |

Prefer `get_risk_by_store_ids` over calling `get_security` in a loop: 40
extensions for one read credit instead of three credits each.

Not using MCP? The same icon workflow ships as a plain
[`SKILL.md`](../skills/extension-icon-design/) for Claude Code and other
instruction-file agents.

The signup allowance is one-time. Prepaid packs stay in the account until you
spend them: <https://dojo.extenshi.io/billing>.

---

## Configuration reference

The CLI and the MCP server read the same environment variables. Guard reads the
API key from the same `~/.extenshi/config.json`.

| Env var | Default | Purpose |
| --- | --- | --- |
| `EXTENSHI_API_KEY` | — | Your `ek_…` developer key (required for catalog/scan tools) |
| `EXTENSHI_BFF_URL` | `https://bff.extenshi.io` | Catalog read API base URL |
| `EXTENSHI_API_URL` | `https://scan.extenshi.io` | Scan backend base URL |
| `EXTENSHI_DOCS_URL` | `https://docs.extenshi.io` | Docs base URL for `search_docs` |

The CLI also honours `CI` (writes the HTML report without opening it) and
`DO_NOT_TRACK` / `EXTENSHI_TELEMETRY=0` (opts out of anonymous usage telemetry).
