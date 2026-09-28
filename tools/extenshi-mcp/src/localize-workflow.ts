/**
 * Static reference for the free `localize_workflow` MCP tool: the local
 * localization process, the translation-bundle file format and the release
 * checks. Written as documentation a developer can read on its own — it
 * describes the process and its constraints, it does not address the reader.
 */
export function renderLocalizeWorkflow(): string {
	return `# Local extension localization — reference

Cost and access: free. No Extenshi credits and no API key. Translation happens with
whichever translation provider the developer already uses; the Extenshi CLI prepares
and validates the local files offline.

## Availability

The \`localize\` command ships in recent \`@extenshi/cli\` releases; \`extenshi localize --help\`
shows whether the installed version includes it. A merged change is not the same as an
npm release — the npm \`latest\` tag is the reference for what is installable. Inside the
Extenshi repository the CLI is built with \`yarn workspace @extenshi/cli build\` and run as
\`node tools/extenshi-cli/dist/cli.js\` from the repository root in place of \`extenshi\`.

## Scope

Input: \`manifest.json\` with \`default_locale\`, plus \`_locales/<default_locale>/messages.json\`.
Covered: those messages, including the manifest name/description references.
Not covered: full store descriptions and hardcoded UI strings — they need separate
extraction and review.

## Step 1 — Prepare

\`\`\`bash
extenshi localize prepare ./extension --lang fr,de,es --output ./localization --protect MyBrand
\`\`\`

Output: \`localization-request.json\`, listing missing, stale or untracked messages grouped
by locale. Each run needs a fresh output directory; prepare does not overwrite an existing
request. When \`localization.json\` supplies \`targetLocales\`, \`--lang\` is optional, and its
\`protectedTerms\` are combined with \`--protect\`.

The fields \`version\`, \`sourceLocale\`, the locale keys and \`sourceHashes\` are part of the
contract and stay unchanged. Per-locale structure (the hash is illustrative; the real
prepared hash is kept):

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

## Step 2 — Translate and review

Translation rules:

- Only message text is translated into each target language.
- Keys, placeholder names and definitions, positional substitutions, escaped dollar signs
  and protected terms are preserved exactly.
- Descriptions stay as translator context.
- Copy reflects the actual product: no new features, guarantees or marketing claims.

The edited bundle is saved as \`./localization/translations.json\`. A \`removeKeys\` array, when
present, lists translations whose source keys were deleted; it is preserved and reviewed
together with the translated messages. A removal-only locale has empty \`messages\` and
\`sourceHashes\` objects and still carries the review marker.

Review covers meaning, tone, brand spelling and truthful claims. Each reviewed locale object
gets \`"reviewed": true\` next to \`sourceHashes\` and \`messages\`; apply rejects a locale without
this marker. Source hashes detect source edits made while translation was in progress — when
the source changed, a fresh prepare and re-translation of the changed entries is required.

## Step 3 — Apply and validate

\`\`\`bash
extenshi localize apply ./extension --translations ./localization/translations.json --protect MyBrand
extenshi localize check ./extension --protect MyBrand
\`\`\`

Apply validates the bundle before it updates \`_locales\`. \`.extenshi-localization.json\` belongs
in the project: it records source and reviewed target hashes for incremental updates. Direct
edits to target files require re-review, and changed source messages require a new prepare.
Validation errors (placeholders, protected terms, listing risks) are resolved in the copy;
they are not bypassed to reach a passing result.

## Release checks

- \`review-risk\` runs for every target locale (exact syntax: the installed CLI's help); listing
  risks are resolved against the real build and the reports are kept.
- A fluent reviewer inspects the copy, full store descriptions and screenshots.
- The packaged extension is loaded under each target language: popup/options, long strings,
  truncation and keyboard accessibility. Arabic/Hebrew additionally need RTL direction,
  layout and mixed text/number checks — a locale file or a passing CLI check does not prove
  RTL UI support.
- Every browser artifact is rebuilt and checked. Publication stays within the developer's
  authorization.

Documentation: https://docs.extenshi.io/developers/localization
`
}
