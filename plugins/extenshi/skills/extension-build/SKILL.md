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
  --help` lists a `step` command, report your work with it:
  `map step <step> start --agent "<your label>"` when you begin,
  `map step <step> done --agent "<label>" --file <proof>` for each finished
  task (the file is hashed into the step's evidence), `map step <step> stop`
  when you hand a step back. On the local MCP server the same is
  `report_build_step`. A refusal names its reason in brackets: `(locked)` means
  an input of the step is not done yet, so work on that first. If there is no
  `step` command, the facts above are what the map shows.

**Where things stand.** `npx @extenshi/cli@latest map status --json` reads the
map without starting anything: `progress`, `needsYou` (steps waiting on the
author), `running`, `next` (steps whose inputs are all done and that can run in
parallel) and every step's status with the fact behind it. Each done step has a
`basis`: `project` or `dojo` (a file or a Dojo record proves it, with `where`),
`author` (the author marked it) or `agent`; `evidence` holds each step's
history. Use `next` to choose what to work on, and never tell the author a step
is done while the map shows it otherwise. Before a store submission, name the
steps that rest only on the author's word (`basis: author`) so they can check
them once more.

**Steps the author did themselves or skipped.** On the map the author can give
their own result where the tool behind a step is Extenshi's (a privacy policy,
uninstall survey or feedback form link; permission reasons; the stores to ship
to), or skip a step. In `map status --json`:

- `wire` lists the links the author gave that belong in the integration config,
  as `{ node, key, value }`. Write each one into `src/extenshi.config.js` under
  its key (create the file if the project has none), then the map finds it in
  the files. Change nothing else on the author's behalf.
- A skipped step has `route: "skip"`; a step that only uses its result has
  `skippedBy`. Both are inactive: do not work on them.
- `byHand` lists skipped steps a store asks for. When the author uploads to a
  store themselves, go through it with them: each is done in the store
  dashboard instead.

**Steps that spend credits** (`scan`, `selfCheck`, `fix`, `research`,
`iconConcepts`, `listing`). `account` in `map status --json` says whether the
author is signed in and what is left per pool (`scan`, `read`, `icon`). Every
account gets free credits once.

- Not signed in, or a command says there is no API key: do not ask the author
  to paste a key. Link the step, for example
  `http://127.0.0.1:<port>/#node=scan`: "Sign in on the map for the free
  scans." The map runs the browser sign-in and saves the key where every
  extenshi command finds it.
- Run scans from the project directory. `extenshi scan` then leaves
  `.extenshi/scan.json`, and the map counts the scan while that package is
  unchanged; rebuild, and the scan step opens again.
- Out of credits: say so in one line with `account.billingUrl`. The author can
  also mark the step done themselves (that opens once the free credits of its
  pool are spent) or skip it. Never mark it for them.

## Handing steps to the author

Some steps belong to the author: what the extension is and for whom, target
browsers and modules, the icon concept, approving listing copy and screenshots,
pricing, confirming the Chrome Web Store data declarations, creating the
feedback form and store accounts, and approving each store submission. When you
reach one:

1. Do the agent part first: prepare the options, the drafts, the preview pages.
   For icons, `npx @extenshi/cli@latest icon preview <concept.svg> --no-open
   --output <file>.html` makes a preview page per concept. Keep preview files
   inside the project (any git worktree of it works).
2. Taste decisions (`iconConcepts`, `screenshots`, `listing`) are made on the
   map. If `map --help` lists `review`, offer the variants with it:
   `map review iconConcepts --variant "Ruler=concepts/ruler.html" --image
   "Ruler=concepts/ruler.svg" --variant …` (1–8 variants; on the local MCP
   server, `request_build_review`). It prints the link to the step.
3. Write one line in chat with that link and what is needed, for example
   `http://127.0.0.1:<port>/#node=iconConcepts`: "Three icon concepts are
   ready, pick one." Then run `map wait iconConcepts` (it returns when the
   author picks one or asks for another round; `--timeout` caps it) or read
   `reviews` in `map status --json` (`get_build_map`). For another round, make
   new variants from the author's words and offer them with `map review` again.
   Common step ids: `idea`, `surfaces`, `browsers`, `features`,
   `iconConcepts`, `listing`, `screenshots`, `pricing`, `declarations`,
   `feedbackForm`, `cwsAccount`, `amoAccount`, `edgeAccount`, `cws`, `amo`,
   `edge`.
4. Decisions the server checks (store submission, data declarations, pricing
   and other money matters) go through Dojo: owner decisions and owner
   approvals. Give the author the Dojo link and never decide these yourself.
5. Without the map, send the preview links in chat and take the answer there.
   Record what the author said with `map choose <step> <variant number>` or
   `map choose <step> --redo "<their words>"` (`report_build_step` with
   `choice` or `redo`). Never pick for the author.
6. Store accounts (`cwsAccount`, `amoAccount`, `edgeAccount`) and creating the
   feedback form in Dojo happen outside extenshi, and nothing in the project
   shows them. The author marks them on the map with **Mark as done** (and can
   undo it); never mark them yourself. Once marked, `extenshi map status` lists
   the step as done for every agent and worktree.
7. When the author uploads to a store themselves, the store step on the map
   shows the package on disk, the values to paste and the dashboard; the author
   presses **I submitted it for review** there. Do not mark it yourself.

**The feedback form** is on by default (module `feedback`): a hosted page where
people who still have the extension report a bug, a site it breaks on or an
idea. Forms are created only in Dojo, so `feedbackForm` waits on the author.
Say in one line what the form is for and link
`https://dojo.extenshi.io/tools/feedback-form`. Once it exists, the generated
config carries `FEEDBACK_FORM_URL` and `get_feedback_form` returns
`openSnippet`; wiring that into Options and the popup is `feedbackLinks`, your
step. An author with a form of their own (Google Forms, Tally) gives its link on
the step, and you wire it as `FEEDBACK_FORM_URL`; an author who wants no form
skips the step on the map.

## What leaves the machine

- The map server listens only on `127.0.0.1` and reads the project's files
  locally; nothing from them is uploaded.
- With a project bound through `extenshi project bind` and an API key, the
  server reads that project's decisions and release readiness from the Extenshi
  API (`bff.extenshi.io`) once a minute while it runs. With an API key it also
  reads the author's credit balance there, and signing in from the map talks to
  the same host. `map status --no-live` skips both reads.
- `npx` downloads the CLI from the npm registry. The CLI's optional usage
  reports are described in the plugin README.

## What this skill must not do

- Start the map before the author says yes, or offer it more than twice.
- Start a second map, copy the state file, or edit it by hand.
- Stop the map unless the author asks.
- Decide an owner decision or approve a submission for the author.
- Pick a variant for the author, or record a pick they did not make.
- Tell the author a step is done when the map does not show it as done.
