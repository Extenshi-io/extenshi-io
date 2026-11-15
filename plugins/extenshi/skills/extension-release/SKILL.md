---
name: extension-release
description: >
  Take a tested browser extension through release: bump the version, build one
  reproducible package per store, check that the listing, policy, screenshots
  and evidence all describe that exact package, submit to the Chrome Web Store,
  Firefox Add-ons and Edge Add-ons with the author's approval, follow the
  review, and confirm the public listing. Use when the user asks "release my
  extension", "publish a new version", "submit to the Chrome Web Store",
  "submit my add-on to AMO", "is my extension ready to publish", "my extension
  was rejected", or "is the new version live yet".
---

# Extension release

A release is five separate facts: a package was built, it was uploaded, it was
submitted for review, the store approved it, and the listing is public. Record
each one on its own, and never report an earlier one as a later one.

On the Build Map this skill covers the steps `ready`, `zip`, `cws`, `amo`,
`edge`, `track` and `live`. Report them with the `extension-build` skill's
commands.

## Running commands

Before running any `npx @extenshi/cli@latest` command, tell the user what it
does and what leaves their machine, show the exact command, and wait for their
go-ahead. Submitting to a store is the author's decision every time: prepare
everything, show what will be sent, and submit only after they say so for this
version.

## What the author sets up

Store accounts and store API access belong to the author and are set up by
them, once per store. The guides describe each:

- Chrome Web Store: https://docs.extenshi.io/developers/publish-to-chrome-web-store
  (a developer account with 2-step verification and a one-time registration
  fee).
- Firefox Add-ons: https://docs.extenshi.io/developers/publish-to-firefox-add-ons
  (free).
- Edge Add-ons: https://docs.extenshi.io/developers/publish-to-edge-add-ons
  (free; Partner Center).

Point the author to the guide for the store and wait. Whether a store is
configured is checked with `publish --validate` (below), which publishes
nothing.

## Package per browser (`zip`)

1. **Bump the version** in the source manifest. Stores refuse a version they
   already hold. The same version goes to every store.
2. **Build, then package:**

   ```bash
   npx @extenshi/cli@latest package dist --browser chrome,edge,firefox --firefox-dir dist-firefox
   ```

   It writes one zip per browser and `extenshi-packages.json` with each sha256,
   by default under `.extenshi/packages`. The zips are reproducible: the same
   files give the same bytes on any machine. It reads the build directory,
   changes nothing in it and uploads nothing.
3. **Firefox.** Lint the build and expect 0 errors:

   ```bash
   npx web-ext@10 lint --source-dir dist-firefox
   ```

   When the code is bundled, minified or transpiled, reviewers need the source
   and the build steps:

   ```bash
   npx @extenshi/cli@latest amo-source . --out amo-source.zip --verify <firefox package>
   ```

   archives the committed source, writes `BUILD.md`, rebuilds in a clean
   directory and compares the result with the package. It refuses an uncommitted
   working tree and flags a vendored minified file whose origin it cannot show.
4. **Rerun the checks on these zips.** A version bump changes the bytes, so
   evidence recorded for an earlier package reads `stale`. Install each zip
   (`test smoke`, the `extension-testing` skill) and scan the final package
   (the `extension-security-scan` skill) before going on.

## Listing readiness (`ready`)

Everything a store form asks for exists and describes this package.

1. **Collect:** the icon set and listing artwork, screenshots per store and
   locale, the listing draft (`CHROMEWEBSTORE.md`, `AMO.md`, `EDGE.md` from
   `generate-listing`), the privacy policy link, the permission justifications
   and the data declarations.
2. **Cross-check by reading:** the name is the same in the manifest, the
   listing and the hosted pages; the version in the manifest is the one being
   released; every link opens; the listing describes only features this
   version has; the screenshots show this version.
3. **Record the release**, in a directory bound to a Dojo project:

   ```bash
   npx @extenshi/cli@latest release prepare .extenshi/packages/extenshi-packages.json --browser chrome --locales en --source-manifest src/manifest.json --listing CHROMEWEBSTORE.md --policy docs/PRIVACY.md --payment not-used --dry-run
   ```

   Read the diff, then run it without `--dry-run`. It records hashes of the
   package, manifest, listing and policy; it runs no tests. Pass the same
   listing file that `review-risk --listing` and `screenshots --listing` used,
   or their evidence will not match.
4. **Read the status:**

   ```bash
   npx @extenshi/cli@latest release status --browser chrome --json
   ```

   or `get_release_readiness`. Each check is `passed`, `failed`, `stale` (a
   record exists for another package or input) or `unknown` (no record). A
   `DECISION_UNDECIDED:<key>` blocker is an owner decision the author makes in
   Dojo; `AMO_ADDON_ID_MISMATCH` means the Firefox package carries a different
   add-on ID than the decided one.
5. Fix what is failed or stale with the skill for that check, then read the
   status again. Repeat per target browser.

## Submit

Confirm the configuration first:

```bash
npx @extenshi/cli@latest publish <package> --stores chrome,firefox,edge --validate
```

The upload goes from the user's machine straight to each store; the package is
not sent to Extenshi. With the local MCP server, `publish_extension` does the
same.

- **Chrome Web Store (`cws`).** A new item is created by the author in the
  Developer Dashboard, where the Store listing, Privacy and Distribution tabs
  are also filled: the store's API does not accept them. Give the author the
  values from `CHROMEWEBSTORE.md` field by field. For an existing item,
  `publish <zip> --stores chrome` uploads the package and submits it.
- **Firefox Add-ons (`amo`).** A listed submission runs end to end:

  ```bash
  npx @extenshi/cli@latest publish <zip> --stores firefox --listing AMO.md --source amo-source.zip --screenshots <dir>
  ```

  It creates the add-on on the first submission, or edits its listing, and
  reports each step. A new add-on is created only with the decided add-on ID,
  because the ID is permanent. `--release-notes` is public on the listing;
  `--reviewer-notes` goes to reviewers only: say how to test the add-on and
  how to reach anything behind a sign-in. Rerunning after a partial failure
  resumes.
- **Edge Add-ons (`edge`).** The first submission is created by hand in Partner
  Center; give the author the values from `EDGE.md`. Later versions:
  `publish <zip> --stores edge`, which waits for the publish request to reach a
  final status.

Before each submission, state the store, the version, the package's sha256 and
that the same package passed the checks, and wait for the author's yes.

## Review tracking (`track`)

- Read the state per store: `release status --json`, and for Chrome
  `publish --validate`, which reads the item's status.
- Report "in review" as in review. Review time is the store's and is not
  predictable.
- **On a rejection:** ask the author for the store's message, which arrives by
  email and in the dashboard. Quote the policy it names, find the cause in the
  package or the listing (`review-risk` predicts against the same policies),
  and write each cause down as a task with the step it belongs to. Fix,
  rebuild, bump the version when the store requires a new one, and go through
  packaging and readiness again.
- Do not resubmit the same package with only the reviewer notes changed unless
  the rejection was about the notes.

## Live (`live`)

- Open the public listing and confirm the version it shows.
- `get_extension` or `search_extensions` shows whether the catalog lists the
  extension yet; say what you see, with the date.
- Once a listing is public, its review page appears in `REVIEW_URLS` of the
  project's integration config.
- The first installs appear as heartbeats in the author's analytics, when the
  collector is set up (the `extension-analytics` skill).

## How to report

- Version, and per store: package file and sha256, uploaded, submitted,
  approved, public, each with a yes, a no or "pending" and the time.
- Readiness checks that were failed or stale and what fixed them.
- What waits on the author: an account, a dashboard form, an approval.
- For a rejection: the store's reason, the cause found, the fix.

## Stay accurate

- A successful upload is not a submission, and a submission is not a release.
- Never submit without the author's approval for this version, and never
  create a store item or a Firefox add-on ID on your own initiative.
- Do not edit a package after it was checked. A changed file is a new package
  that needs its checks again.
- Do not promise a review outcome or a date.
