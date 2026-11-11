---
name: extension-browser-changes
description: >
  Check a browser extension against recent and upcoming Chrome, Edge and Firefox
  changes: APIs that start throwing or return something else, events that stop
  arriving, manifest keys and permissions that work differently, deprecations,
  and new APIs that replace a workaround. Use when the user asks "will my
  extension break in the next Chrome", "what changed for extensions in Chrome
  157", "is my extension affected by this browser update", "check my extension
  for deprecated APIs", or wants to keep an extension current between releases.
---

# Extension browser changes

Find the places in an extension that a browser release changes, before users
find them. The check is `npx @extenshi/cli@latest advise`: it compares the
extension's code and manifest with the list of changes published at
https://cli.extenshi.io/changes and reports each match with its file and line.
It is free and needs no account.

## Running the command

Before running it, tell the user what it does and what leaves the machine, show
the exact command, and wait for their go-ahead. The code is read locally and is
not uploaded. Each run downloads the current list of changes from
`cli.extenshi.io/advisories.json`, a public file; the request carries nothing
about the user or the code, and the list is kept for a day in `~/.extenshi/`.
`--offline` skips the download and uses the list the CLI version ships with.
`npx` downloads the CLI from the npm registry.

## Workflow

1. **Pick the input.** A source directory (preferred, because matches then
   point at the files the author edits) or a built `.zip`, `.crx` or `.xpi`. In
   a directory the command reads JavaScript, TypeScript and JSON, skips
   `node_modules`, `dist`, `build`, `coverage` and dot-folders, and looks for
   `manifest.json` in `./`, `src/`, `public/` and `static/`.
2. **Run it:**

   ```bash
   npx @extenshi/cli@latest advise .
   ```

   Add `--json` to read every advisory with its matches (`file`, `line`,
   `column`, `snippet`). By default it checks for Chrome and Edge, plus Firefox
   when the manifest has `browser_specific_settings.gecko`; set the list with
   `--browsers chrome,edge,firefox,safari`. `--include-watch` adds proposals
   that have not merged yet, and `--as-of <YYYY-MM-DD>` decides what has shipped
   as of that date instead of today.
3. **Read the labels.** Each advisory says what it means for users:
   - `BREAKS`: the code stops working as written. A call starts throwing, or a
     value the code branches on goes away.
   - `BEHAVIOR CHANGE`: the code keeps running, but events or data it relied on
     no longer arrive in some cases.
   - `DEPRECATED`: still works, on its way out.
   - `OPPORTUNITY`: a new API replaces a workaround. Where the manifest still
     allows browser versions without it, the advisory names the versions that
     need a fallback.
4. **Open every match.** Read the code around the line and decide whether the
   change applies. The matching is textual: a call through an alias
   (`const ps = chrome.publicSuffix`) is not found, and a call that is already
   guarded with `try`/`catch` is still listed. Follow the advisory's links (the
   Chromium change, the MDN release notes, the W3C WebExtensions issue) when
   the summary is not enough.
5. **Propose the change per match.** For `BREAKS` and `BEHAVIOR CHANGE`, fix
   the code or add the guard, and say which browser version it starts to
   matter in. For an `OPPORTUNITY`, check `minimum_chrome_version` and
   `strict_min_version` before replacing the workaround, and keep a fallback
   where older versions are still allowed.
6. **Test the result in the browser version that changed.** The
   `extension-testing` skill runs the package in a chosen browser channel or
   major version (`test smoke --channel beta`, `--version 157`).

## How to report

- **Affects users now:** `BREAKS` and `BEHAVIOR CHANGE` matches for versions
  already on the stable channel, each with file, line and the fix.
- **Coming:** the same labels for beta, dev or announced versions, with the
  date or version when known.
- **Deprecated:** what to replace and by when.
- **Worth adopting:** opportunities, with the fallback they need.
- **Checked and not affected:** matches that turned out not to apply, in one
  line each, so the next run does not re-open them.

## Stay accurate

- `advise` always exits 0. It points at places to look; it does not pass or
  fail a build, and an empty result is not proof that nothing changed.
- It finds what its list covers. A change that is not in the list, or a call
  it cannot see in the text, is not reported. Say so when the result is empty.
- Do not state a release date or version the advisory does not give.
- Re-run it on every release and after each browser release: the list grows
  between CLI versions.
