# Outline It — use the DOM from an MV3 service worker via an offscreen document

Copies a heading outline of the current page to your clipboard. The twist is
*where* the work happens: the service worker has no `DOMParser` and no
`navigator.clipboard`, so it hands the page's HTML to an **offscreen
document** — a hidden page with a real DOM — and gets back the finished
outline text.

This is the general-purpose offscreen pattern (the tab-recorder sample in
this repo is the media-flavored one): create the document with a
`justification`, target messages with a `target` field, and tear it down when
the queue is empty. The
[companion tutorial](https://blog.extenshi.io/posts/offscreen-documents-mv3-service-worker-dom/)
walks the lifecycle and the clipboard staging area.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3; permissions `offscreen`, `activeTab`, `scripting`, `clipboardWrite` |
| `service-worker.js` | Grabs the page HTML on click, creates/reuses the offscreen document, saves the result |
| `offscreen.html` / `offscreen.js` | `DOMParser` + outline builder + clipboard write via a staging `<textarea>` |

## Run it

1. Load the folder via `chrome://extensions` → **Developer mode** → **Load unpacked**.
2. Open any article page and click the **Outline It** icon.
3. Paste anywhere — you get the page's `h1`–`h3` structure as text.

## Permissions

`activeTab` + `scripting` for the one-tab HTML grab on click, `offscreen` for
the hidden document, `clipboardWrite` for the paste-ready result. No host
permissions.

## Browser changes since this was written

Checked on 2026-11-11 with `npx @extenshi/cli@latest advise .`:

- **Chrome 150** documents `chrome.offscreen.hasDocument()`, which resolves to
  a boolean telling whether the extension has an offscreen document. The sample
  keeps the `chrome.runtime.getContexts()` check because its manifest sets no
  minimum Chrome version, and that check also works on older releases. If you
  set `minimum_chrome_version` to 150 or later, `hasDocument()` can replace it.

MIT, like the rest of this repository.
