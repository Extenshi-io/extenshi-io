# Agent skills

Free, self-contained skills for extension development. A skill is a single
`SKILL.md` — reusable instructions that coding agents (Claude Code, and any agent
that reads project instruction files) pick up automatically when a task matches.

Nothing executes at install time: installing a skill means copying one markdown
file into your agent's skills directory. Read it first — it's a page of text.

| Skill | What your agent gains | Cost |
| --- | --- | --- |
| [`extension-icon-design`](./extension-icon-design/) | Designs an extension icon that survives 16 px in real toolbars, verifies it against contrast/canvas checks, and exports the store-ready PNG set | Free, fully local |
| [`extension-vetting`](../plugins/extenshi/skills/extension-vetting/) | Checks one extension before you install it: publisher, popularity, permissions in plain language, safety score, reviews, and alternatives | Catalog reads via the connector |
| [`installed-extensions-audit`](../plugins/extenshi/skills/installed-extensions-audit/) | Looks up the safety score of every installed extension in one batch (up to 40 ids per call) and ranks what to review first | Catalog reads via the connector |
| [`extension-market-research`](../plugins/extenshi/skills/extension-market-research/) | Sizes a niche, lists incumbents and gaps, reads what users complain about, and writes a short competitor brief | Catalog reads via the connector |
| [`extension-store-readiness`](../plugins/extenshi/skills/extension-store-readiness/) | Trims manifest permissions, predicts store rejections and slow reviews locally with `review-risk`, drafts permission justifications and listing text | Free locally; catalog reads optional |

The last four ship in the [Extenshi plugin](../plugins/extenshi/) together with
the remote connector they call (`https://mcp.extenshi.io/mcp`). Installing the
plugin from the Claude directory sets up both; to use one skill on its own,
copy its `SKILL.md` the same way as below and
[connect the MCP server](../tools/README.md#extenshimcp--the-catalog-and-your-projects-inside-your-ai-tools)
first.

## Install (Claude Code)

For **all** your projects:

```bash
mkdir -p ~/.claude/skills/extension-icon-design
curl -fsSL https://raw.githubusercontent.com/Extenshi-io/extenshi-io/main/skills/extension-icon-design/SKILL.md \
  -o ~/.claude/skills/extension-icon-design/SKILL.md
```

Or **per project** — put the same file in `.claude/skills/extension-icon-design/`
inside the repo and commit it, so everyone's agent gets it.

Then just ask: *"make an icon for my extension and show me how it looks in the
browser toolbar"*. The agent draws the SVG, renders the verification page with
[`npx @extenshi/cli@latest icon preview`](../tools/extenshi-cli/#extenshi-icon-preview-icon),
iterates with you on the warnings, and exports the store set — no API key,
nothing leaves your machine.

📄 See what the verification page looks like:
[`examples/icon-preview.html`](../examples/).

## Other agents

The file is plain markdown with YAML frontmatter (`name`, `description`); most
agent frameworks that support instruction files can consume it directly. If your
tool uses MCP instead, the [`@extenshi/mcp`](../tools/extenshi-mcp/) server ships
the same guidance through its free `generate_icon_workflow` tool — no skill file
needed.

Also on the docs site: <https://docs.extenshi.io/developers/agent-skills>.
