# Example output

What the free [`@extenshi/cli`](../tools/extenshi-cli/) actually produces, so you
can see it before installing anything. Every file here is a **single
self-contained HTML/JSON/Markdown document** — no external assets, no network.

GitHub shows HTML as source, so use the "view rendered" links (they serve the raw
file through [htmlpreview.github.io](https://htmlpreview.github.io)), or download
the file and open it locally.

| Example | Produced by | View |
| --- | --- | --- |
| `scan-report.html` | `npx @extenshi/cli@latest scan dist.zip` | [view rendered](https://htmlpreview.github.io/?https://raw.githubusercontent.com/Extenshi-io/extenshi-io/main/examples/scan-report.html) · [source](./scan-report.html) |
| `scan-report.md` | `npx @extenshi/cli@latest scan dist.zip --report report.md` | [read on GitHub](./scan-report.md) |
| `scan-report.json` | `npx @extenshi/cli@latest scan dist.zip --json` | [source](./scan-report.json) |
| `icon-preview.html` | `npx @extenshi/cli@latest icon preview icon.svg --name "Tab Tidy"` | [view rendered](https://htmlpreview.github.io/?https://raw.githubusercontent.com/Extenshi-io/extenshi-io/main/examples/icon-preview.html) · [source](./icon-preview.html) |
| `icon.svg` | the input icon used for the preview above | [source](./icon.svg) |

> **These are samples.** The scan example is rendered by the production renderer
> from a payload shaped exactly like a real scan response — the full eight-check
> roster, the same per-check finding fields — but for a fictional
> `sample-extension.zip`. The layout and the numbers-to-UI mapping are real; the
> findings do not describe any real extension. The
> icon preview is genuine output from `npx @extenshi/cli@latest icon preview` run on
> [`icon.svg`](./icon.svg).

---

## What to look for in the scan report

- **Verdict banner** at the top — the store-rejection risk in one line.
- **De-duplicated findings.** One rule firing across many files is a *single*
  collapsible row with a count and every location, instead of a wall of
  near-identical lines.
- **Store-compliance risks** ranked by review danger, each with evidence and a
  concrete fix.
- **Store review prediction** — what will be REJECTED, what causes user
  ATTRITION on update, what merely triggers a SLOW manual review. (Available on
  its own, offline and free, via `npx @extenshi/cli@latest review-risk`.)
- **Coverage — what we checked**: all eight checks with their finding counts,
  including the ones that came back clean. A scanner that failed or timed out is
  called out there too, so a partial run never reads as a clean one.
- Filters by severity / scanner / free text, a sticky table of contents, and a
  light–dark toggle. Try the toggle in the rendered view.

## What to look for in the icon preview

- Your icon at **16 px in Chrome, Firefox, and Edge toolbars**, among neighbor
  extensions — the size it actually lives at.
- The **palette switcher** and the contrast strip: light, tinted, dark, black,
  saturated, custom. Icons that disappear on dark toolbars are the single most
  common extension-icon bug.
- The **8× magnifier** of the 16 px render, the canvas-usage meter, and the
  store-size matrix (16 / 32 / 48 / 128).
- **Export**: per-size PNGs, or a ZIP with `icons/*.png`, the SVG master, and a
  ready `manifest-icons.json`.

This page is free and offline — no account, no key, nothing uploaded:

```bash
npx @extenshi/cli@latest icon preview ./icon.svg --name "My Extension"
```

Want your coding agent to run the whole loop? See the
[**extension-icon-design skill**](../skills/extension-icon-design/).
