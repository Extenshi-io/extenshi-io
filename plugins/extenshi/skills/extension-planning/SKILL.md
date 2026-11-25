---
name: extension-planning
description: >
  Turn an idea for a browser extension into the decisions everything else is
  built from: a one-paragraph brief, the surfaces it needs (popup, side panel,
  content script, options), the stores it ships to, the sites it runs on with
  their match patterns, a name that is free in the stores, and the optional
  modules. Use when the user says "I want to build an extension that…", "help
  me plan my extension", "which permissions will I need", "should I ship to
  Firefox too", "is this extension name taken", or starts a new extension
  project and has not written the scope down yet.
---

# Extension planning

Settle what is being built before any code exists. Each decision here switches
later work on or off: a surface adds files and permissions, a store adds its own
submission rules, a site adds a host permission that reviewers and users see.

On the Build Map this skill covers the steps `idea`, `surfaces`, `browsers`,
`sites`, `identity` and `features`. Most of their tasks are the author's
choices. Prepare the options with the facts below, say which one you would take
and why, and let the author choose; record progress with the `extension-build`
skill's commands.

## The brief (`idea`)

Ask for three things and write them down in the author's words:

- **The problem**, as one sentence about what a person cannot do today.
- **The audience**: who has that problem, and on which sites or in which
  situation.
- **The first three features.** Everything else is deferred, and deferred
  features stay out of the listing and other release promises.

Then write the one-paragraph brief to a file in the repository (for example
`docs/brief.md`) with an acceptance checklist: what must work, on which sites,
in which browsers. Later steps read it, so keep it current when the scope
changes.

## Surfaces (`surfaces`)

Call `list_extension_templates` (free, no account). It names the kinds of
extension (popup, side panel, page enhancer, in-page assistant), the permissions
each kind requires and the cross-browser rules. Types combine, and the required
permissions are their union.

For each of the three features, name the smallest surface that delivers it:

- An action the user starts from the toolbar: a popup. With `activeTab` it needs
  no host permission.
- Something that changes pages on its own: a content script on the listed sites.
- Something that stays open next to the page: a side panel. Chromium uses
  `side_panel`, Firefox `sidebar_action`.
- Settings: an options page.
- Background work (events, alarms, messaging between surfaces): the service
  worker.

Do not add a surface no feature in the brief needs. Each one is code to build,
test and keep working in every target browser.

## Stores (`browsers`)

State what each store adds, then let the author choose:

- **Chrome Web Store:** a developer account with a one-time registration fee.
  The first item and its listing, privacy and distribution tabs are created in
  the Developer Dashboard.
- **Firefox Add-ons:** free. The add-on ID is permanent after the first upload,
  the manifest declares its data collection, bundled or minified code needs a
  source archive with build instructions, and a Manifest V3 build needs
  `background.scripts` next to `service_worker`.
- **Edge Add-ons:** free, takes the same Manifest V3 package as Chrome. The
  first submission is created by hand in Partner Center.

In a Dojo project the choice is the owner decision `targetBrowsers`: propose it
with `propose_decision`, and the owner confirms it in Dojo.

## Target sites (`sites`)

1. Collect the sites from the brief. Ask about subdomains, regional domains and
   pages that must stay untouched (login, checkout, banking).
2. Write the narrowest match patterns that cover them, for example
   `https://*.example.com/*`. Use `<all_urls>` only when the feature has to work
   on any page, and say that it brings the broadest install warning and a slower
   review.
3. Prefer no host permission at all when the feature runs after a click:
   `activeTab` with `scripting` covers the current tab.
4. Look at catalog extensions built for the same sites: `search_extensions`,
   then `get_reviews` for what users report as broken there. Catalog tools need
   an account and count against the read allowance.

The patterns feed the manifest's content scripts and host permissions, so write
them next to the brief.

## Name and tagline (`identity`)

1. Propose five names: short, pronounceable, saying what the extension does.
   Avoid another product's name or a browser's name as the leading word.
2. Search each one with `search_extensions`. A match on the exact name or a
   close spelling in the same category is a collision; say which extension it
   collides with.
3. The author picks. Record the name and a tagline that fits a store's short
   description (Chrome allows 132 characters).

The name is copied into the manifest, the icon work, the listing and every
hosted page. After a later rename, `find_brand_mentions` lists the hosted fields
that still hold the old name.

## Optional modules (`features`)

The modules are the author's choice, and the steps of a module wait on the map
until the author confirms the set (unless the code already has the module or a
Dojo decision asks for it). A module that is on only by default is
not chosen (`source: "default"`, `unconfirmed` in `modules.list` of
`map status --json` and `get_build_map`). Analytics is off by default: it is
the module with the widest consequences, so it is switched on by a decision.

Make a recommendation table and show it to the author before you ask. One row
per module, taken from `modules.list` (`on`, `source`, `steps`, `data`,
`stores`) and from what you know about this extension:

| Column | What goes in it |
| --- | --- |
| Module | Its name and what is set now, with the source (code, Dojo, the author, default). |
| Cost | The steps it adds (`steps`), credits it spends, and what the author keeps up afterwards. |
| Data | What starts leaving the user's device (`data`). "Nothing" is an answer too. |
| Stores and policy | What changes in the privacy policy, the store data forms and the manifest (`stores`). |
| Fits this extension? | How it sits with the brief and with the niche research, if `research` is done: what competitors promise, what their users complain about. |
| Recommendation | On or off, with the reason in one sentence. |

Name the conflicts outright. For example: "Analytics goes against the
positioning 'nothing leaves your device': three of the five closest
extensions sell exactly that promise, and switching it on means a consent
toggle, a policy paragraph and the Firefox data declaration. Recommendation:
off." Or the other way: "Without the uninstall survey you will not learn why
people leave; it sends nothing from the extension. Recommendation: on."

What each module brings, for the Cost column:

- **Analytics:** the author's own PostHog project, a consent toggle in the
  extension, a paragraph in the privacy policy, the Chrome data-use form and
  `data_collection_permissions` for Firefox.
- **Uninstall survey and feedback form:** hosted pages the author creates in
  Dojo, and one link each in the extension.
- **Localization:** `_locales` files, translated listing text and screenshots
  per language.
- **Monetization:** a Pay application, payment-provider onboarding the author
  completes in the browser, license terms and a paywall.
- **Welcome page:** a page opened once after install.
- **Promo tiles:** listing artwork, optional in every store.
- **Niche research:** catalog reads, which spend credits; its result feeds the
  "Fits this extension?" column, so when the author wants it, settle it first.
- **CI evidence:** a workflow in the author's repository that sends scan
  results of each build.

Then ask, one module at a time where the answer is not obvious, starting with
the ones that are on only by default. Record each answer with
`npx @extenshi/cli@latest map set features.<module> on|off` (`set_build_module`
on the local MCP server) and send the author to the `features` step to
confirm the set. Do not confirm it for them, and do not start a module's steps
before they do.

## How to report

- The brief, with the three features and what was deferred.
- Surfaces and the permissions they bring, taken from
  `list_extension_templates`.
- Stores, with what each one adds for this extension.
- Match patterns, and why each is as wide as it is.
- Name candidates with the collisions found, and the one chosen.
- The module recommendation table, and which modules the author settled.
- Decisions still open, each with the person who makes it.

## Stay accurate

- These are the author's decisions. Give a recommendation; do not record a
  choice the author has not made.
- A name with no catalog match is not a trademark clearance. Say so.
- Do not promise a store will approve a permission. The `extension-store-readiness`
  skill predicts review outcomes once there is a manifest.
- Chrome review text is not in the catalog; its ratings are.
