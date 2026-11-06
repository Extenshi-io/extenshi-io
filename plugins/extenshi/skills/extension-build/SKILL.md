---
name: extension-build
description: >
  Build a browser extension together with its author on the Extenshi build map,
  a local page that shows which build steps are done, which an agent is working
  on and which wait on the author. Covers offering the map once, opening it,
  keeping it current as steps finish, and handing the author the steps only they
  can do. Use when building or shipping an extension end to end with the user
  ("build me an extension that…", "let's make a Chrome extension", "take my
  extension to the store", "show me the progress", "open the build map").
---

# Building an extension with the build map

The build map is a page that `npx @extenshi/cli@latest map` serves on
`127.0.0.1`. It lays out every step of building and releasing an extension
(idea, scaffold, icon, privacy, listing, tests, packages, store submissions)
with the dependencies between them, and shows each step as done, in progress,
waiting on the author, locked, or not needed for this extension. The author
sees progress at a glance and makes their choices there, such as picking an
icon or approving screenshots.

## One map per project

A project has exactly one map and one map server. That holds however many
agents work on it and from whichever git worktree:

- The map lives in the main checkout. From a linked worktree the CLI finds the
  same project directory in the main working tree, so every agent reads the
  same `.extenshi/build-map.json` and reaches the same server.
- Running `npx @extenshi/cli@latest map` again, from any terminal, agent or
  worktree, returns the server that is already running. It never starts a
  second map, so running it is safe whenever you need the address.
- The state file is written by the CLI under a lock. Do not edit
  `.extenshi/build-map.json` by hand, copy it into a worktree, or keep your own
  progress file next to it.
- `map stop` stops the map for every agent and the author. Run it only when the
  author asks.
- When you split work across subagents, only the agent talking to the author
  offers the map and links to it. Subagents never offer it or start it.

## Before offering: has this project been asked already?

Check the record first, so a new session does not ask again:

- **With the local Extenshi MCP server (`@extenshi/mcp`)**, `get_project_state`
  and `create_project` return `buildMap`: `running`, `url` while it runs,
  `offered`, `declined`, `offers` (how many times the author answered) and
  `home` (the directory the map belongs to). Pass `projectDir` when the
  extension is not in the server's working directory.
- **Otherwise** (the hosted connector has no access to local files), read the
  `offer` object in `.extenshi/build-map.json` of the extension project in the
  main checkout. From a worktree, the main checkout is the directory that
  contains the path `git rev-parse --path-format=absolute --git-common-dir`
  prints. No file means the map was never offered.

| What the record says | What to do |
| --- | --- |
| A map is running | Do not offer. Use its address and link steps (below). |
| Accepted before, nothing running now | The author already said yes; the server stopped after an idle hour. Run `npx @extenshi/cli@latest map --no-open` when you next need the author and give the link. The old tab reconnects by itself. |
| Declined, `offers` is 1 | Do not offer now. Mention the map once more at the first visual choice (usually the icon). |
| Declined, `offers` is 2 or more | Do not offer again. Work in chat. |
| Never offered | Offer it at the right moment (below). |

## Offering the map

The map is an offer, not a required step. Make it once, after you understand
what the extension does and for whom, and before the first step that needs the
author. Keep it short, in the author's language, about what they get, with a
plain yes or no. For example:

> While I build the extension, I can open a build map in your browser. It shows
> what is done, what I am working on right now and where I need your decision.
> Icon and screenshot options are easy to compare and pick there, and if you
> change your mind later, I redo everything that depends on that choice. The map
> runs locally on your computer. Shall I open it? If not, we carry on here in
> the chat.

Do not run `map` before the author answers, do not say the build needs the map,
and do not repeat the offer at every step.

**If the author says yes,** run `npx @extenshi/cli@latest map` from the
extension project directory (a worktree is fine). It starts the server, records
the yes and opens the page in the browser. Share the address it prints.

**If the author says no,** run `npx @extenshi/cli@latest map decline` (it only
writes the answer to the local state file) and carry on in chat. At the first
visual choice, mention the map once more in one sentence. After a second no, run
`map decline` again and do not bring the map up again in this project. The state
file is kept either way, so if the author opens the map later, it shows the
whole history.

## While you build

**What moves a step.** Statuses are derived from what the project proves:

- files in the main checkout: the manifest and the files it names, icons,
  builds, packages, the store folder (`CHROMEWEBSTORE.md`, screenshots, promo
  tiles), tests, CI workflows. Work on an agent branch shows up once it is
  merged into the main checkout;
- the Dojo project the directory is bound to (`extenshi project bind`): owner
  decisions (`propose_decision`, then the owner decides in Dojo) and, with an
  API key, release evidence and readiness. Commands run with `--evidence`
  (`scan`, `review-risk`, `generate-listing`, `test smoke`, `screenshots`) and
  `extenshi release prepare` feed it;
- reports agents write into the state file. If `npx @extenshi/cli@latest map
  --help` lists a `step` command, report each finished task with it. If it does
  not, the facts above are what the map shows.

**Where things stand.** `npx @extenshi/cli@latest map status --json` reads the
map without starting anything: `progress`, `needsYou` (steps waiting on the
author), `running`, `next` (steps whose inputs are all done and that can run in
parallel) and every step's status with the fact behind it. Use `next` to choose
what to work on, and never tell the author a step is done while the map shows it
otherwise.

## Handing steps to the author

Some steps belong to the author: what the extension is and for whom, target
browsers and modules, the icon concept, approving listing copy and screenshots,
pricing, confirming the Chrome Web Store data declarations, creating the
feedback form and store accounts, and approving each store submission. When you
reach one:

1. Do the agent part first: prepare the options, the drafts, the preview pages.
2. Write one line in chat with a direct link to the step and what is needed,
   for example `http://127.0.0.1:<port>/#node=iconConcepts`: "Four icon concepts
   are ready, pick one." Common step ids: `idea`, `surfaces`, `browsers`,
   `features`, `iconConcepts`, `listing`, `screenshots`, `pricing`,
   `declarations`, `feedbackForm`, `cwsAccount`, `amoAccount`, `edgeAccount`,
   `cws`, `amo`, `edge`.
3. Taste decisions (icon, screenshots, listing copy) are made on the map or in
   chat. Decisions the server checks (store submission, data declarations,
   pricing and other money matters) go through Dojo: owner decisions and owner
   approvals. Give the author the Dojo link and never decide these yourself.
4. Without the map, send the preview links in chat and take the answer there.

**The feedback form** is on by default (module `feedback`): a hosted page where
people who still have the extension report a bug, a site it breaks on or an
idea. Forms are created only in Dojo, so `feedbackForm` waits on the author.
Say in one line what the form is for and link
`https://dojo.extenshi.io/tools/feedback-form`. Once it exists, the generated
config carries `FEEDBACK_FORM_URL` and `get_feedback_form` returns
`openSnippet`; wiring that into Options and the popup is `feedbackLinks`, your
step. If the author does not want a form, switch the module off on the map.

## What leaves the machine

- The map server listens only on `127.0.0.1` and reads the project's files
  locally; nothing from them is uploaded.
- With a project bound through `extenshi project bind` and an API key, the
  server reads that project's decisions and release readiness from the Extenshi
  API (`bff.extenshi.io`) once a minute while it runs. `map status --no-live`
  skips that read.
- `npx` downloads the CLI from the npm registry. The CLI's optional usage
  reports are described in the plugin README.

## What this skill must not do

- Start the map before the author says yes, or offer it more than twice.
- Start a second map, copy the state file, or edit it by hand.
- Stop the map unless the author asks.
- Decide an owner decision or approve a submission for the author.
- Report a step as done that the map does not show as done.
