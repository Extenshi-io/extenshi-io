---
name: installed-extensions-audit
description: >
  Audit the browser extensions a person already has installed: look up the
  safety score and risk category of every one in a single batch and produce a
  ranked list of what to review first. Use when the user asks to "audit my
  extensions", "check what I have installed", "which of my extensions are risky",
  "clean up my browser extensions", or shares a list of extension ids or names.
---

# Installed extensions audit

Turn "what is in my browser?" into a short, ranked to-do list. A whole batch of
up to 40 extensions costs one read credit, so a normal browser profile is one or
two calls.

## Step 1: get the list of extension ids

Only the ids leave the machine. Ask the user for one of these:

- **Chrome:** open `chrome://extensions`, turn on **Developer mode**, and copy
  the **ID** shown under each extension.
- **Edge:** the same on `edge://extensions` with **Developer mode** on.
- **Firefox:** open `about:support` and copy the id of each entry in the
  **Extensions** section.
- **Names only:** if the user only has names, find each with `search_extensions`,
  confirm the match, and use its store id. Say which ones you could not match.

If the user prefers to script it, the Chrome `management` API can list installed
extensions; a working example is in the `samples/` folder of
https://github.com/Extenshi-io/extenshi-io.

## Step 2: look them up in one batch

Call `get_risk_by_store_ids` with `extensions: [{ store_id, store }, ...]`, at
most 40 per call. `store` (`CHROME`, `FIREFOX` or `EDGE`) is required for every
entry because Chrome and Edge ids share one format. For more than 40, make
several calls. Alternatively the user can run this from a terminal, which reads
`store:id` lines from a file:

```bash
npx @extenshi/cli@latest risk --file ids.txt
```

The response gives, per extension, the safety score (0-100, higher is safer), the
risk category, severity counts, the last scan date and the catalog URL. Ids with
no catalog listing come back under `notInCatalog`, and extensions without a score
have `scanned: false`.

## Step 3: rank and explain

Sort into three groups and present them as a table (name, store, score, category):

1. **Review first:** risk category `HIGH` or `CRITICAL`, or the lowest scores.
2. **Worth a look:** `MEDIUM`, plus anything not updated in over a year.
3. **No flags:** `NONE` or `LOW`.

Then list separately, without judging them: extensions that were **not scanned**
and ids that are **not in the catalog**. Neither means safe.

## Step 4: go deeper on the top few

For the two or three highest-risk entries, call `get_security` (3 read credits
each) and explain the permissions and top findings in plain language. Apply the
`extension-vetting` skill's reporting rules. Ask the user whether they still use
each one; an unused extension with broad permissions is the easiest win.

## What to recommend

- Suggest **reviewing** each flagged extension and removing the ones the user no
  longer needs. Do not tell the user to delete everything above a threshold.
- Point to `search_extensions` for a lower-risk alternative when a flagged
  extension is one they rely on.
- Remind them that a low score is an automated estimate. It is a reason to look
  closer, not a verdict on the publisher.

## Stay accurate

- Do not claim anything about extensions that were not looked up.
- A score reflects the last scan; extensions update. Suggest repeating the audit
  every few months.
- Mention that sideloaded or company-managed extensions may not be in the catalog.
