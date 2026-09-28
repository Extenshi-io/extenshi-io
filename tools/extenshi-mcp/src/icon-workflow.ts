/**
 * Static content for the free `generate_icon_workflow` MCP tool.
 *
 * The free icon path spends ZERO Extenshi tokens and touches no Extenshi
 * infrastructure: the SVG master is authored locally, and
 * `@extenshi/cli icon preview` renders the verification page fully offline.
 * The tool returns the icon specification and the exact commands as reference
 * material — requirements, file formats and a process description — written so
 * a developer could read it on its own.
 *
 * Kept as a template function (not a docs fetch) so the tool works without
 * network access and never fails on a docs outage.
 */

export interface IconWorkflowArgs {
	extensionName?: string
}

export function renderIconWorkflow(args: IconWorkflowArgs): string {
	const name = args.extensionName?.trim() || 'My Extension'
	const iconFile = 'icon.svg'
	return `# Browser-extension icon — specification and local workflow

Cost and access: free and fully local. The SVG master is authored in the project, and the
Extenshi CLI renders an offline verification page. No API key, no credits, no uploads.

## Icon requirements (Chrome, Firefox, Edge)

- Deliverables: PNG at 16, 32, 48 and 128 px (128 px is the store-listing size), plus the
  SVG master. Chrome Web Store also uses a 440×280 promo tile.
- The 16 px toolbar render is the most-seen size, so the design targets it:
  - one bold silhouette, minimal interior detail, generous negative space;
  - no text and no thin outlines (below 1.5 px at 16 px they dissolve);
  - about 1 px of breathing room to the edges (toolbar buttons crop nothing, but
    adjacent icons sit 8–12 px away).
- Legible on light AND dark toolbars: mid-gray fills (around #7a7a7a) melt into both
  themes; a saturated brand color or a contrasting outline/backdrop shape holds up.
- File format: a single \`<svg>\` element, square viewBox (e.g. \`viewBox="0 0 24 24"\` or
  \`0 0 128 128\`), flat shapes, no embedded rasters, no scripts, no external references.

## Process

1. **Author the SVG master** — saved as \`${iconFile}\` in the project. The silhouette is
   settled at conceptual 16 px scale before any detail is added.
2. **Render the verification page** (free, offline):

   \`\`\`bash
   npx @extenshi/cli@latest icon preview ${iconFile} --name "${name}"
   \`\`\`

   The command writes a self-contained HTML file and opens it: Chrome / Firefox / Edge
   toolbar mockups with the icon pinned in place, switchable palettes (light, tinted, dark,
   black, saturated, plus a custom color picker) with an automatic contrast warning per
   palette, a store-size matrix, and an 8× pixel magnifier of the 16 px render.
3. **Review and iterate.** The developer reviews the page; after each edit to \`${iconFile}\`
   the same command re-renders it (\`--no-open\` on re-runs; refreshing the open tab is enough).
4. **Export** from the page buttons: per-size PNGs, or a ZIP containing
   \`icons/{16,32,48,128}.png\`, the SVG master and \`manifest-icons.json\`. The page also shows
   this manifest snippet:

   \`\`\`json
   {
   	"icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
   	"action": { "default_icon": { "16": "icons/16.png", "32": "icons/32.png" } }
   }
   \`\`\`
5. **Install** — the exported \`icons/\` folder is unpacked into the extension and referenced
   from \`manifest.json\` as above.
6. **Store listing artwork** from the same master (free, offline, WebAssembly renderer):

   \`\`\`bash
   npx @extenshi/cli@latest icon store-assets ${iconFile} --out store-assets
   \`\`\`

   Output per store: Chrome Web Store \`icon-128.png\` (96 px artwork, 16 px transparent
   padding), \`promo-small-440x280.png\` (required) and \`marquee-1400x560.png\`; Edge Add-ons
   \`logo-300x300.png\`, \`promo-small-440x280.png\` and \`promo-large-1400x560.png\`; AMO
   \`icon-128.png\`, \`icon-64.png\` and \`icon-32.png\`. Tiles are composed from the icon on a tint
   of its colour; \`--promo\` / \`--marquee\` take full-bleed artwork instead, with a warning when
   content is clipped or the aspect ratio is off.

## Related

- Hosted AI icon generation (no local tooling needed): https://dojo.extenshi.io/tools/icon-generator
- A logo or screenshot for a hosted landing page goes into the project's public media store
  with upload_project_media (CLI: \`npx @extenshi/cli@latest media upload <file> --project <id>\`),
  which returns a stable URL accepted as \`logoUrl\` / \`screenshots[].url\`.
- Documentation: https://docs.extenshi.io/developers/icon-generator
`
}
