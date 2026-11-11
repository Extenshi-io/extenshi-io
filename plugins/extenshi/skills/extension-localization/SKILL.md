---
name: extension-localization
description: >
  Translate a browser extension's `_locales` messages with the agent doing the
  translation and the Extenshi CLI preparing, validating and applying it
  locally: only new or changed messages are translated, placeholders and brand
  terms are checked, and every locale is compared with the default one. Use when
  the user asks to "translate my extension", "add German and Japanese to my
  extension", "localize the store listing name and description", "check my
  _locales", "my translations are out of date", or "internationalize my
  extension".
---

# Extension localization

Add or update the languages of an extension. You translate; the CLI decides
what needs translating, keeps placeholders and protected terms intact, and
writes the result into `_locales`. The `localize` commands need no Extenshi
account and no credits, and they work on files on the user's machine. The
translation itself uses your own model.

If the Extenshi connector is available, `localize_workflow` (free) returns the
same command sequence with the JSON contract.

## Running commands

Before running any `npx @extenshi/cli@latest localize …` command, say what it
does, show the exact command and wait for the user's go-ahead. Nothing from the
extension is uploaded; `npx` downloads the CLI from the npm registry.

## What the extension needs

`manifest.json` with `default_locale`, and a matching
`_locales/<default_locale>/messages.json`. Localized manifest strings use
`__MSG_key__` references. Keep translator context in each message's
`description`.

If the extension has plain English text in the manifest and in static HTML and
no `_locales` yet, start with a copy:

```bash
npx @extenshi/cli@latest localize init ./extension --output ./extension-localized
```

The output directory must be new and outside the source. The command moves
literal manifest text, static HTML text and display attributes into the English
catalog and writes `LOCALIZATION-REPORT.md`. Read the report with the user:
JavaScript and framework source are left unchanged, so dynamic text and
templates need manual work. An extension that already uses `_locales` skips
this step.

## Workflow

1. **Agree on languages and protected terms.** Ask which locales to add and
   which names must stay untranslated (the extension name, brand and product
   names). Use the same `--protect` list in every command below. A
   `localization.json` in the project can hold `targetLocales` and
   `protectedTerms`; then `--lang` can be omitted.
2. **Prepare the request:**

   ```bash
   npx @extenshi/cli@latest localize prepare ./extension --lang fr,de,es --output ./localization --protect MyBrand
   ```

   It writes `localization-request.json` into a fresh output directory (it
   refuses to overwrite an existing request). Each locale lists only the
   messages that are missing, whose source changed, or whose translation has no
   recorded hashes.
3. **Translate.** For each locale, translate the `message` text. Keep message
   keys, placeholder definitions, named and positional substitutions (`$NAME$`,
   `$1`), escaped dollar signs and protected terms exactly as they are. Leave
   `version`, `sourceLocale` and `sourceHashes` unchanged. Honour `removeKeys`
   when a locale has it. Save the completed file as `translations.json` in the
   same output directory.
4. **Review with the user.** Translations must say what the product does and
   nothing more: no added claims, no dropped limits. Short UI strings must fit
   their place; store name and short description have length limits. After the
   review, add `"reviewed": true` to each locale object. `apply` requires that
   marker, so never set it for a locale nobody looked at.
5. **Apply and check:**

   ```bash
   npx @extenshi/cli@latest localize apply ./extension --translations ./localization/translations.json --protect MyBrand
   npx @extenshi/cli@latest localize check ./extension --protect MyBrand
   ```

   `apply` validates before it writes: empty messages, unknown keys,
   placeholders, protected terms, changed source hashes and listing risk. If
   the source changed while you translated, prepare a new request for the
   changed entries. `check` compares every locale with the default one and
   names the rule behind each error (for example `unsupported-locale` for a
   `_locales/pt-BR` folder Chrome ignores, or `missing-catalog`).
6. **Keep the tracking file.** Commit `.extenshi-localization.json` with the
   project. The next `prepare` uses it to reuse translations whose source did
   not change.
7. **Check the listing text.** The store name and short description come from
   the same catalogs. `npx @extenshi/cli@latest review-risk <zip>` reads them
   per locale and flags listing problems; see the `extension-store-readiness`
   skill.

## Projects that generate their own catalogs

When a script writes every `messages.json` from one dictionary, there is no
`.extenshi-localization.json` and the review gate cannot apply. Run the rules
that need no review history:

```bash
npx @extenshi/cli@latest localize check ./extension --parity-only
```

## How to report

- Languages added or updated, with the number of messages translated in each.
- What `check` still reports, per locale, with the rule name.
- Text that could not be extracted or translated (dynamic strings, templates)
  and where it lives.
- What the user should look at in the browser: right-to-left layouts, long
  strings in small controls, the localized store name.

## Stay accurate

- A locale is supported only after `apply` and `check` pass. Listing a locale
  in `localization.json` records a request, not a translation.
- Do not mark a locale reviewed on the user's behalf, and do not translate
  feature claims into something the extension does not do.
- The commands do not open a browser. They validate the files, not how the
  translated UI looks; the `extension-testing` skill shoots the UI per locale.
- Use only the locale codes Chrome supports (`pt_BR`, not `pt-BR`).
