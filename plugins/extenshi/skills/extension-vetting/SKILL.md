---
name: extension-vetting
description: >
  Check whether a browser extension looks safe to install, using the Extenshi
  catalog: publisher and popularity, permissions in plain language, security
  score, user reviews, and safer alternatives. Use when the user asks "is this
  extension safe", "should I install X", "what does this extension have access
  to", "is this Chrome/Firefox/Edge extension legit", or pastes a store link and
  wants a second opinion before installing.
---

# Extension vetting

Give a person an evidence-based read on one extension before they install it.
Everything comes from the Extenshi connector (`search_extensions`,
`get_extension`, `get_security`, `get_reviews`). Nothing is installed, run or
read from the user's browser.

## Workflow

1. **Identify the extension.**
   - If the user gave a store link, take the id from it and note the store:
     `chromewebstore.google.com/detail/<name>/<id>` is Chrome,
     `microsoftedge.microsoft.com/addons/detail/<name>/<id>` is Edge,
     `addons.mozilla.org/.../addon/<slug>` is Firefox. Chrome and Edge ids look
     identical, so always pass `store` with a Chrome or Edge `store_id`.
   - Otherwise call `search_extensions` with the name as `query`, `limit: 5`, and
     confirm the match with the user when several listings share a name. Copycat
     names are common; compare publisher and install counts before choosing.
2. **Read the listing.** `get_extension` returns publisher, ratings per store,
   install counts, categories, last update and the security badge. Note how long
   the extension has existed, how recently it was updated, and how many people use it.
3. **Read the security data.** `get_security` returns the safety score (0-100,
   higher is safer, the same number the website shows), the risk category
   (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), finding counts by severity, the
   top grouped findings and an approximate **install-dialog preview** built from
   the permissions the store lists. It reads existing results and does not start
   a new scan. It costs 3 read credits; `get_credit_balance` shows what is left.
4. **Translate the permissions.** Explain each permission in the install-dialog
   preview in one plain sentence and say whether it fits the extension's stated
   purpose. A page-translation tool reading all sites is expected; a PDF viewer
   asking for browsing history is not. Broad access such as all-sites or
   `<all_urls>`, `webRequest`, `cookies`, `history`, `clipboardRead` and
   `nativeMessaging` deserves an explicit mention.
5. **Sample the reviews.** `get_reviews` returns review excerpts for Firefox and
   Edge listings. For Chrome it returns only the store-level aggregate and a link
   to the reviews tab, because Chrome review text cannot be redistributed. Say
   which case applies. Look for repeated complaints (ads injected, settings
   hijacked, sudden ownership change, paywall added after install) and for
   review dates clustered in a short window.
6. **Offer alternatives when the picture is mixed.** Search the same category
   with `search_extensions`, for example `risk: ["NONE","LOW"]`, `minRating: 4`,
   `sortBy: "safety"`, and present two or three with the same facts.

## How to report

Lead with a one-line conclusion, then the evidence. Suggested shape:

- **Bottom line:** `Looks fine`, `Install with care`, or `Look for an alternative`,
  in one sentence with the main reason.
- **Who and how popular:** publisher, users, rating, last update, store(s).
- **Security data:** safety score, risk category, finding counts, date of the last scan.
- **What it can access:** the permissions, in plain language.
- **What users say:** the pattern in the reviews, or the aggregate for Chrome.
- **If unsure:** what would change the answer.

## Stay accurate

- The safety score and findings are automated estimates of risk, not a verdict on
  the publisher's intent. Many findings are ordinary behaviour in benign code, so
  never present a finding count as proof of wrongdoing, and never call an
  extension "safe" or "malicious" outright. Say what the data shows.
- An extension with no score has **not been scanned yet**. That is not the same
  as safe; say so.
- The data is a snapshot from the last scan. A later update can change behaviour.
- Do not invent facts the tools did not return (owner history, revenue, private
  data practices). If a field is missing, say it is missing.
- Never claim to have opened, run or tested the extension.
