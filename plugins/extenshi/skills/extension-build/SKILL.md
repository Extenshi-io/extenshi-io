---
name: extension-build
description: >
  Load first in any session on an Extenshi extension project (a repository with
  src/extenshi.config.js or an .extenshi/ folder), before recommending next
  steps: it decides whether to offer the author the build map now. The build
  map is a local page that shows which build steps are done, which an agent is
  working on and which wait on the author. Covers offering the map once,
  opening it, keeping it current as steps finish, and handing the author the
  steps only they can do. Use when building, continuing or shipping an
  extension with the user, in any language ("build me an extension that…",
  "let's make a Chrome extension", "let's work on my extension", "continue
  with the extension", "what's next?", "what do you recommend?", "take my
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

## First rule: ask what waits on the author, in the same reply

Every time `map status` or `get_build_map` answers with a non-empty `needsYou`,
the reply you write next puts each entry to the author. This holds for a
status report, a "what's next?" answer and the end of a piece of work alike,
and it comes before any list of what you plan to do.

`needsYou` is a list of questions, not of step ids. Each entry has `question`,
`about`, `options` with their current values, `current`, `answer` (where it is
answered: `map`, `dojo` or `chat`), `link` to the step while the map runs,
`url` for a Dojo decision, `record` (how you record the answer) and `blocks`
(the steps it holds up). For each entry, say:

1. what it decides and what waits for it (`blocks`);
2. the options, with what is set now and where that comes from;
3. your recommendation and the reason, in one or two sentences;
4. where the author answers: the link to the step, or the Dojo page.

Ask one decision at a time, through your client's question tool where it has
one (buttons, `AskUserQuestion`), otherwise as a plain question that ends the
reply. Ask the one that holds up the most steps first and name the others in
one line each, so the author sees the whole queue.

Naming only the step ids ("waiting on you: browsers, features, pricing") is
not asking. Neither is deciding for the author because a default was already
set: a default is nobody's choice.

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
- A running map keeps the release it started with. When `map status`,
  `map step` or `get_build_map` says the map draws an older set of steps than
  you know, run `npx @extenshi/cli@latest map update` at a quiet moment: not
  while a review waits on the author or they are signing in on the map. The
  page reloads by itself and the progress stays. If it says your own tool is
  older than the map, switch to the latest CLI or MCP server instead. The author
  can also press **Update** on the map whenever a newer release is out.
- When you split work across subagents, only the agent talking to the author
  offers the map and links to it. Subagents never offer it or start it.

## Before offering: has this project been asked already?

Check the record first, so a new session does not ask again:

- **With the local Extenshi MCP server (`@extenshi/mcp`)**, `get_project_state`
  and `create_project` return `buildMap`: `running`, `url` while it runs,
  `offered`, `declined`, `offers` (how many times the author answered),
  `home` (the directory the map belongs to) and `next`, one sentence on what
  to do about the offer now (`buildMap` then comes first in the answer).
  While no map runs, `get_build_map` opens with `offer`, whose `next` is the
  same sentence. Pass `projectDir` when the extension is not in the server's
  working directory.
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
| Never offered | Offer it now: in your first reply on an existing project, right after the idea step on a new one (below). |

## Offering the map

Offering the map is required; using it is the author's choice. Ask once, at a
fixed moment:

- **An existing project** (the repository already has a manifest,
  `src/extenshi.config.js` or `.extenshi/`, or the author asks to continue,
  what to do next or what you recommend): in your first reply about working on
  it. When that reply also recommends next steps, the offer still comes as its
  own question at the end, not as one of them.
- **A new idea**: right after the idea step, once you understand what the
  extension does and for whom, and before the first step that needs the
  author.

Make the offer its own yes/no question that ends the reply. Do not fold it
into a list of recommendations or options, where it reads as one suggestion
among many, and do not leave it for later. Keep it short, in the author's
language, about what they get. For example:

> While I build the extension, I can open a build map in your browser. It shows
> what is done, what I am working on right now and where I need your decision.
> Icon and screenshot options are easy to compare and pick there, and if you
> change your mind later, I redo everything that depends on that choice. The map
> runs locally on your computer. Shall I open it? If not, we carry on here in
> the chat.

You run the commands below; never ask the author to run `map` themselves. Do
not run `map` before the author answers, do not say the build needs the map,
and do not repeat the offer at every step. If the author answers with another
request and no yes or no, take that as no answer yet: carry on, and ask once
more at the first visual choice.

**If the author says yes,** run `npx @extenshi/cli@latest map` from the
extension project directory (a worktree is fine). It starts the server, records
the yes and opens the page in the browser. Share the address it prints.

**The map in the conversation.** When the local MCP server lists
`show_build_map` and your client shows MCP Apps (Claude does), the author can
see the same map right in the chat. After a yes, run
`npx @extenshi/cli@latest map --no-open` (the server reads the project files;
the browser tab is optional) and call `show_build_map` whenever the author
should look. The map in the chat writes the author's answers to the same state
file as the browser map.

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
  merged into the main checkout. The scaffold's placeholder icons and icons of
  one colour do not count; a package counts while it carries the manifest's
  version and is newer than the sources. The files never settle the modules
  (`features`): the author switches and confirms them (see "Modules" below);
- the Dojo project the directory is bound to (`extenshi project bind`): owner
  decisions (`propose_decision`, then the owner decides in Dojo) and, with an
  API key, release evidence and readiness. Commands run with `--evidence`
  (`scan`, `review-risk`, `generate-listing`, `test smoke`, `screenshots`) and
  `extenshi release prepare` feed it;
- records two commands leave in `.extenshi/` where a map lives: `extenshi scan`
  (the scan and fix steps) and `extenshi ai-visibility` (the AI visibility step;
  pass `--url <homepage>` once the Homepage step is done);
- reports agents write into the state file. If `npx @extenshi/cli@latest map
  --help` lists a `step` command, report your work with it:
  `map step <step> start --agent "<your label>"` when you begin,
  `map step <step> done --agent "<label>" --file <proof>` for each finished
  task (the file is hashed into the step's evidence; a file in your worktree is
  kept at the path it has in the main checkout), `map step <step> stop`
  when you hand a step back. Each answer lists the step's `todos` (every task,
  whose it is, closed or not) and `current`, the task it is on now. On the
  local MCP server the same is `report_build_step`. A refusal names its reason in brackets: `(locked)` means
  an input of the step is not done yet, so work on that first; `(unconfirmed)`
  means the step belongs to an optional module the author has not confirmed, so
  ask them about the modules first. If there is no
  `step` command, the facts above are what the map shows.

**Where things stand.** `npx @extenshi/cli@latest map status --json` reads the
map without starting anything: `progress`, `needsYou` (the questions waiting on
the author, see the first rule), `modules` (the optional modules), `running`,
`next` (steps whose inputs are all done and that can run in parallel), `steps`
and `nodes`. A step of a module that nobody settled (neither the code nor a
Dojo decision asks for it, and the author has not confirmed the modules) is
`locked` with `waitsOn: "features"` and never appears in `next`. `steps` has the shape `get_build_map` answers
with: each step this extension needs, its `status`, the task it is on
(`current`, with `byAuthor` when that task is the author's) and `decide` when
the owner answers it in Dojo. `nodes` has every step in full, with the fact
behind a done one. Without a running map, `get_build_map` reads the project
files itself and says `facts: "files"`. Each done step has a
`basis`: `project` or `dojo` (a file or a Dojo record proves it, with `where`),
`author` (the author marked it) or `agent`; `evidence` holds each step's
history. Use `next` to choose what to work on, and never tell the author a step
is done while the map shows it otherwise. Before a store submission, name the
steps that rest only on the author's word (`basis: author`) so they can check
them once more.

**Modules.** The optional modules (`analytics`, `uninstall`, `feedback`,
`i18n`, `monetization`, `onboarding`, `promo`, `research`, `ci`) are chosen on
the `features` step. `modules.list` in `map status --json` and `get_build_map`
has each one with:

- `on` and `source`: `author` (they chose it), `code` (the code has it), `dojo`
  (a Dojo decision asks for it) or `default`. A default is not a
  recommendation and not a choice: with `unconfirmed: true` nobody decided it
  yet. Analytics is off by default;
- `steps` (what it adds to the map), `data` (what starts leaving the user's
  device) and `stores` (what changes in the privacy policy and store forms);
- `found`, when the code or Dojo has a module that is switched off: tell the
  author, and remove it from the code if they confirm.

Go through the modules with the author using the recommendation table of the
`extension-planning` skill. Record each answer the author gives with
`npx @extenshi/cli@latest map set features.<module> on|off --agent "<label>"`
(`auto` hands the module back to what the code and Dojo suggest; on the local
MCP server, `set_build_module`). The switch lands in the step's evidence
history with who and when. Record only what the author said. They then confirm
the whole set on the map, where the button names it ("Confirm: 4 modules, +9
steps"); you never confirm for them. Until they do, the steps of a module stay
locked unless the code already has the module or a Dojo decision asks for it,
so do not start building analytics, a survey or a paywall "because it was on".

**Skills for a step.** Every step an agent works on names the published skills
that hold the instructions for it: the foundation steps name
`extension-planning`, the scaffold and manifest `extension-scaffold`, the
service worker, pages and unit tests `extension-surfaces`, the icon steps
`extension-icon-design`, permissions and listing copy
`extension-store-readiness`, builds, screenshots and the browser matrix
`extension-testing`, localization `extension-localization`, niche research and
the pricing comparison `extension-market-research`, the data inventory, policy
and declarations `extension-compliance`, the scan, its fixes and CI
`extension-security-scan`, analytics and errors `extension-analytics`, the
welcome page, uninstall survey and feedback form
`extension-onboarding-feedback`, payments `extension-paywall`, packaging and
store submission `extension-release`. Only the three store account steps, which
the author does, name none.

- `skills` in `map status --json` (and in `get_build_map`) lists them for every
  step that is not done: `steps` maps a step id to skill names, `index` gives
  each skill's `teaches` line and the `url` of its `SKILL.md`.
- `map step <step> start` (`report_build_step` with `state: "start"`) answers
  with the skills of that step, so report the start first, then load them.
- Load a skill before you work on the step. When your client has it installed
  (this plugin ships every one of them), use that copy. Otherwise download the
  `SKILL.md` at its `url` and follow it; saving it into your skills directory
  (`.claude/skills/<name>/SKILL.md` in Claude Code) keeps it for later sessions.
- Subagents get the skill too: name it, or pass its `url`, in the brief of the
  subagent that takes the step.
- A step that names no skill is done from its description and the tool behind
  it. A skill never overrides what the map shows or what the author decided.

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
   ready, pick one." Where `show_build_map` draws the map in the conversation,
   call it with `step` instead of only sending the link. Then run
   `map wait iconConcepts` (it returns when the
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
   In a project bound to Dojo, `browsers` and `pricing` carry `decide` with the
   decisions page: send the author there instead of asking again. Once you
   propose a value (`propose_decision`), the step waits on the owner's answer,
   and a paid model switches the payment steps on.
5. Without the map, send the preview links in chat and take the answer there.
   Record what the author said with `map choose <step> <variant number>` or
   `map choose <step> --redo "<their words>"` (`report_build_step` with
   `choice` or `redo`). Never pick for the author.
6. Store accounts (`cwsAccount`, `amoAccount`, `edgeAccount`), creating the
   feedback form in Dojo and settling the modules (`features`) happen outside
   extenshi, and nothing in the project proves them. The author marks them on
   the map with **Mark as done** (and can undo it); never mark them yourself.
   For the modules, go through the choice with the author first and switch what
   they decide on the map with `map set features.<module> on|off` (see
   "Modules"); the author can also press the switches there. Once marked,
   `extenshi map status` lists the step as done for every agent and worktree.
7. When the author uploads to a store themselves, the store step on the map
   shows the package on disk, the values to paste and the dashboard; the author
   presses **I submitted it for review** there. Do not mark it yourself.

**The feedback form** (module `feedback`, on by default until the author
settles the modules) is a hosted page where
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

- Report a status with a non-empty `needsYou` without putting every entry to
  the author in that same reply, or list step ids in place of the questions.
- Treat a module that is on by default as chosen, or work on a step of a
  module the author has not confirmed.
- Switch a module the author did not ask for, or confirm the modules for them.
- Recommend next steps on a project whose author was never asked about the
  map without asking in the same reply.
- Hide the offer inside a list of suggestions, or ask the author to run the
  map command themselves.
- Start the map before the author says yes, or offer it more than twice.
- Show the map in the conversation to an author who declined it.
- Start a second map, copy the state file, or edit it by hand.
- Stop the map unless the author asks.
- Decide an owner decision or approve a submission for the author.
- Pick a variant for the author, or record a pick they did not make.
- Tell the author a step is done when the map does not show it as done.
