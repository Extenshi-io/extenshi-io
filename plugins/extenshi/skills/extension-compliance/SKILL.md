---
name: extension-compliance
description: >
  Make what a browser extension says about user data match what it does:
  inventory what the code collects, stores and sends, write and publish a
  privacy policy from that inventory, wire the policy link into the extension
  and the listings, prepare the store data declarations, and draft license
  terms for a paid extension. Use when the user asks "what data does my
  extension collect", "write a privacy policy for my extension", "what do I
  answer in the Chrome privacy practices tab", "what goes in
  data_collection_permissions", "do I need a privacy policy", or "I need
  license terms for my paid extension".
---

# Extension compliance

Three texts describe an extension's handling of data: the privacy policy, the
store's data declarations and the consent shown in the extension. Stores compare
them with each other and with the code, and a mismatch can suspend the whole
publisher account. Build all three from one inventory.

On the Build Map this skill covers the steps `dataInv`, `policy`, `policyUrl`,
`declarations` and `license`. Report them with the `extension-build` skill's
commands.

## Running commands

Before running any `npx @extenshi/cli@latest` command, tell the user what it
does and what leaves their machine, show the exact command, and wait for their
go-ahead. Publishing a policy or license terms changes a public page: show the
text and get the author's approval first.

## Data inventory (`dataInv`)

Read the code, not the intentions. Write the inventory to a file in the
repository so the policy and the declarations can cite it.

1. **Trace what leaves the device:** every `fetch`, `XMLHttpRequest`,
   `WebSocket`, `sendBeacon`, form post and image or script URL built from data.
   For each, record the host, what is sent and what triggers it.
2. **Trace what is stored:** `chrome.storage`, IndexedDB, cookies, the Cache
   API. Record the keys, what they hold and how long.
3. **Trace what is read:** page content, URLs and titles from `tabs`, history,
   clipboard, location, identity. A value that is read and never stored or sent
   is still worth a line, marked as processed on the device only.
4. **Classify** each item with the store's own words: personally identifiable
   information, authentication information, location, web history, user
   activity, website content, financial and payment information, health
   information, personal communications.
5. **Name the third parties:** analytics, crash reporting, payment and feedback
   providers, any backend the author runs, and the SDKs bundled in the package.
   An install or device identifier sent with events is pseudonymous personal
   data, not anonymous data.

Two commands give a cross-check:

```bash
npx @extenshi/cli@latest review-risk ./dist/my-extension.zip
```

runs locally and lists the data types the Chrome Web Store will ask about for
the declared permissions (for example `history` leads to web history, `identity`
to personally identifiable information). The Markdown report of the security
scan (`scan --report`, described in the `extension-security-scan` skill) adds a
table of declared permissions against the calls that use them.

When the collector SDK is set up, `.extenshi/analytics.md` holds its privacy
paragraphs and store answers; include them as they are.

## Privacy policy (`policy`)

The policy states the inventory in plain language: what is collected, why, where
it goes, how long it is kept, how a user can decline or ask for deletion, and a
working contact address.

- **Hosted by Extenshi (Pro project):** `publish_privacy_policy` generates the
  first version from the project's saved form and manifest, or publishes
  Markdown passed as `bodyMarkdown`. It changes the live page. To change an
  existing policy, `update_privacy_policy_with_ai` returns a proposal and
  publishes nothing; read it, then publish what the author approved. From the
  terminal:

  ```bash
  npx @extenshi/cli@latest privacy publish docs/PRIVACY.md --project <project-id> --dry-run
  ```

  The dry run compares the file with the live version and sends nothing.
- **Hosted elsewhere:** the browser generator at
  https://dojo.extenshi.io/tools/privacy-policy-generator exports Markdown and
  HTML. Any stable public HTTPS address that needs no sign-in works.
- **Law sections:** GDPR by default, CCPA/CPRA for California users, COPPA for
  an extension directed to children. Which law applies depends on where the
  users are.
- **Translations:** the English policy is the binding text. Extenshi translates
  its own template sentences; sections the author wrote or edited are translated
  with `get_legal_translations` and `set_legal_translations`, and stay in
  English until then.

If the extension collects user data, the Chrome Web Store also requires a
prominent disclosure and consent inside the extension's own interface before
collection starts. A policy alone does not satisfy that.

## Policy link (`policyUrl`)

- In a Dojo project the link is `PRIVACY_POLICY_URL` in the integration config.
  Take it from `get_project_state`; never type a link from memory.
- Put the same link in every store listing. For Firefox, link it from the
  listing description: a copy pasted into the store's own policy field stays as
  it was sent and has to be resent after each change.
- Check that the page answers: `verify_hosted_artifact` with `kind: "privacy"`
  for a hosted policy, or open the address in a browser for one hosted
  elsewhere.

## Store declarations (`declarations`)

- **Chrome Web Store:** the Privacy practices tab asks for the single purpose,
  a justification per permission, the data types collected and the
  certifications. Draft the answers from the inventory:

  ```bash
  npx @extenshi/cli@latest generate-listing ./dist/my-extension.zip
  ```

  writes `CHROMEWEBSTORE.md` on the user's machine with the listing copy, the
  justifications and the privacy answers to fill in. The tab is filled in the
  Developer Dashboard by the author.
- **Firefox:** `browser_specific_settings.gecko.data_collection_permissions` in
  the manifest. `required` lists what the add-on always transmits, or
  `["none"]`; categories the user can decline go under `optional`.
- **Edge:** the privacy questions in Partner Center; `generate-listing --store
  edge` lays them out in `EDGE.md`.

The declarations are the author's statements to the store. Prepare them, show
each answer with the inventory line behind it, and have the author confirm.

## License terms (`license`)

For a paid extension, the terms a buyer accepts. They are separate from the
code license (`license` among the project's owner decisions).

1. `get_license_terms_questionnaire` returns the questions.
2. `draft_license_terms` builds an unsaved draft from the answers. Take the
   answers from the pricing decision and the author; the seller's identity is
   the author's to state.
3. `save_license_terms_draft` stores the draft (needs Pay write access).
4. `request_license_terms_publication` returns an approval link. The owner
   publishes by approving it.
5. `verify_license_terms_live` checks the page and the paywall links afterwards.

## How to report

- The inventory as a table: data, source, purpose, destination, retention.
- Policy: where it is hosted, the version or date, the sections changed.
- Declarations per store, each answer tied to an inventory line.
- Differences found between the code, the policy and the declarations, with the
  fix for each.
- What waits on the author: approval of the policy text, the dashboard answers,
  the license approval link.

## Stay accurate

- This is not legal advice. Say so, and suggest a lawyer where the extension
  handles health, financial or children's data.
- Do not write "we collect no data" unless the inventory shows it. Analytics,
  crash reports, a feedback form with an email field and a payment SDK each
  count.
- Regenerate the inventory when permissions, SDKs or network calls change; the
  policy and the declarations follow it.
- A permission the code does not use is a reason to remove the permission, not
  to declare its data type.
