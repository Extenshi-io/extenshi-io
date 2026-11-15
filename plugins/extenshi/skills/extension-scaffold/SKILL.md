---
name: extension-scaffold
description: >
  Start a browser-extension repository and assemble its manifest.json: get the
  starter files for a new project or connect an existing codebase, write the
  Manifest V3 entries for each surface, turn match patterns into host
  permissions, add the Firefox keys, wire the rendered icons in, and prove the
  result packages. Use when the user asks "scaffold my extension", "set up the
  project", "write the manifest", "make this manifest work in Firefox", "add
  the icons to the manifest", or when a build fails because the manifest names
  a file that is not there.
---

# Extension scaffold and manifest

Produce a repository that builds, and a manifest in which every entry is needed
and every file it names exists.

On the Build Map this skill covers the steps `scaffold`, `manifest` and
`manifestIcons`. Report them with the `extension-build` skill's commands.

## Running commands

Before running any `npx @extenshi/cli@latest` command, tell the user what it
does and what leaves their machine, show the exact command, and wait for their
go-ahead. If the user prefers to run it, print the command and work from the
output they paste back.

## New project or existing code

Decide this first, because the starter files replace same-named files.

- **A new extension with a Dojo project:** `get_project_scaffold` returns the
  starter as files ready to write: `manifest.json` for one target browser, the
  background worker, the panel or content-script files the project's types need,
  placeholder icons and `src/extenshi.config.js`. Call it once per target
  browser and keep the outputs separate. Keep `src/extenshi.config.js` as
  returned: the project recognises the repository by it.
- **An existing repository:** keep its code. Bind it and record its manifest
  instead:

  ```bash
  npx @extenshi/cli@latest project bind --project <project-id> --repo owner/extension --branch main
  npx @extenshi/cli@latest project import-manifest src/manifest.json --browser chrome --dry-run
  ```

  Remove `--dry-run` after reading the diff. These commands record metadata:
  they do not change the source, install a scaffold or upload the repository.
  `get_project_state` then returns `integration.file`, the content for
  `integration.path`, and `integration.unwired`, the links not connected yet.
- **No project yet:** work locally and say that the project integration is
  pending. `create_project` makes one when the author asks for it.
- **A framework (WXT, Plasmo, a bundler):** generate the project with that
  framework's own tool, then add the integration file from `get_project_state`.
  Some frameworks generate the manifest from their config; edit the config, not
  the generated file.

Put the code in Git before substantial work, with a README that names the build
command for each browser.

## The manifest

Write it from decisions already made: the name and tagline, the surfaces, the
match patterns.

1. **Base fields:** `manifest_version: 3`, `name`, `version`, `description`.
   With localization, `name` and `description` are `__MSG_…__` keys and
   `default_locale` is set.
2. **One entry per chosen surface**, and no others: `action.default_popup`,
   `background.service_worker`, `content_scripts` with `matches`,
   `options_ui.page`, `side_panel.default_path`.
3. **Permissions:** take the minimum for the chosen surfaces from
   `list_extension_templates`. Host access comes from the match patterns. Where
   a click starts the feature, use `activeTab` and no host permission. Put what
   is needed only sometimes in `optional_permissions` or
   `optional_host_permissions`.
4. **Firefox**, when it is a target:
   - `browser_specific_settings.gecko.id`. It is permanent after the first
     upload, so in a Dojo project use the decided `amo.addonId` (or propose the
     suggested default with `propose_decision`); never invent one.
   - `browser_specific_settings.gecko.data_collection_permissions`: `required`
     is `["none"]` when nothing is collected or transmitted.
   - `background.scripts` next to `service_worker`. Firefox refuses a Manifest
     V3 package whose only background is a service worker; Chromium ignores the
     extra key.
   - `sidebar_action` in place of `side_panel`.
5. **No file the build lacks.** Every path in the manifest (background, popup,
   options and side-panel pages, content scripts, icons, the default locale)
   must exist in the build output.
6. **`web_accessible_resources`:** list files explicitly. A wildcard makes every
   matching file readable by any web page.

In a Dojo project, send the result to the project with `import_manifest`: the
default dry run returns the changes and a state hash, and a second call with
that hash applies them.

## Icons in the manifest (`manifestIcons`)

After the icon set is rendered (the `extension-icon-design` skill exports it):

- `icons`: `16`, `32`, `48` and `128`, each pointing at a PNG.
- `action.default_icon`: the same files for the toolbar button.
- Use the file names of the export; do not rename a size to another.

## Prove it

```bash
npx @extenshi/cli@latest package dist --browser chrome
```

Packaging reads the build directory, changes nothing in it and uploads nothing.
It refuses a manifest that names a missing file, a placeholder Firefox add-on ID
and a Firefox package with only a service worker, which makes it the check for
the three steps above. Then install the zip in a browser with the
`extension-testing` skill (`test smoke`).

## How to report

- What was created or connected: starter files, or binding and imported
  manifest.
- The manifest entries per surface, and the permissions with the reason for
  each.
- Firefox keys set, and which value is still an open owner decision.
- The packaging result per browser, with each refusal and its fix.

## Stay accurate

- Do not overwrite files in an existing repository with starter files.
- Do not add a permission "in case". Adding one in a later update can disable
  the extension for existing users until they accept it.
- A manifest that packages is not a manifest that passes review: the
  `extension-store-readiness` skill checks permissions against store policy.
- Keys such as the privacy policy link and the uninstall survey link arrive
  from their own steps. Leave them out until those pages exist.
