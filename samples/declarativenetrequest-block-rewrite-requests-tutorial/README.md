# Clean Link — block requests and strip tracking params with declarativeNetRequest

A Manifest V3 blocker: denies requests to domains you list and rewrites
outbound links to remove tracking parameters (`utm_*` and friends) — all as
*declarative* rules the browser network stack evaluates, with no extension
code on the request path.

`rules.json` is the heart of it: a `block` rule by domain pattern and a
`redirect` rule using `queryTransform.removeParams`. The popup toggles the
rule sets at runtime. The
[companion tutorial](https://blog.extenshi.io/posts/declarativenetrequest-block-rewrite-requests-tutorial)
covers the rule syntax, priorities, and why DNR replaced `webRequest` blocking
in MV3.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3; permissions `declarativeNetRequest` (+ `declarativeNetRequestFeedback` for the counters) |
| `rules.json` | Static ruleset: block-by-domain + strip-tracking-params rewrite |
| `popup.html` / `popup.js` | Enable/disable rules and show what's active |
| `service-worker.js` | Rule-set updates and feedback wiring |

## Run it

1. Load the folder via `chrome://extensions` → **Developer mode** → **Load unpacked**.
2. Try opening a blocked domain — the request is denied by the network stack.
3. Open any page with `?utm_source=…` in a link — the parameter is stripped before the request leaves.

## Permissions

`declarativeNetRequest` for the rules; `declarativeNetRequestFeedback` only
because the popup shows match counts — drop it and the blocker still blocks.
Pure blocking needs no host permissions at all, but this extension also
*rewrites* links, and redirect/modify rules need host access for the origins
involved — that's why `*://*/*` is declared.

## Browser changes since this was written

Checked on 2026-11-11 with `npx @extenshi/cli@latest advise .`:

- **Chrome 157** (stable since 2026-11-03): navigations started from a site the
  user put under "block all extensions on this site" no longer match
  declarativeNetRequest rules, including link clicks from that site to other
  sites. No error is raised. The rules in this sample are unchanged and still
  apply everywhere else; do not promise that a blocker built on them sees every
  navigation.

MIT, like the rest of this repository.
