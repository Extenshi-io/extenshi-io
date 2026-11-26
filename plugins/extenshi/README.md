# Extenshi plugin

Skills and a connector for people who build, review or choose browser extensions.
The plugin adds the [Extenshi](https://extenshi.io) catalog of Chrome, Firefox and
Edge extensions to Claude, together with skills that teach Claude how to use it and
how to prepare an extension for store review.

## What is included

| Component | What it does |
| --- | --- |
| `extenshi` connector | A remote MCP server at `https://mcp.extenshi.io/mcp`. It reads the catalog (search, one extension's details and reviews, security scores, market figures) and, for a signed-in developer, also changes their own Extenshi account: it publishes and takes down hosted pages, edits projects and survey forms, and prepares payment changes for the owner to approve. The full list is under [What the connector can change](#what-the-connector-can-change). Signing in happens in the browser with OAuth; no API key is needed. |
| `extension-vetting` skill | For anyone choosing an extension: checks publisher, popularity, permissions in plain language, security score and reviews for one extension, and suggests alternatives. |
| `installed-extensions-audit` skill | Looks up the safety score of every extension you have installed in one batch and ranks what to review first. |
| `extension-market-research` skill | For developers: sizes a niche, finds incumbents and gaps, reads what users complain about and writes a short competitor brief. |
| `extension-store-readiness` skill | For developers: trims manifest permissions, predicts rejections and slow reviews locally for the Chrome Web Store, Firefox Add-ons or Edge Add-ons, and drafts permission justifications and listing text. |
| `extension-browser-changes` skill | For developers: checks the code and manifest against recent and upcoming Chrome, Edge and Firefox changes and shows each affected file and line. |
| `extension-testing` skill | For developers: installs the exact package in Chromium, Edge and Firefox to check that it boots, runs scenario tests against its pages and shoots the store screenshots per locale. |
| `extension-localization` skill | For developers: translates `_locales` messages, with the CLI choosing what needs translating and validating placeholders, protected terms and every locale against the default one. |
| `extension-paywall` skill | For developers: gates a feature with `@extenshi/pay`, sells it on the developer's own Stripe account and verifies the licence offline; builds and tests in mock mode before any account exists. |
| `extension-icon-design` skill | Designs an extension icon that stays readable at 16 px in real Chrome, Firefox and Edge toolbars, checks it locally and exports the store-ready PNG set and the store listing artwork. |
| `extension-planning` skill | For developers: turns an idea into a brief, the surfaces it needs, the stores to ship to, match patterns for the target sites and a name checked against the catalog. |
| `extension-scaffold` skill | For developers: starts the repository or connects an existing one, assembles `manifest.json` per surface with the Firefox keys and icons, and proves that it packages. |
| `extension-surfaces` skill | For developers: writes the service worker, messaging, storage schema, content scripts, popup, options page and side panel by Manifest V3 rules, with unit tests. |
| `extension-compliance` skill | For developers: inventories what the code collects, stores and sends, writes the privacy policy from it, prepares the store data declarations and drafts license terms for a paid extension. |
| `extension-security-scan` skill | For developers: scans the package before the stores see it, decides and fixes each finding, runs the store-compliance check and sets up CI that records evidence. |
| `extension-analytics` skill | For developers: sets up consent-first usage and error reporting with extenshi-collector and checks that the first event arrives. |
| `extension-onboarding-feedback` skill | For developers: builds the welcome page and pin guide, tunes the uninstall survey and wires its URL, and opens the feedback form from the extension. |
| `extension-release` skill | For developers: packages one zip per store, checks release readiness, submits to the stores after the author's approval, follows the review and confirms the public listing. |
| `extension-build` skill | For developers building with Claude: offers a local build map once, a page that shows which build steps are done, which Claude is working on and which wait on you, keeps it current and hands you the decisions that are yours. One map per project, shared by every agent and git worktree. |

## What the connector can change

Besides reading the catalog, the connector's tools act on the Extenshi account you
sign in with. They touch only your own projects and Pay applications, each group
needs a permission you grant on the sign-in page (`project.write`, `hosted.write`,
`evidence.write`, `pay.write`).

- **Publish.** `publish_landing_page` and `publish_install_instructions` put a
  page on a public URL (`page.extenshi.io`, `dojo.extenshi.io/instructions`, or
  your custom domain). `rollback_landing_page` makes an earlier version the live
  one. `upload_project_media` stores an image at a public URL.
  `upsert_hosted_page` registers your homepage or support URL.
  `set_custom_domain` and `verify_custom_domain` start serving your pages on
  your domain. `set_store_listing` records where the extension is listed; a
  listing marked live appears on your public pages.
- **Take down and remove.** `unpublish_landing_page` and
  `unpublish_install_instructions` take a public page offline.
  `remove_hosted_page` forgets a registered URL, and `remove_custom_domain`
  stops serving your domain. `unlink_pay_app` removes the link between a Pay
  application and a project. No tool deletes a project, an extension, a Pay
  application or a payment record.
- **Send.** A tool call sends its arguments to `mcp.extenshi.io`. For the write
  tools that includes the content you are saving: page text and images, manifest
  JSON and `_locales` messages (`import_manifest`), project metadata
  (`create_project`, `apply_project_patch`), survey and feedback form text and
  translations (`update_uninstall_form`, `update_feedback_form`,
  `set_page_translations`), license terms answers (`save_license_terms_draft`),
  and hashes and check results for a build (`record_project_evidence`). The
  connector has no access to your files, so Claude sends only what it puts into
  the call. `upsert_hosted_page` and `verify_hosted_artifact` make the server
  fetch the public URL you name.
- **Payments.** The connector never charges anyone and never moves money.
  `create_pay_app`, `link_pay_app` and `save_license_terms_draft` save at once
  and change nothing a buyer sees. `set_pay_offer_translations` saves at once
  the translated offer text the paywall shows; prices and SKUs stay as they are. `connect_pay_seller` returns a link where you complete Stripe onboarding
  yourself. The changes that affect what buyers pay or see are proposals:
  `set_pay_enabled`, `upsert_pay_offer`, `archive_pay_offer`, `archive_pay_app`,
  `set_pay_seller_profile`, `set_pay_trial`, `update_uninstall_offer`,
  `publish_privacy_policy`, `set_legal_translations`,
  `request_license_terms_publication` and `rollback_license_terms` take effect
  only after you approve them in Dojo, and `get_approval` reports the outcome.
  `export_pay_data` returns your customers' payment records into the
  conversation.
- **Access.** `create_ci_ingest_secret` creates or replaces the secret your CI
  uses to send evidence to a project; it is shown once. `rotate_pay_key` issues
  a new publishable SDK key, and earlier keys keep working. No tool changes who
  can access your account, invites people or changes roles.

The connector cannot scan or submit a package: those need files and store
credentials on your machine and run through the CLI (see below).

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
- "What data does my extension collect? Write the privacy policy from that."
- "Package version 1.2.0 for Chrome and Firefox and tell me what is missing before I submit."

## What it sends and where

- **The connector (`mcp.extenshi.io`)** receives only the arguments of the tool
  calls Claude makes (a search phrase, an extension or store id, or the content
  of a change listed under "What the connector can change") and, after you
  sign in, your Extenshi account id and email. It does not receive your wider
  conversation, memory or files, and it does not read your browser or your
  installed extensions. Retention and processors are in the
  [privacy policy](https://mcp.extenshi.io/privacy).
- **Skills that run `npx @extenshi/cli@latest`** (icon design, scaffold, store
  readiness, browser changes, testing, localization, compliance, security scan,
  analytics, onboarding, release, the optional CLI route of the audit) work on
  files on your machine:
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
    with `extenshi project bind`, once you are signed in, it reads that project's
    decisions and release readiness from the same API once a minute while it
    runs. It starts only after you say yes, and `map decline` records a no.
  - `scan` (security-scan skill; an optional step in the store-readiness skill)
    **uploads the built package** to the Extenshi scan service and needs an
    Extenshi account. Skip it if you do not want the package to leave your
    machine.
  - `package` and `pin-guide` read and write files locally and send nothing.
  - `analytics init` (analytics skill) works on your source locally. It reads
    the SDK's version list from the npm registry and, for a proxy or self-hosted
    analytics host, checks that host with an empty request; `--offline` skips
    both. The SDK it sets up sends a weekly compatibility heartbeat, redacted
    errors and opt-in usage events from the shipped extension to your own
    PostHog project, and only after the user consents.
  - `project bind`, `project import-manifest`, `release prepare`,
    `release status` and the `--evidence` flag (scaffold, security-scan and
    release skills) send metadata to your Extenshi project: the repository name
    and branch, the manifest, hashes of the package, listing and policy files,
    and check results. The source and the package are not sent. They need an
    Extenshi account.
  - `privacy publish` (compliance skill) uploads the policy file you name and
    makes it your public policy page; `--dry-run` sends nothing.
  - `publish` (release skill) uploads the package from your machine straight to
    the store you name, under your own store account. The package is not sent to
    Extenshi. It runs only after you approve the submission.
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
