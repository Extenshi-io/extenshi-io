---
name: extension-analytics
description: >
  Add consent-first usage and error reporting to a browser extension with
  extenshi-collector: plan the change with `analytics init`, wire the SDK into
  the background, add the consent toggle, declare the data in the manifest and
  the privacy policy, and check that the first event arrives. Use when the user
  asks "add analytics to my extension", "how many people use my extension",
  "track errors in my extension", "which browser versions are my users on",
  "set up extenshi-collector", or "what do I declare for analytics in the
  store".
---

# Extension analytics

`extenshi-collector` sends a weekly compatibility heartbeat, redacted errors
and, when the user opts in, usage events to the author's own PostHog project.
The Dojo Analytics dashboard reads that project. The setup command is
`npx @extenshi/cli@latest analytics init`; it works on the project's source and
is a dry run until `--write` is given.

On the Build Map this skill covers the steps `analytics` and `errors`. Report
them with the `extension-build` skill's commands.

## Running the command

Before running it, tell the user what it does and what leaves the machine, show
the exact command, and wait for their go-ahead. The command makes at most two
kinds of request, each announced before it runs: a read of the package's version
list from the npm registry and, for a proxy or self-hosted PostHog host, a
connectivity check of that host with an empty batch. `--offline` skips both. It
sends nothing to Extenshi or to PostHog's query API. `npx` downloads the CLI
from the npm registry.

## What the author provides

- A PostHog project of their own, and its **project token** and region (`eu`,
  `us`, or the address of a proxy or self-hosted instance). The author gives
  both on the command line; the accepted values are in the reference at
  https://docs.extenshi.io/developers/cli#extenshi-analytics-init.
- Whether to offer usage statistics as well as compatibility data (`--usage`),
  and whether to report errors (`--errors`, on by default).
- Whether Firefox is a target.

The SDK supports Manifest V3 only; the command refuses a Manifest V2 project.

## Set up (`analytics`)

1. **Plan.** Run the dry run and read it with the author:

   ```bash
   npx @extenshi/cli@latest analytics init . --token <project-token> --host eu --json
   ```

   `sdk.status` says where the SDK stands: `installed` or `vendored` (ready),
   `available` (on npm, not in the project), `legacy-installed` (a 0.8 package
   that has to be migrated first) and others the reference lists. `conflicts`
   and `warnings` name what has to be settled by hand.
2. **Get the SDK into the project.** For `available`, rerun with `--install
   --write`, or install `extenshi-collector` with the project's package manager.
   To vendor it, the plan names the build to copy and the path the wiring
   imports.
3. **Apply.** With `--write` the command writes only:
   - `extenshi.analytics.js` (or `.ts`) next to the background file, with the
     `startCollector` config;
   - manifest additions: `storage`; `alarms` with `--timer alarms`; for Firefox,
     `data_collection_permissions` with `technicalAndInteraction` as an optional
     category; `optional_host_permissions` for a proxy host that needs it;
   - a marked block at the top of the background file that starts the SDK;
   - `.extenshi/analytics.md`, the guide with every snippet and text below.

   It does not add `host_permissions`, edit the CSP, content scripts or
   extension pages, or touch a framework's own config. With a framework that
   generates the manifest, use `--write --guide-only` and apply the manifest
   part in the framework's config.
4. **Add the consent toggles.** The SDK stores and sends nothing until the user
   consents. There are two data classes, each with its own flag: compatibility
   data (the heartbeat and errors) and usage events. The guide has the snippet:
   a toggle on an extension page sends `{ type: 'extenshi:set-consent', consent }`
   to the background, whose handler checks that the sender is an extension page
   and calls `setConsent`. Keep one writer of the choice.
5. **Install and update events.** The SDK reports them itself, as the reason of
   an `extension_heartbeat` (`install`, `update`, `browser_update`,
   `consent_granted`, `periodic`). It registers its listeners inside
   `startCollector`, so that call has to run synchronously at the top level of
   the background file, before any `await`. Check that the generated block is
   still first after other edits. Usage events of the extension's own go
   through `capture()`, and only with the usage flag on.
6. **Update the texts.** The guide carries the privacy-policy paragraphs, the
   Chrome Web Store and Edge privacy answers and the notes for Firefox
   reviewers. Hand them to the policy and declaration work (the
   `extension-compliance` skill) unchanged.
7. **Connect Dojo.** Give the author `dojo.eventFilter` and `dojo.filterNote`
   from the JSON: they enter them when connecting the PostHog project in Dojo.
8. **Check the first event.** Load the built extension and allow compatibility
   data: that sends a `consent_granted` heartbeat at once. The JSON's
   `dojo.verifyQuery` counts the heartbeats of the last seven days in PostHog;
   the author runs it, or confirms the event in the Dojo Analytics dashboard.
   Until one of them shows the event, the step is not done.

Rerunning the command is safe: it reads its own markers and the saved answers
back, and reports what differs.

## Errors (`errors`)

- Error reporting is part of the SDK and on by default: unhandled errors and
  rejections are sent as `extension_error` with a redacted message, the error
  name and the file, line and column inside the package, under the same consent
  as the compatibility data.
- **Each context installs its own listeners.** The background block covers the
  service worker. Extension pages and content scripts need the page and
  content-script snippets from the guide; without them their errors are not
  seen.
- `--no-errors` turns reporting off: it writes `captureErrors: false` into the
  config and the snippets and removes the error paragraphs from the privacy
  text and the store answers.
- **Source maps:** there is no command that uploads them. If the project has a
  task for it, tell the author it is not available and close the task with a
  note; do not invent an upload.
- Check it the same way as the first event: throw a test error in each context
  of a development build, with consent on, and confirm it arrives.

## How to report

- The SDK state before and after, and the files the command wrote.
- Manifest changes, with the install warning each one adds, if any.
- Where the consent toggle is and what each choice sends.
- The texts handed over for the policy and the store answers.
- What was verified by an arrived event and what was not.

## Stay accurate

- Do not enable usage events without a consent toggle in the extension, and do
  not preselect consent.
- An automated test run that grants consent counts as a real user. Block the
  capture host in such runs.
- An install that happens before consent is reported as `consent_granted`, not
  `install`; weekly heartbeats undercount daily users. Say so when the author
  reads the first numbers.
- The author's PostHog project and the Dojo dashboard are not visible to the
  agent. Report an event as arrived only when the author has confirmed it.
- Do not widen what is collected beyond what the guide's privacy text says. A
  new property means a new line in the policy and the declarations first.
- A personal API key of the analytics provider is never needed here and the
  command refuses one.
