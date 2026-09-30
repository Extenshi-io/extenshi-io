---
name: extension-store-readiness
description: >
  Get a browser extension ready for store review: trim the manifest to the
  permissions it needs, predict what the Chrome Web Store will reject or send to
  slow manual review, prepare permission justifications and the privacy practices
  answers, and clean up the listing text. Use when the user asks "will my
  extension pass review", "why was my extension rejected", "check my manifest",
  "are my permissions too broad", "prepare my extension for the Chrome Web Store",
  or "review my store listing".
---

# Extension store readiness

Run a pre-submission pass on an extension the user is building. It combines the
Extenshi connector (reference data on permissions, catalog peers, docs) with the
`@extenshi/cli` checks that run locally, so the build never leaves the machine.

## Running commands

Before running any `npx @extenshi/cli@latest` command, tell the user what it does
and what leaves their machine, show the exact command, and wait for their go-ahead.
Run only the commands the task needs. If the user prefers to run them, print the
commands and work from the output they paste back.

## Inputs

An unpacked extension folder or a built `.zip`, plus the store listing text if it
exists. Ask which browsers are targeted. If there is no package yet, build one
first (`extenshi package <dir> --browser chrome,edge,firefox` produces one zip
per browser) or ask the user to.

## Workflow

1. **Read the manifest.** List every entry in `permissions`,
   `optional_permissions` and `host_permissions`, plus content-script matches and
   any `web_accessible_resources`. Note the manifest version.
2. **Find the minimum permissions.** Call `list_extension_templates` (free, no
   account). It states the permissions each extension shape requires (popup,
   side panel, page enhancer, in-page assistant), the cross-browser rules (for
   example Chromium `side_panel` versus Firefox `sidebar_action`), and that a
   manifest must not name a file the package lacks. Compare and propose changes:
   drop unused permissions, prefer `activeTab` over broad host access, move
   rarely used permissions to `optional_permissions`, narrow `matches` patterns.
   Store review flags padded permissions, and adding a permission in an update
   can disable the extension for existing users.
3. **Compare with peers (optional).** Use `search_extensions` for the same kind
   of extension to see what the leaders request and how they are rated. Use it to
   sanity-check, not to copy.
4. **Run the local review prediction:**

   ```bash
   npx @extenshi/cli@latest review-risk ./dist/my-extension.zip
   ```

   It reads the manifest and the listing text on the user's machine and reports
   what is likely to be **rejected**, what triggers **slow manual review**, and
   what causes **user attrition** on update. Each finding names the store policy
   it predicts against. Add `--listing <file>` (JSON or a `CHROMEWEBSTORE.md`) so
   the full description is checked too, and `--json` for machine-readable output.
   For an extension that is already published, `--extension-id <catalog id>`
   also diffs the new manifest against the live one (this sends the id, not the
   build).
5. **Fix, then re-run.** Work through findings in order: rejections first, then
   slow-review triggers, then attrition. Change the manifest or listing, rebuild
   and run `review-risk` again until the remaining findings are understood and
   accepted.
6. **Prepare the store forms.**
   - **Privacy practices:** the store derives these questions from the manifest.
     `review-risk` predicts which data types must be declared and whether a
     privacy policy URL is required. The answers must describe what the extension
     actually does.
   - **Permission justifications:** for each sensitive permission, write the
     answer the dashboard will ask for, in the user's own words, tied to a real
     feature. Offer wording as a starting point and tell the user to check it
     against the code.
   - **Listing draft:** `npx @extenshi/cli@latest generate-listing ./dist/my-extension.zip`
     writes a `CHROMEWEBSTORE.md` from the package. Treat it as a draft to edit.
7. **Clean up the name and description.**
   - Keep the name to one or two main keywords. A name that reads as a keyword
     list (several segments split by dashes, commas or ampersands) is flagged as
     keyword stuffing and can slow review. Put long-tail keywords in the short
     description and the full description instead.
   - Write the description for people. Repeating the same keyword many times is
     also flagged.
   - Every claim in the listing must match what the extension does.
8. **Hand off related work.** The `extension-icon-design` skill covers store
   icons. `npx @extenshi/cli@latest scan ./dist/my-extension.zip` adds a security
   scan of the package. It **uploads the package** to the Extenshi scan service,
   needs an Extenshi account and uses one scan from the allowance, so only offer
   it and run it when the user agrees. `search_docs` answers exact CLI flags and publishing steps.

## How to report

- **Blockers:** what will be rejected, with the manifest or listing line and the fix.
- **Likely slow review:** the trigger and how to remove or justify it.
- **Update risks:** anything that could disable the extension for current users.
- **Forms:** predicted privacy declarations and drafted permission justifications.
- **Next commands:** the exact commands to re-run after the fixes.

## Stay accurate

- The prediction is a set of heuristic checks against published store policies.
  It does not guarantee approval and it does not replace reading the policies or
  testing the extension in each target browser. Say so when reporting.
- Store rules change. Re-run the check on every release, not only the first.
- Do not write justifications or privacy answers for behaviour the extension does
  not have, and do not suggest hiding functionality from the reviewer.
- Firefox and Edge have their own requirements (for example a Firefox add-on id
  under `browser_specific_settings`); `review-risk` predicts Chrome Web Store
  review by default, and `--store` only selects which store's manifest to diff.
