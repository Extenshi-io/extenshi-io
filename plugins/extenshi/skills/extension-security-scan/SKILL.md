---
name: extension-security-scan
description: >
  Scan a browser extension's own package before the stores see it and work
  through the result: run the pre-publish security scan, read the findings with
  their files and lines, fix the critical and high ones, rescan the rebuilt
  package, run the store-compliance check, and set up CI so every push is
  packaged, installed and recorded as evidence. Use when the user asks "scan my
  extension", "is my extension safe to publish", "fix the scan findings", "why
  did the scan flag this", "check my package against store policy", or "add the
  checks to GitHub Actions".
---

# Extension security scan

Find what a store reviewer or a security scanner would find in the package
while it can still be fixed, then make the result repeatable in CI.

On the Build Map this skill covers the steps `scan`, `fix`, `selfCheck` and
`ci`. Report them with the `extension-build` skill's commands.

## Running commands

Before running any `npx @extenshi/cli@latest` command, tell the user what it
does and what leaves their machine, show the exact command, and wait for their
go-ahead. For the scan say three things plainly: the package is uploaded to
Extenshi for analysis, it needs the author's Extenshi account, and each run
spends one scan from that account. Signing in is the author's step
(https://docs.extenshi.io/developers/cli#authenticate). `get_credit_balance`
shows what is left.

## Scan (`scan`)

1. **Scan the package that will ship.** Build it with `extenshi package`, so
   the bytes are the same on every machine, and pass that zip:

   ```bash
   npx @extenshi/cli@latest scan <chrome package>.zip --report scan.md --no-open
   ```

   Without `--no-open` the HTML report opens in the browser. `--json` prints the
   raw result. With the local MCP server, `scan_extension` runs the same scan.
2. **Read the report.** It has the security findings and four more sections:
   - **Store compliance:** manifest signals stores reject or delist for.
   - **Store review prediction:** what is likely rejected, what triggers a slow
     review, what disables the extension on update.
   - **Store listing:** the listing rules over the name and short description in
     every locale the package ships. Add `--listing <file>` to include the full
     description.
   - **Platform advisories:** code that a recent or upcoming browser release
     changes, with file and line.

   The Markdown report (`--report`) adds **declared versus used permissions**,
   each `USED`, `NOT USED` or `CANNOT VERIFY` with the call sites, and the
   justification questions the store will ask.
3. **Record it for the release**, when the directory is bound to a Dojo project:
   add `--evidence`. The record is tied to the zip's sha256 and fails on a
   likely store rejection or any critical finding.

## Fix findings (`fix`)

1. **Order by severity.** Critical and high first; then what the review
   prediction marks as a rejection.
2. **Open every finding.** Read the code at the file and line and decide which
   it is:
   - **Real:** fix the code. Typical fixes are removing remotely loaded code,
     replacing `eval` and `innerHTML` with safe equivalents, narrowing a match
     pattern, dropping a `NOT USED` permission, updating or removing a bundled
     library with a known vulnerability.
   - **In a bundled library:** update the library, or replace it. Do not edit
     minified vendor code by hand.
   - **Not applicable:** the scanners are heuristics and over-flag some benign
     code. Write down why it does not apply, with the file and line, and show
     the author. Accepting a finding is their decision.
3. **Recheck locally before spending another scan.** Two commands are free, run
   on the machine and cover the compliance and advisory sections:

   ```bash
   npx @extenshi/cli@latest review-risk ./dist/my-extension.zip
   npx @extenshi/cli@latest advise .
   ```

4. **Rebuild, repackage, rescan.** Group the fixes so one rescan covers them.
   A rebuilt package has a new sha256, so evidence recorded for the earlier zip
   no longer counts; rerun the checks that record evidence on the new one.
5. **Stop when** no critical or high finding remains, or each remaining one has
   the author's written acceptance.

## Compliance self-check (`selfCheck`)

The same policy checks, read as a reviewer would:

```bash
npx @extenshi/cli@latest review-risk ./dist/my-extension.zip --listing CHROMEWEBSTORE.md
```

Run it once per target store (`--store chrome`, `firefox` or `edge`). It runs
locally and uploads nothing. Fix what it predicts as a rejection in the manifest
or the listing: an unjustified permission, a missing privacy policy for the data
the permissions imply, a listing that names another product or stuffs keywords.
The `extension-store-readiness` skill covers these fixes in detail.

## CI evidence (`ci`)

The goal is two workflows: one that packages each browser build and installs it
in Chromium, Edge and Firefox on every push, and a follow-up that records a
green run as evidence for the release.

1. **Start from the generated files.** A project scaffolded by Extenshi already
   has `.github/workflows/extenshi-verify.yml` and `extenshi-evidence.yml`. In
   another repository, write them from the guide:
   https://docs.extenshi.io/developers/project-sync#ci-evidence-let-the-pipeline-attest-its-own-runs
2. **Bind the repository to the project** (`project bind`), so a run can be
   matched to it.
3. **The repository secret is the author's step.** The evidence workflow reads
   one Actions secret. The guide above says where it is created and where it is
   stored; ask the author to do both, and do not put its value in a file, a
   commit or the conversation.
4. **Record from the follow-up workflow, not from a build step.** The server
   accepts only a run that has completed, and checks through GitHub that the run
   exists in the bound repository at that commit with that conclusion.
5. **Try it without sending:** `evidence ingest <package> … --dry-run` validates
   the options and prints the request it would make.
6. **Wait for the first green run** and confirm the record:
   `npx @extenshi/cli@latest release status --browser chrome --json`, or
   `get_release_readiness`.

A scan in CI is optional and spends a scan per run; the guide at
https://docs.extenshi.io/developers/cli-github-actions shows how to gate a
release on it.

## How to report

- The package scanned: file name and sha256.
- Findings by severity, each with file, line, the decision (fixed, in a
  library, not applicable) and the reason.
- What changed between scans.
- The compliance result per store.
- CI: the workflows added, the first run's result, and what waits on the
  author.

## Stay accurate

- A clean scan is not a guarantee of safety or of store approval. Say what the
  scan covers: automated heuristics over the package.
- Do not mark a finding accepted for the author, and do not silence it by
  renaming or obfuscating code.
- Never rescan in a loop to see whether a finding goes away. Each run costs the
  author a scan.
- A red CI run records failed evidence. Fix the cause; do not skip the
  recording step to keep the status green.
