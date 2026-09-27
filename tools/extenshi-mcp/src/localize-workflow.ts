/** Static, keyless guidance; translation and filesystem changes belong to the caller's local agent. */
export function renderLocalizeWorkflow(): string {
	return `# Local extension localization

This workflow is free of Extenshi credits and requires no API key. The MCP tool returns
static instructions. Your coding agent translates using its own provider and tokens;
the CLI prepares and validates local files offline after installation.

## Availability

First run \`extenshi localize --help\` with the CLI installed in your environment.
Use a release that includes localize. A merged change is not proof that npm latest
contains it. When working from the Extenshi repository, build the CLI with
\`yarn workspace @extenshi/cli build\` and replace \`extenshi\` below with
\`node tools/extenshi-cli/dist/cli.js\` (from the repository root).

## Prepare

Start from manifest.json with default_locale and
_locales/<default_locale>/messages.json. This workflow handles these messages,
including manifest name/description references. Full store descriptions and arbitrary
hardcoded UI strings need their own extraction and review.

\`\`\`bash
extenshi localize prepare ./extension --lang fr,de,es --output ./localization --protect MyBrand
\`\`\`

The output localization-request.json contains missing, stale or untracked messages, grouped by
locale. Use a fresh output directory on each run; prepare refuses to overwrite its request.
When localization.json supplies targetLocales, --lang is optional. Its protectedTerms
are combined with --protect. Keep the version, sourceLocale, locale keys and sourceHashes unchanged. Each
locale has this structure (the hash shown is illustrative; retain the actual prepared hash):

\`\`\`json
{
  "version": 1,
  "sourceLocale": "en",
  "locales": {
    "fr": {
      "sourceHashes": { "greeting": "<prepared SHA-256>" },
      "messages": { "greeting": { "message": "Hello", "description": "Greeting in popup" } }
    }
  }
}
\`\`\`

## Translate and review

Translate only message text into each target language. Preserve keys, placeholder
names and definitions, positional substitutions, escaped dollar signs and protected
terms exactly. Keep descriptions as translation context. Use the actual product for
context; never invent features, guarantees or marketing claims. Save the edited bundle
as ./localization/translations.json. Preserve any removeKeys array: it lists translations whose source keys were
deleted. Review these removals together with the translated messages. A removal-only
locale has empty messages and sourceHashes objects and still requires reviewed: true.

Review the translations for meaning, tone, brand spelling and truthful claims before
applying, then add "reviewed": true inside each reviewed locale object alongside
sourceHashes and messages. Apply requires this explicit review marker. Source hashes detect edits to the source while translation was in progress;
if the source changed, prepare a fresh request and translate the changed entries again.

## Apply and validate

\`\`\`bash
extenshi localize apply ./extension --translations ./localization/translations.json --protect MyBrand
extenshi localize check ./extension --protect MyBrand
\`\`\`

Apply validates the bundle before updating _locales. Keep .extenshi-localization.json
with the project: it records source and reviewed target hashes for incremental updates. Direct target edits require re-review. Re-run
prepare after changing source messages. Review the diff and resolve validation errors;
do not bypass placeholder, protected-term or listing-risk failures to get a green result.

## Release review gates

- Run review-risk for every target locale using the exact command documented by your
  installed CLI's help. Resolve listing risks against the real build and retain reports.
- Have a fluent reviewer inspect the copy and any full store descriptions/screenshots.
- Load the packaged extension under each target language. Check popup/options, long
  strings, truncation and keyboard accessibility. For Arabic/Hebrew, inspect RTL direction,
  layout and mixed text/numbers. A locale file or passing CLI check does not prove RTL UI support.
- Rebuild and check every browser artifact. Publish only within the developer's authorization.

Documentation: https://docs.extenshi.io/developers/localization
`
}
