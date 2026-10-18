# `@extenshi/cli` — command reference

[![npm](https://img.shields.io/npm/v/@extenshi/cli)](https://www.npmjs.com/package/@extenshi/cli)

The Extenshi CLI is a command-line tool for browser-extension developers. It runs
a **pre-publish security scan**, **predicts store review outcomes** before you
submit, **looks up the safety score of extensions you already have**, **previews
your icon** inside real browser toolbars, and **publishes** a build straight to
Chrome, Firefox, and Edge from your machine. Around the release it builds one
store package per browser, smoke-tests that exact package in a real browser,
renders store artwork and per-locale screenshots, and hosts the project's
landing page.

Requires **Node 20+**. Nothing to self-host, nothing to install.

---

## Run it

Every example in this file is copy-pasteable as-is:

```bash
npx @extenshi/cli@latest --help
```

**Always include `@latest`.** It is the difference between running the current
CLI and running whatever happened to land in your npx cache months ago:

- `npx @extenshi/cli@latest` — npm re-resolves the newest published version on
  every run, so you pick up new checks and new scanner rules for free.
- `npx @extenshi/cli` — reuses the cached copy. Silently stale.
- `npm i -g @extenshi/cli` — pins the version you installed. Stale until you
  remember to re-run `npm i -g`, and once it falls a **major** version behind,
  the CLI refuses to run and tells you to upgrade.

If typing that gets old, alias it — you still get a fresh version every run:

```bash
alias extenshi="npx @extenshi/cli@latest"
```

For readability the option tables below refer to commands as
`extenshi <command>`; assume that alias, or paste the full `npx` form shown in
each example block.

---

## What it costs

Most of the CLI needs **no account and no network**. Two commands spend credits:
`scan` (a scan credit) and `risk` (a read credit).

| Command | Credits | Network |
| --- | --- | --- |
| `extenshi icon preview <icon>` | **Free**, no API key | ✅ none — fully offline |
| `extenshi review-risk <artifact>` | **Free**, no API key | Local checks, including `--listing`, stay on your machine. `--extension-id` also reads your last published manifest from the catalog, and that read is free |
| `extenshi generate-listing <artifact>` | **Free**, no API key | ✅ none — fully offline |
| `extenshi localize …` | **Free**, no API key | ✅ none — fully offline |
| `extenshi publish <artifact>` | **Free**, no Extenshi key for the upload | Uploads go straight from your machine to the store APIs. An access check runs first (testing phase) |
| `extenshi login` | **Free** | Opens extenshi.io in your browser and saves the key locally |
| `extenshi package` / `test smoke` / `amo-source` / `icon store-assets` / `screenshots` | **Free**, no API key | Run on your machine (`test smoke` and `screenshots` drive a local browser) |
| `extenshi page …` / `media upload` / `uninstall …` | **Free** of catalog credits; API key required | Talks to Dojo about your project's hosted pages. `page generate` and `page validate` run offline without a key |
| `extenshi domain …` | API key, Pro project | Talks to Dojo; DNS records are yours to add |
| `extenshi doctor` / `project` / `release` / `evidence` | **Free** of catalog credits; API key required | Talks to Dojo about your project. See the [project sync guide](https://docs.extenshi.io/developers/project-sync) |
| `extenshi risk [store-ids…]` | **1 read credit per call**, up to 40 extensions per call | Catalog read |
| `extenshi scan <artifact>` | **1 scan credit** | Uploads the artifact to the scan backend |

Every account starts with a **one-time free allowance — 10 reads and 3 scans**.
Beyond it, prepaid credit packs stay in the account until you spend them.
Create a key at [dojo.extenshi.io/api-keys](https://dojo.extenshi.io/api-keys),
check your balance at [dojo.extenshi.io/billing](https://dojo.extenshi.io/billing),
and see [docs.extenshi.io/developers/scan-credits](https://docs.extenshi.io/developers/scan-credits)
for how metering works.

> Free **scan** credits are reserved for extensions you own: pass
> `--extension-id <id>` for an extension you've verified on the Ownership tab in
> dojo. Paid scan credits work on any artifact.

---

## Commands at a glance

The sections below cover the most-used commands in detail. Rows that link to
docs.extenshi.io are documented there with every flag.

| Command | What it does |
| --- | --- |
| [`scan <artifact>`](#extenshi-scan-artifact) | Pre-publish security scan of a `.crx` / `.xpi` / `.zip`, with an HTML report |
| [`review-risk <artifact>`](#extenshi-review-risk-artifact) | Predict store review outcomes: REJECTED / ATTRITION / SLOW, per store and per listing locale. Alias: `review` |
| [`generate-listing <artifact>`](#extenshi-generate-listing-artifact) | Write `CHROMEWEBSTORE.md` from the package, with privacy answers derived from its data flows |
| [`localize`](#extenshi-localize) | Prepare, check, and apply `_locales` translations |
| [`package [dir]`](https://docs.extenshi.io/developers/cli#extenshi-package) | Build one reproducible store zip per browser and print each sha256 |
| [`test smoke <package>`](https://docs.extenshi.io/developers/cli#extenshi-test-smoke) | Install the exact zip (or a build folder) in a real browser and check that it boots without errors; with `--site`, that its content scripts inject |
| `amo-source <project-dir>` | Produce the AMO source-code archive and `BUILD.md` reviewer instructions for a Firefox add-on; `--verify` rebuilds from the archive and compares SHA-256 |
| [`risk [store-ids…]`](#extenshi-risk-store-ids) | Safety scores for extensions that are already published, in bulk, by store id |
| [`icon preview <icon>`](#extenshi-icon-preview-icon) | Render an icon inside Chrome / Firefox / Edge toolbars, with contrast checks + PNG/ZIP export |
| [`icon store-assets <icon>`](https://docs.extenshi.io/developers/cli#extenshi-icon-store-assets) | Render each store's listing artwork: Chrome Web Store promo tiles, Edge logo and tiles, AMO icons |
| [`screenshots <build>`](https://docs.extenshi.io/developers/cli#extenshi-screenshots) | Store screenshots per locale from a declarative scenes file, at each store's size (needs Playwright) |
| [`publish <artifact>`](#extenshi-publish-artifact) | Upload a build to Chrome, Firefox, and/or Edge with your own store credentials |
| [`page generate` / `publish` / `draft` / `preview` / `validate` / `versions` / `rollback` / `register` / `unpublish`](https://docs.extenshi.io/developers/cli#extenshi-page-generate--publish--register) | Build a static landing page, or host it at `page.extenshi.io/<code>` as the project homepage, with drafts, previews and version history |
| [`domain add` / `status` / `verify` / `remove`](https://docs.extenshi.io/developers/cli#extenshi-domain) | Serve the homepage and hosted pages at your own domain (Pro project) |
| [`media upload <files…>`](https://docs.extenshi.io/developers/cli#extenshi-media-upload) | Upload a logo or screenshot to the project's public media store and print its stable URL |
| `uninstall list` / `get` / `update` / `preview` / `translations` | Read, preview, and change the project's hosted uninstall survey and its translations; the survey URL and responses stay |
| [`project`](#extenshi-project-release-and-evidence) / [`release`](#extenshi-project-release-and-evidence) / [`evidence`](#extenshi-project-release-and-evidence) / [`doctor`](#extenshi-project-release-and-evidence) | Sync project metadata and release evidence with Dojo |
| [`login`](#extenshi-login) | Sign in through the browser and save the API key to `~/.extenshi/config.json` |
| [`telemetry`](#environment-variables) | Show or set anonymous usage reporting: `on`, `off`, `status` |

`npx @extenshi/cli@latest --help` and `… <command> --help` print the same
information from the version you're actually running.

---

## `extenshi scan <artifact>`

Scans a packaged extension and reports security findings. By default it writes a
self-contained, filterable **HTML report** and opens it in your browser; live
per-scanner progress streams to the terminal while it runs. A store-review
prediction (the same checks as `review-risk`) is folded into the report unless
you opt out.

```bash
npx @extenshi/cli@latest scan ./dist/my-extension.zip
```

📄 **See the output:** [`examples/scan-report.html`](../../examples/) — plus the
Markdown and JSON forms of the same run.

| Option | Description |
| --- | --- |
| `--format <html\|json\|stdout>` | Output format. `html` (default) writes a report file and opens it; `json` prints raw JSON to stdout; `stdout` prints pretty findings in the terminal. |
| `--output <path>` | Path for the HTML report (default: `<artifact>-extenshi-report.html`; `--format html` only). |
| `--no-open` | Do not open the HTML report in the browser after generating it. |
| `--json` | Shortcut for `--format json`. |
| `--report <path>` | *Also* write a formatted report file (Markdown by default; a `.json` path writes raw JSON). Composes with `--format`. |
| `--report-format <md\|json>` | Force the `--report` file format instead of inferring it from the path extension. |
| `--extension-id <id>` | Numeric catalog ID of a **verified** extension — required to spend a *free* scan credit. Paid credits don't need it. |
| `--exclude-compliance-review` | Skip the store-review prediction that `scan` runs by default. |
| `--no-stream` | Disable live progress streaming; wait for a single final response. |
| `--skip-preflight` | Skip the CI timeout pre-flight probe (use at your own risk). |
| `--api-url <url>` | Override the scan API base URL (default: `https://scan.extenshi.io`). |

### The HTML report

Findings are **de-duplicated**: one rule firing across 40 files collapses into a
single collapsible row with a count and the list of locations, instead of 40
near-identical lines. On top of that the page has severity/scanner/free-text
filters, a sticky table of contents, a light/dark toggle, and a verdict banner.
It is a **single self-contained file** — inline CSS and JS, no external assets —
so it opens from disk and works offline. Archive it as a CI artifact and it stays
readable months later.

### In CI

```yaml
- run: npx @extenshi/cli@latest scan ./dist/my-extension.zip --json > scan-report.json
  env:
    EXTENSHI_API_KEY: ${{ secrets.EXTENSHI_API_KEY }}
```

`@latest` matters most here: a pinned CI install quietly stops picking up new
scanner rules, which is the whole reason the step exists.

When `CI` is set, the HTML report is still written (so the job can archive it)
but never opened. A non-zero exit code means the scan **failed to run** — parse
the JSON for the actual findings and decide your own failure threshold.

A full GitHub Actions walkthrough lives at
[docs.extenshi.io/developers/cli-github-actions](https://docs.extenshi.io/developers/cli-github-actions).

> ⚠️ Scans run automated heuristics that may miss real issues or over-flag benign
> code. A clean result is not a guarantee of safety or store approval — see
> [How scanning works](https://docs.extenshi.io/methodology).

---

## `extenshi review-risk <artifact>`

Predicts how the **store review** will go *before* you submit, sorted by
consequence:

- **WILL BE REJECTED** — the submission fails policy as-is;
- **USER ATTRITION** — the update auto-disables the extension for existing users
  until they re-grant a permission;
- **TRIGGERS SLOW REVIEW** — nothing fatal, but it routes you into manual review.

Runs fully offline against the artifact's manifest. **No API key, no upload, no
credits.**

```bash
npx @extenshi/cli@latest review-risk ./dist/my-extension.zip
```

| Option | Description |
| --- | --- |
| `--extension-id <id>` | Numeric catalog ID — enables the auto-disable diff against your **last published** manifest (Ownership tab in dojo). |
| `--store <chrome\|firefox\|edge>` | Store to diff the manifest against (default: `chrome`). Permission sets differ per store. |
| `--catalog-url <url>` | Override the catalog API base URL (default: `https://bff.extenshi.io`). |
| `--listing <file>` | JSON file with your store listing text (`name`, `shortDescription`, `description`). The package already has the localized name and short description; this adds the full description, which lives only in the developer dashboard. |
| `--json` | Output raw JSON findings. |

---

## `extenshi generate-listing <artifact>`

Writes `CHROMEWEBSTORE.md` from a packaged (`.zip` / `.crx` / `.xpi`) or unpacked
extension: listing copy, permission justifications, single purpose, and
privacy-practices questions. It assembles those checklists locally and does not
write anything into the Chrome Web Store. The file is the same draft
`review-risk --listing` accepts.

```bash
npx @extenshi/cli@latest generate-listing ./dist/my-extension.zip
npx @extenshi/cli@latest review-risk ./dist/my-extension.zip --listing CHROMEWEBSTORE.md
```

| Option | Description |
| --- | --- |
| `--output <path>` | Where to write the markdown (default: `CHROMEWEBSTORE.md` in the current directory). |
| `--listing <file>` | JSON file with your listing text, so the generated markdown can include the full description. |

---

## `extenshi localize`

Prepares, checks, and applies extension message translations on your machine.
English source stays the fallback; HTML and JS are not rewritten by `init`.

```bash
npx @extenshi/cli@latest localize init ./extension --output ./extension-localized
npx @extenshi/cli@latest localize prepare ./extension --lang fr,de,es --output ./localization --protect MyBrand
npx @extenshi/cli@latest localize apply ./extension --translations ./localization/translations.json --protect MyBrand
npx @extenshi/cli@latest localize check ./extension --protect MyBrand
```

| Command | What it does |
| --- | --- |
| `init <directory> --output <directory>` | Copy an English extension and localize literal manifest fields. The output directory must sit outside the source. |
| `prepare <directory> --output <directory>` | Write `localization-request.json`. `--lang` overrides the locales in `localization.json`. `--protect` keeps terms verbatim. |
| `apply <directory> --translations <file>` | Apply a reviewed translation file. `--protect` keeps the same terms verbatim. |
| `check <directory>` | Validate the locales. Exits non-zero when it finds errors. `--protect` is optional. |

The hand-off contract and the review gates are in
[Localization](https://docs.extenshi.io/developers/localization).

---

## `extenshi risk [store-ids…]`

Looks up the **safety score of extensions that are already published** — by the
store id in their URL, not from a local artifact. Built for inventories: audit
what your team has installed, or size up a list of competitors.

```bash
# a couple of Chrome ids (the id in the store URL):
npx @extenshi/cli@latest risk hdokiejnpimakedhajhdlcegeplioahd nngceckbapebfimnlniiiahkandclblb

# a whole inventory from a file, one id per line:
npx @extenshi/cli@latest risk --file ./installed.txt --json

# mixed stores — a per-id prefix overrides --store:
npx @extenshi/cli@latest risk firefox:my-addon-slug hdokiejnpimakedhajhdlcegeplioahd
```

**Up to 40 extensions per call, and the whole call costs 1 read credit** — not
one per extension. Looking the same extensions up one at a time costs 3 reads
each, so an 87-extension inventory is 3 credits here instead of 261. Scores are
cluster-resolved server-side, so they match what the extension's catalog page
shows.

Requires an API key (`npx @extenshi/cli@latest login` or `EXTENSHI_API_KEY`).

| Option | Description |
| --- | --- |
| `--store <chrome\|firefox\|edge>` | Store the ids belong to (default: `chrome`). A per-id prefix like `firefox:some-addon` overrides it. |
| `--file <path>` | Read ids from a file instead of (or in addition to) the arguments: one per line, bare id or `store:id`. Blank lines and `#` comments are ignored. |
| `--catalog-url <url>` | Override the catalog API base URL (default: `https://bff.extenshi.io`). |
| `--json` | Output raw JSON. |

---

## `extenshi icon preview <icon>`

Renders a local `.svg` or `.png` icon **inside realistic browser toolbar
mockups** so you can judge it the way users actually see it — at 16 px, among
neighbor extensions, on light *and* dark toolbars. Writes one self-contained HTML
file and opens it. **Fully offline, no API key, nothing leaves your machine.**

```bash
npx @extenshi/cli@latest icon preview ./icon.svg --name "My Extension"
```

📄 **See the output:** [`examples/icon-preview.html`](../../examples/)

The page gives you:

- **Chrome, Firefox, and Edge toolbars** with your icon pinned among neighbors,
  plus the Chrome extensions menu;
- a **palette switcher** — light, tinted, dark, black, saturated, and a custom
  toolbar color;
- a **contrast strip** rendering the icon on every palette at once, with an
  automatic warning when it melts into the background, and a mid-gray detector;
- a **canvas-usage meter** with an edge-to-edge trim toggle (wide transparent
  margins make your icon look smaller than its neighbors);
- the **store-size matrix** (16 / 32 / 48 / 128 px) and an **8× magnifier** of
  the 16 px pixels;
- **export buttons**: per-size PNGs, a ZIP (`icons/*.png` + the SVG master +
  `manifest-icons.json`), and a copy-paste manifest snippet.

| Option | Description |
| --- | --- |
| `--name <name>` | Extension display name shown in the mockups (default: derived from the file name). |
| `--output <path>` | Path for the preview HTML file (default: `<icon-base>-icon-preview.html`). |
| `--no-open` | Do not open the preview in the browser after generating it. |

> Want your coding agent to drive this loop — draw the SVG, render the page,
> iterate on the warnings, export the set? Install the free
> [**extension-icon-design skill**](../../skills/extension-icon-design/).

---

## `extenshi publish <artifact>`

Uploads a packaged extension straight to the store APIs **from your machine** —
the artifact and your store credentials never touch Extenshi servers, so no
Extenshi API key is required.

```bash
npx @extenshi/cli@latest publish ./dist/my-extension.zip --stores chrome,edge
```

| Option | Description |
| --- | --- |
| `--stores <list>` | Comma-separated stores: `chrome,firefox,edge` (default: every store with complete credentials). |
| `--firefox-artifact <path>` | Separate `.xpi` for Firefox (default: the main artifact). |
| `--release-notes <text>` | Release notes passed to stores that accept them. |
| `--validate` | Only validate store credentials; publish nothing. |
| `--no-wait` | Edge: return after commit without polling the operation to a terminal status. |
| `--extension-id <id>` | Numeric catalog ID — checks publish access against that specific extension. |
| `--json` | Output raw JSON result. |

Store credentials come from the environment (or a local `.env`). Provide the full
set for each store you target:

| Store | Required environment variables |
| --- | --- |
| Chrome | `CHROME_APP_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Firefox | `FIREFOX_ADDON_GUID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` |
| Edge | `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_CLIENT_SECRET`, `EDGE_TENANT_ID` |

Confirm which stores are configured before you ship, then scan and publish:

```bash
npx @extenshi/cli@latest publish ./dist/my-extension.zip --validate
npx @extenshi/cli@latest scan ./dist/my-extension.zip && \
  npx @extenshi/cli@latest publish ./dist/my-extension.zip
```

> Publishing is in an active testing phase — access is gated. Sign in with
> `npx @extenshi/cli@latest login` so the access check can recognize your account.

---

## `extenshi project`, `release`, and `evidence`

These commands keep Dojo's copy of project metadata next to the git checkout.
Git stays the source of the code. The CLI sends metadata: manifest observations,
release records, and evidence digests. Source stays in git, and store credentials
stay on your machine.

```bash
npx @extenshi/cli@latest doctor --json
npx @extenshi/cli@latest project bind --project <project-id> --repo owner/extension --branch main
npx @extenshi/cli@latest project import-manifest src/manifest.json --browser chrome
npx @extenshi/cli@latest project diff
npx @extenshi/cli@latest release prepare deploy.zip --browser chrome --locales en --source-manifest src/manifest.json --listing store/listing.json --policy privacy.md --payment not-used --dry-run
npx @extenshi/cli@latest evidence push reports/scan-metadata.json --artifact deploy.zip
npx @extenshi/cli@latest release status --browser chrome --json
```

`doctor` reports whether this account can see project-workspace v1.
`project import-manifest --dry-run` previews the editor change.
`project sync` applies a reviewed metadata patch and replays anything that was
queued while the backend was unreachable. `release prepare` records the package.
Uploading that package to a store is still `publish`. `evidence push` accepts a
report whose artifact hash matches the file you pass.

Full workflow, conflict handling, and the evidence JSON shape:
[Synchronize an existing extension project](https://docs.extenshi.io/developers/project-sync).

---

## `extenshi login`

Opens extenshi.io in your browser so you can sign in or create an account, then
saves the API key to `~/.extenshi/config.json`. `scan`, `risk`, Guard, and the
[MCP server](../extenshi-mcp/) read that same file. You do this once per machine.

```bash
npx @extenshi/cli@latest login                      # browser sign-in, pairing code in the terminal
npx @extenshi/cli@latest login --paste              # paste a key when no browser can open
npx @extenshi/cli@latest login --api-key ek_…       # non-interactive
```

| Option | Description |
| --- | --- |
| `--paste` | Skip the browser and paste an API key. |
| `--api-key <key>` | API key (skips the browser entirely). |
| `--api-url <url>` | Override the scan API base URL. |

In CI set `EXTENSHI_API_KEY` from your secrets. A non-interactive terminal
cannot wait on a browser approval. The key can also come from a local `.env`.

If the login expires or you decline it in the browser, run `login` again. At the
API-key limit, revoke one at [dojo.extenshi.io/api-keys](https://dojo.extenshi.io/api-keys)
and retry.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXTENSHI_API_KEY` | — | Your `ek_…` developer key (required by `scan` and `risk`) |
| `EXTENSHI_API_URL` | `https://scan.extenshi.io` | Scan backend base URL |
| `EXTENSHI_BFF_URL` | `https://bff.extenshi.io` | Catalog read API base URL |
| `CI` | — | When set, the HTML report is written but not opened |
| `DO_NOT_TRACK` / `EXTENSHI_TELEMETRY=0` | — | Disable anonymous usage telemetry |

**Telemetry:** the CLI records which command ran, whether it succeeded, and a
coarse error kind. No artifact contents, file names, findings, or API keys.
Honors `DO_NOT_TRACK`; opt out entirely with `EXTENSHI_TELEMETRY=0`. The same
choice is `npx @extenshi/cli@latest telemetry on|off|status`. `status` names an
environment override when one is set.

---

## See also

- [Examples of every output](../../examples/) — HTML report, Markdown, JSON, icon preview
- [`extension-icon-design` skill](../../skills/extension-icon-design/) — free agent skill
- [`@extenshi/mcp`](../extenshi-mcp/) — the same capabilities inside Claude Code, Claude Desktop, and Cursor
- [Full docs](https://docs.extenshi.io/developers/cli)
