# Extenshi plugin

Skills and a connector for people who build, review or choose browser extensions.
The plugin adds the [Extenshi](https://extenshi.io) catalog of Chrome, Firefox and
Edge extensions to Claude, together with skills that teach Claude how to use it and
how to prepare an extension for store review.

## What is included

| Component | What it does |
| --- | --- |
| `extenshi` connector | A remote MCP server at `https://mcp.extenshi.io/mcp`. Search the catalog, read one extension's details and reviews, look up security scores, and get market figures. Signing in happens in the browser with OAuth; no API key is needed. |
| `extension-vetting` skill | For anyone choosing an extension: checks publisher, popularity, permissions in plain language, security score and reviews for one extension, and suggests alternatives. |
| `installed-extensions-audit` skill | Looks up the safety score of every extension you have installed in one batch and ranks what to review first. |
| `extension-market-research` skill | For developers: sizes a niche, finds incumbents and gaps, reads what users complain about and writes a short competitor brief. |
| `extension-store-readiness` skill | For developers: trims manifest permissions, predicts Chrome Web Store rejections and slow reviews locally, and drafts permission justifications and listing text. |
| `extension-icon-design` skill | Designs an extension icon that stays readable at 16 px in real Chrome, Firefox and Edge toolbars, checks it locally and exports the store-ready PNG set. |

## Install

Add the plugin from the Claude directory (Customize page in claude.ai or the desktop
app); it is then also available in Claude Code. On first use of a catalog tool Claude
opens a sign-in page for your Extenshi account.

## Examples

- "Find Manifest V3 extensions for tab management that ask for few permissions and
  show me their safety scores."
- "Compare the top three ad blockers on Firefox by rating, permissions and risk."
- "Make an icon for my extension that saves reading progress, and check it in dark
  and light toolbars."

## What it sends and where

- Catalog questions go to `mcp.extenshi.io` through your signed-in connection. The
  server returns catalog data only; it does not read your browser, your installed
  extensions or your files.
- The installed-extensions audit sends only the store ids you provide.
- The icon skill runs entirely on your machine. Its one external command,
  `npx @extenshi/cli icon preview`, works offline, needs no account and sends
  nothing.
- The store-readiness skill runs `npx @extenshi/cli review-risk` on your machine.
  The build is read locally and is not uploaded; only when you pass an extension
  id to compare against your live listing is that id sent.

## Links

- Documentation: <https://docs.extenshi.io>
- Catalog: <https://catalog.extenshi.io>
- Issues: <https://github.com/Extenshi-io/extenshi-io/issues>
- Privacy policy: <https://mcp.extenshi.io/privacy>
- License: MIT, see `LICENSE`
