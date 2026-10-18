---
name: extension-icon-design
description: >
  Design a browser-extension icon that stays readable at 16px in real Chrome,
  Firefox, and Edge toolbars, then verify and export it locally. Use when the
  user asks to create, improve, or check an extension icon ("make an icon for
  my extension", "my icon looks bad in the toolbar", "generate extension
  icons", "prepare store icon set").
---

# Extension icon design

Design an icon for a browser extension, verify it inside realistic browser
toolbars, and export the store-ready PNG set — fully local and free. The only
external tool used is `npx @extenshi/cli@latest icon preview`, which runs offline,
needs no account, and sends nothing anywhere. Tell the user what a command does
before you run it.

## What the stores need

- PNG renders at **16, 32, 48, and 128 px** (128 px is the store-listing
  size), declared in `manifest.json` under `icons` and `action.default_icon`.
- Keep the **SVG master** in the repo — every size is rasterized from it.
- Chrome Web Store additionally uses a **440×280 promo tile** on some
  surfaces.

## Design rules (the 16 px reality)

The icon lives most of its life at 16 px in a crowded toolbar. Design for
that, not for the 128 px store tile:

1. **One bold silhouette.** If the shape isn't recognizable as a filled black
   blob, no amount of detail will save it. Sketch the silhouette first;
   only then add interior detail — at most one or two cuts.
2. **No text, no hairlines.** Letters and strokes thinner than ~1.5 px at
   16 px dissolve into noise.
3. **Fill the canvas.** The artwork's bounding box should reach ~90%+ of the
   viewBox in its larger dimension, with ~1 px of breathing room. Wide
   transparent margins shrink the icon relative to its toolbar neighbors.
4. **Survive light AND dark toolbars.** Users run both themes. Avoid
   mid-gray fills (#6a6a6a–#9a9a9a) — they clear contrast checkers on every
   background yet stand out on none. Prefer a saturated brand color, or add
   a contrasting outline / backdrop shape.
5. **Flat beats fancy.** Gradients and shadows band and smear at 16 px.
   If you use a gradient, keep it subtle and verify the 16 px render.
6. **SVG hygiene:** a single `<svg>` element, square `viewBox` (e.g.
   `0 0 24 24` or `0 0 128 128`), flat shapes, no embedded rasters, no
   scripts, no external references.

## Workflow

1. **Ask what the extension does** (if not already clear) and pick one
   metaphor — a single object, not a scene. Confirm the primary brand color
   if one exists.
2. **Draw the SVG yourself** and write it to `icon.svg`. Start from the
   silhouette; check it mentally at 16 px before adding any interior detail.
3. **Render the verification page** (offline, free):

   ```bash
   npx @extenshi/cli@latest icon preview icon.svg --name "Extension Name"
   ```

   It opens a self-contained HTML page: the icon pinned inside Chrome /
   Firefox / Edge toolbar mockups, switchable palettes (light, tinted, dark,
   black, saturated + a custom color) with an automatic contrast warning per
   palette, a mid-gray detector, a canvas-usage meter with an edge-to-edge
   trim toggle, a store-size matrix, and an 8× magnifier of the 16 px pixels.
4. **Ask the human to review the page**, then iterate: edit `icon.svg`,
   re-run with `--no-open`, refresh the tab. Take the page's warnings
   seriously — "low contrast" on a palette means a real share of users won't
   find the icon in their toolbar. Aim for a clean bill: every palette
   reads well, no mid-gray note, canvas usage ~90%+.
5. **Export from the page buttons**: the ZIP contains
   `icons/{16,32,48,128}.png`, the SVG master, and `manifest-icons.json`.
   Unpack `icons/` into the extension and wire the manifest:

   ```json
   {
   	"icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
   	"action": { "default_icon": { "16": "icons/16.png", "32": "icons/32.png" } }
   }
   ```

## Quality checklist (before calling it done)

- [ ] Silhouette recognizable at 16 px (check the 8× magnifier)
- [ ] Every palette in the contrast strip shows "reads well"
- [ ] No mid-gray warning
- [ ] Canvas usage ~90%+ (or trim toggle applied)
- [ ] No text, no strokes under 1.5 px at 16 px scale
- [ ] Manifest references all four sizes

## Going further (optional)

The same CLI can check the rest of the release, also without an account:
`npx @extenshi/cli@latest review-risk dist.zip` predicts Chrome Web Store review
outcomes offline. Docs and the full command reference:
https://docs.extenshi.io/developers/icon-generator
