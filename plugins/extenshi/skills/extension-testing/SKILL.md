---
name: extension-testing
description: >
  Test a packaged browser extension in real browsers with the Extenshi CLI:
  check that the exact zip installs and boots in Chromium, Edge and Firefox,
  run scenario tests against its popup, options and side panel, and shoot the
  store screenshots per locale. Use when the user asks to "test my extension",
  "does my extension load in Firefox", "smoke test the build", "write tests for
  my extension popup", "test against Chrome beta", or "make the store
  screenshots".
---

# Extension testing

Prove that the package the user is about to upload works in a browser. The
commands install the exact zip in a real browser on the user's machine and
report what the browser itself says. They are free and need no Extenshi
account.

## Running commands

Before running a command, say what it does, show it and wait for the user's
go-ahead. The package is not uploaded. The commands start a local browser and
may download a browser build into a cache outside the project
(`~/Library/Caches/extenshi/browsers` or `~/.cache/extenshi/browsers`).
Scenarios make whatever network requests the extension itself makes. `npx`
downloads the CLI from the npm registry.

## What is needed

- A built extension: a store zip, the `extenshi-packages.json` that
  `npx @extenshi/cli@latest package <dir> --browser chrome,edge,firefox`
  writes, or an unpacked build folder with `manifest.json` at its root.
- For Chromium and Edge, Playwright in the project. It is not bundled with the
  CLI, so ask before installing it:
  `npm i -D playwright && npx playwright install chromium`
  (`npx playwright install msedge` for Edge).
- For Firefox, only a Firefox binary on the usual install paths or in `PATH`
  (`--firefox-bin` or `FIREFOX_BIN` otherwise).

## 1. Smoke test: does the package boot?

```bash
npx @extenshi/cli@latest test smoke .extenshi/packages/extenshi-packages.json --browser chromium
npx @extenshi/cli@latest test smoke .extenshi/packages/extenshi-packages.json --browser firefox
```

It checks that every file the manifest names is in the zip, the browser loads
the extension and its service worker (or Firefox background) starts, the
browser reports no manifest errors, and the popup, options and side-panel pages
open without uncaught errors or `console.error`. The exit code is 1 when a
check fails; `--json` prints the result as JSON.

Content scripts are checked only on pages you name:

```bash
npx @extenshi/cli@latest test smoke dist --browser chromium --site http://127.0.0.1:4178/fixture.html
```

`--site` is repeatable and takes http or https pages. It passes when every
script of each matching `content_scripts` entry was injected and the extension
raised no errors there. Serve local fixtures from a static server on
`127.0.0.1`; content scripts do not run on `file://`. `--site` is not supported
on Firefox yet.

To test a browser version other than the installed one, add `--channel beta`
(`stable`, `beta`, `dev`, `canary`; Firefox: `stable`, `beta`, `dev`, `esr`) or
`--version 157` (a major version; not for Edge).

## 2. Scenario tests: do the features work?

Scenarios live in `extenshi.tests.json` next to the build:

```json
{
  "format": "extenshi.tests",
  "version": 1,
  "scenarios": [
    {
      "id": "popup-dark-toggle",
      "title": "Dark mode toggle restyles the popup",
      "open": "popup",
      "steps": [
        { "click": "#dark" },
        { "expectChanged": true },
        { "expectStorage": { "key": "theme", "equals": "dark" } },
        { "expectNoConsoleError": true }
      ]
    }
  ]
}
```

```bash
npx @extenshi/cli@latest test run .extenshi/packages/extenshi-packages.json --browser chromium
```

- `open` is `popup`, `options`, `side_panel`, `sidebar`, `page:<path in the
  extension>`, `fixture:<file>` or `url:https://…`.
- Action steps: `click`, `hover`, `type` + `text`, `press`, `scroll`, `wait`,
  `waitFor`, `storage`, `clickControl` (by visible label). Checks:
  `expectText`, `expectNoText`, `expectControl`, `expectStorage`,
  `expectChanged`, `expectRendered`, `expectNoConsoleError`,
  `expectNoRequestTo`, `expectManifest`.
- `--only <id>` runs one scenario, `--out <dir>` saves the result and images.
- A field the CLI does not know is refused with its path. Get the full format
  from `search_docs` or https://docs.extenshi.io/developers/cli#extenshi-test-run
  before using a step you have not seen above.

Write scenarios from what the listing promises and what users do, one promise
per scenario. Two commands help you start:

- `npx @extenshi/cli@latest test scenarios draft <package> --browser chromium`
  opens the extension's pages, records their controls in `.extenshi/recon.json`,
  presses a few labelled controls and writes `extenshi.tests.draft.json`.
- `npx @extenshi/cli@latest test scenarios prompt <package>` prints a brief for
  writing `extenshi.tests.agent.json` from that inventory.

Both files run as **not written by the author**: such scenarios need an
`evidence` quote, cannot use `eval`, and refuse controls whose label looks
destructive (delete, pay, send). Show the scenarios to the user. The ones they
accept are copied into their own `extenshi.tests.json`; do not copy them
yourself without asking.

## 3. Store screenshots per locale

```bash
npx @extenshi/cli@latest screenshots ./dist --scenes store/scenes.json --locales en,de,ja
```

A scenes file lists what to open and which steps to run before each capture:

```json
{
  "version": 1,
  "scenes": [
    { "name": "popup", "open": "popup", "steps": [{ "click": "#enable" }, { "wait": 300 }] },
    { "name": "options", "open": "options", "crop": { "selector": "main", "padding": 24 } }
  ]
}
```

The command switches the browser UI language for each locale and stops when
`chrome.i18n` does not report that locale, so it never writes English
screenshots labelled German. It writes 1280×800 PNGs (accepted by all three
stores; `--small` for each store's smaller size) under
`store-screenshots/<store>/<locale>/` with a `screenshots.json` of hashes. The
Chrome Web Store takes at most 5 screenshots per locale and Edge at most 6. The
build is never modified. Show the screenshots to the user before they go into a
store dashboard; choosing them is the user's decision.

## How to report

- Per browser: passed, failed or not run, with the browser version the result
  names.
- Each failed check or differing step, quoted from the output, with the file
  it points at.
- What was not covered (below), so a pass is not read as more than it is.

## Stay accurate

- A smoke pass means the package boots without errors. Pages are opened, not
  clicked through, and the popup opens as a tab rather than from the toolbar.
- A differing scenario step is an observation. It can come from the extension,
  the scenario, the page or the browser; read the step before blaming the code.
- On Firefox most steps are not implemented yet. A scenario that uses one is
  reported `unsupported`, never `passed`, and a passed Firefox result attests
  only that the pages opened without errors.
- The Chrome leg runs on Chromium, because Google Chrome ignores
  `--load-extension`. Firefox screenshots are rendered in Chromium from
  the same build.
- These commands do not replace using the extension by hand in each target
  browser before a release.
