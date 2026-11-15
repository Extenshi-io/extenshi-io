---
name: extension-surfaces
description: >
  Write the working parts of a Manifest V3 browser extension so they survive
  real use: a service worker that keeps no state in memory, messaging between
  surfaces, a versioned storage schema, content scripts that inject once and
  clean up, a popup and options page that work from the keyboard, a side panel,
  and unit tests for handlers, migrations and page hooks. Use when the user
  asks "write the background script", "my service worker loses its state",
  "the content script runs twice", "build the popup", "add a settings page",
  "add a side panel", or "write tests for my extension".
---

# Extension surfaces

Implementation rules for each surface of a Manifest V3 extension. Most failures
in the field come from four causes: the service worker was stopped and lost its
state, a content script ran twice or outlived its extension, a page called an
API the browser does not have, or a surface trusted a message it should have
checked.

On the Build Map this skill covers the steps `bg`, `content`, `popup`,
`options`, `sidepanel` and `tests`. Build only the surfaces the project chose,
and report each step with the `extension-build` skill's commands.

## Service worker (`bg`)

- **Register every listener at the top level**, synchronously, on each start.
  A listener added inside a callback or after an `await` is missing when the
  browser wakes the worker for that event.
- **Keep no state in variables.** The browser stops an idle worker after about
  30 seconds and starts it again for the next event. Read what a handler needs
  from `chrome.storage` and write results back.
- **Use `chrome.alarms` for anything later than a few seconds.** A `setTimeout`
  or `setInterval` dies with the worker.
- **Set up in `runtime.onInstalled`:** defaults on `install`, storage migrations
  on `update`.
- **No DOM and no `window`.** Parse or render in an extension page or an
  offscreen document.
- **Firefox** runs the same file as a background script. Keep the code free of
  service-worker-only globals, or guard them.

**Message bus.** Define one message shape, for example `{ type, payload }`, and
one handler that switches on `type`.

- A handler that answers asynchronously returns `true` and calls `sendResponse`
  later, or returns a promise where the browser supports it. Without that the
  sender gets `undefined`.
- Check the sender: `sender.id` is the extension's own id, and for a request
  only extension pages may make, `sender.url` starts with the extension origin.
  A content script runs in a page the extension does not control, so validate
  what it sends like any outside input.
- Send to a tab with `chrome.tabs.sendMessage` and expect it to fail when the
  tab has no content script; catch the error.

**Storage schema.** Write the keys and their shapes down and give the schema a
version number. `storage.sync` has small quotas (about 8 KiB per item); use
`storage.local` for anything larger. The optional `@extenshi/storage` package
keeps one record per key with a `schemaVersion`; it needs the `storage`
permission, takes records up to 16 KiB, and belongs in the service worker.

## Content script (`content`)

- **Register it for the match patterns chosen for the target sites** and no
  wider. For a feature started by a click, inject with
  `chrome.scripting.executeScript` under `activeTab`.
- **Inject once.** Guard with a marker on the page so a second injection (an
  update, a re-click, a single-page navigation) does nothing.
- **Follow page changes** with a `MutationObserver` scoped to the node the
  feature needs, not the whole document, and react to navigation in single-page
  apps.
- **Clean up.** Disconnect observers, remove listeners and injected nodes when
  the feature turns off. After an extension update the old script keeps running
  without a working `chrome.runtime`: catch the "Extension context invalidated"
  error and stop.
- **Isolate the UI.** Put injected interface in a shadow root so page styles do
  not leak in and the extension's do not leak out.
- **Treat page content as untrusted.** Build nodes with `textContent` and DOM
  methods, never `innerHTML` with page data. Do not pass page data to `eval` or
  load code from a server: stores reject remotely hosted code.
- **Keep privileged work in the worker.** The script asks over the message bus;
  it holds no keys and no data it does not render.

## Popup (`popup`)

- The popup closes when it loses focus and loses its state. Load state from the
  worker or storage on open and save every change at once.
- Scripts live in files. The extension CSP blocks inline scripts and inline
  event handlers.
- Render first, then load data; show the last known state instead of a spinner
  where one exists.
- **Keyboard and focus:** every control is reachable with Tab in visual order,
  the first useful control has focus on open, focus is visible, and each input
  has a label. Use `button` and `a` elements for things that are clicked.
- Chrome caps a popup at 800 by 600 pixels. Design for a narrow column.

## Options page (`options`)

- Declare it with `options_ui` and decide between an embedded page and
  `open_in_tab`.
- One settings schema, shared with the worker: defaults, types and limits in one
  module.
- Validate on input and on save; show the error next to the field.
- Save to storage and let other surfaces follow with `storage.onChanged`, so a
  change applies without a reload.

## Side panel (`sidepanel`)

- Chromium: `side_panel.default_path` and the `sidePanel` permission. To open
  it from the toolbar button, call
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` in the
  worker.
- Firefox: `sidebar_action` with the same page. Detect the API before calling
  it, so one code base serves both.
- The panel stays open across tabs. Follow `tabs.onActivated` and
  `tabs.onUpdated` when its content depends on the page.

## Unit tests (`tests`)

- Keep logic in pure functions that take data and return data; the files that
  call `chrome.*` stay thin. Test the functions directly.
- **Handlers:** each message type, with a valid payload, a malformed one and a
  sender that must be refused.
- **Storage migrations:** from each earlier schema version to the current one,
  and from empty storage.
- **Content hooks:** against saved HTML fixtures of the target pages, including
  a second run on the same document.
- Use a small fake of the `chrome` APIs the code calls. `@extenshi/storage`
  accepts a `MemoryArea` in tests.
- Run the project's test command and report the real result. A check in a real
  browser (the package installs, the popup opens, the content script injects)
  belongs to the `extension-testing` skill.

## How to report

- Per surface: the files written and what each one handles.
- The message types and the storage keys, as a short table.
- What was tested and how: unit tests run, pages opened in a browser, target
  sites tried.
- Behaviour not verified, for example a worker restart or a denied permission,
  named as not verified.

## Stay accurate

- Test on the real target sites and across a worker restart before calling a
  surface done. A surface that works right after loading the unpacked folder
  has not been through a restart.
- API availability differs between Chrome, Edge and Firefox and between
  versions. Check the browser's documentation for an API before relying on it;
  the `extension-browser-changes` skill finds calls that a release changed.
- Do not add a permission to make a call work without telling the author: the
  manifest is theirs to approve.
