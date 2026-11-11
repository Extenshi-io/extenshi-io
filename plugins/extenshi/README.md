# Extenshi plugin

Skills and a connector for people who build, review or choose browser extensions.
The plugin adds the [Extenshi](https://extenshi.io) catalog of Chrome, Firefox and
Edge extensions to Claude, together with skills that teach Claude how to use it and
how to prepare an extension for store review.

## What is included

| Component | What it does |
| --- | --- |
| `extenshi` connector | A remote MCP server at `https://mcp.extenshi.io/mcp`. Search the catalog, read one extension's details and reviews, look up security scores, and get market figures. Signing in happens in the browser with OAuth; no API key is needed. |
| `extension-vetting` skill | For anyone choosing an extension: checks publisher, popularity, permissions in plain language, security score and reviews for one extension, and suggests alternatives. |
| `installed-extensions-audit` skill | Looks up the safety score of every extension you have installed in one batch and ranks what to review first. |
| `extension-market-research` skill | For developers: sizes a niche, finds incumbents and gaps, reads what users complain about and writes a short competitor brief. |
| `extension-store-readiness` skill | For developers: trims manifest permissions, predicts rejections and slow reviews locally for the Chrome Web Store, Firefox Add-ons or Edge Add-ons, and drafts permission justifications and listing text. |
| `extension-browser-changes` skill | For developers: checks the code and manifest against recent and upcoming Chrome, Edge and Firefox changes and shows each affected file and line. |
| `extension-testing` skill | For developers: installs the exact package in Chromium, Edge and Firefox to check that it boots, runs scenario tests against its pages and shoots the store screenshots per locale. |
| `extension-localization` skill | For developers: translates `_locales` messages, with the CLI choosing what needs translating and validating placeholders, protected terms and every locale against the default one. |
| `extension-paywall` skill | For developers: gates a feature with `@extenshi/pay`, sells it on the developer's own Stripe account and verifies the licence offline; builds and tests in mock mode before any account exists. |
| `extension-icon-design` skill | Designs an extension icon that stays readable at 16 px in real Chrome, Firefox and Edge toolbars, checks it locally and exports the store-ready PNG set and the store listing artwork. |
| `extension-build` skill | For developers building with Claude: offers a local build map once, a page that shows which build steps are done, which Claude is working on and which wait on you, keeps it current and hands you the decisions that are yours. One map per project, shared by every agent and git worktree. |

## Install

Add the plugin from the Claude directory (Customize page in claude.ai or the desktop
app); it is then also available in Claude Code. On first use of a catalog tool Claude
opens a sign-in page for your Extenshi account.

## Examples

- "Find Manifest V3 extensions for tab management that ask for few permissions and
  show me their safety scores."
- "Compare the top three ad blockers on Firefox by rating, permissions and risk."
- "Make an icon for my extension that saves reading progress, and check it in dark
  and light toolbars."
- "Will my extension break in the next Chrome release?"
- "Add German and Japanese to my extension and check the translations."
- "Smoke test the build in Chromium and Firefox, then make the store screenshots."

## What it sends and where

- **The connector (`mcp.extenshi.io`)** receives only the arguments of the tool
  calls Claude makes (a search phrase, an extension or store id) and, after you
  sign in, your Extenshi account id and email. It does not receive your wider
  conversation, memory or files, and it does not read your browser or your
  installed extensions. Retention and processors are in the
  [privacy policy](https://mcp.extenshi.io/privacy).
- **Skills that run `npx @extenshi/cli@latest`** (icon design, store readiness,
  browser changes, testing, localization, the optional CLI route of the audit)
  work on files on your machine:
  - `icon preview` and `icon store-assets` run offline and send nothing.
  - `advise` reads your code locally; the code is not uploaded. Each run
    downloads the public list of browser changes from `cli.extenshi.io`
    (`--offline` skips it).
  - `localize` reads and writes your `_locales` files locally and sends nothing.
    The translation is done by Claude in your conversation.
  - `test smoke`, `test run`, `test scenarios` and `screenshots` start a browser
    on your machine and install your package there; the package is not uploaded.
    They can download a browser build into a cache outside your project, and the
    extension makes whatever requests it normally makes.
  - `amo-source` builds the Firefox source archive locally and does not talk to
    Firefox Add-ons.
  - `review-risk` and `generate-listing` read your package and listing text
    locally; the build is not uploaded. With `review-risk --extension-id` the id
    is sent to the Extenshi catalog API (`bff.extenshi.io`) and, if you are
    signed in, so are the verdict, the rule-set version and a SHA-256 hash of the
    package file. The package, its contents and the findings are not sent.
  - `risk` sends the store ids you list to the same catalog API.
  - `map` (build skill) serves the build map on `127.0.0.1` and reads your
    project files locally; nothing from them is uploaded. For a project bound
    with `extenshi project bind` and an API key, it reads that project's
    decisions and release readiness from the same API once a minute while it
    runs. It starts only after you say yes, and `map decline` records a no.
  - `scan`, an optional step in the store-readiness skill, **uploads the built
    package** to the Extenshi scan service and needs an Extenshi account. Skip it
    if you do not want the package to leave your machine.
  - `npx` downloads the CLI from the npm registry. The CLI can also send anonymous
    usage reports (command and flag names, versions, coarse OS and error kind;
    never file contents or flag values). It asks on the first interactive run; set `DO_NOT_TRACK=1` or
    `EXTENSHI_TELEMETRY=0` to turn it off.
- **The installed-extensions audit** sends only the store ids you provide.
  `npx @extenshi/guard@latest list`, which the skill can use to collect them,
  reads your browser profiles locally and sends nothing.
- **The paywall skill** adds the `@extenshi/pay` SDK to your extension. In the
  shipped extension the SDK sends the publishable key, a random installation
  id, the offer's SKU and the locale to the Extenshi payment API; the skill lists
  this for your store privacy disclosure. Mock mode makes no network calls.
- **Commands run only with your go-ahead.** The skills tell Claude to explain each
  command and ask before running it.

Applicable privacy policies: the
[connector policy](https://mcp.extenshi.io/privacy) and the
[Extenshi privacy policy](https://extenshi.io/privacy) (CLI data in section 3.14,
CLI and MCP telemetry in section 3.16).

## Links

- Documentation: <https://docs.extenshi.io>
- Catalog: <https://catalog.extenshi.io>
- Issues: <https://github.com/Extenshi-io/extenshi-io/issues>
- Privacy policies: <https://mcp.extenshi.io/privacy> and <https://extenshi.io/privacy>
- License: MIT, see `LICENSE`
