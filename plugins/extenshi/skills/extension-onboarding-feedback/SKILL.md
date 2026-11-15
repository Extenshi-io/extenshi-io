---
name: extension-onboarding-feedback
description: >
  Set up the pages around a browser extension's install and uninstall: a
  welcome page opened once after install, a pin-to-toolbar guide, a hosted
  uninstall survey with the uninstall URL wired in, and a feedback form opened
  from the popup and the options page, including "Doesn't work on this site?".
  Use when the user asks "add a welcome page", "show users how to pin my
  extension", "why do people uninstall my extension", "add an uninstall
  survey", "add a feedback link", "let users report a broken site", or "ask
  happy users for a review".
---

# Extension onboarding and feedback

Four moments decide whether a user stays and whether the author hears why not:
the first minute after install, the moment something does not work on a site,
the moment a user is pleased, and the uninstall. Each gets one page and one
link in the extension.

On the Build Map this skill covers the steps `onboarding`, `survey`,
`uninstallHook`, `feedbackForm` and `feedbackLinks`. Report them with the
`extension-build` skill's commands.

## Where the links come from

In a Dojo project, the address of every hosted page is in the integration
config: `get_project_state` returns `integration.file`, the content for
`integration.path`, and `integration.unwired`, the links not connected yet. Use
those values. Never type a link from memory or build one from a guess: a page
that does not exist yet has no link, and the fix is to create the page.

The uninstall survey and the feedback form are created by the author in Dojo
(https://dojo.extenshi.io/tools/uninstall-feedback and
https://dojo.extenshi.io/tools/feedback-form). An agent reads, previews and
changes an existing one.

## Welcome page (`onboarding`)

1. **Pick the one action** the page drives: pin the extension, keep a new-tab
   change, or use it on a site. `generate_welcome_page_workflow` (free, static)
   returns the brief for that goal: which illustrations to make, how to crop
   them, where the numbered markers go, and the block format.
2. **Write the copy.** One headline that says what to do next, the steps, and
   nothing about features the user has not asked for yet.
3. **Pin guide.** For a page bundled inside the extension,
   `generate_pin_guide`, or

   ```bash
   npx @extenshi/cli@latest pin-guide --name "<extension name>"
   ```

   writes the illustrated steps for Chrome, Edge and Firefox: SVGs with the
   extension's icon, an HTML fragment that passes the extension CSP, and
   captions in 11 languages through `chrome.i18n`. It runs locally.
4. **Open it once.** In the background, on `runtime.onInstalled` with the reason
   `install` only (not `update`), open the page with `chrome.tabs.create`. A
   bundled page is opened with `chrome.runtime.getURL(...)`.
5. **Check it** by loading the build in a clean browser profile: the page opens
   once, and not again after a reload or an update.

## Uninstall survey (`survey`)

1. If `integration.unwired` lists the survey link, there is no survey yet. Ask
   the author to create one in Dojo; hosting is free.
2. Read it with `get_uninstall_form` and note its `updatedAt`.
3. **Fit the reasons to the niche.** Use what users of similar extensions
   complain about (the `extension-market-research` skill collects it): it does
   not work on a site, it slows pages down, it asks for too many permissions,
   a missing feature, the price. Keep the list short, with a free-text option.
4. Try the change with `update_uninstall_form` and `dryRun: true`; the answer
   lists every field that changes and the translations to redo. Apply it with
   `expectedUpdatedAt` and an `idempotencyKey`.
5. Look at the result with `preview_uninstall_form` in each language. A preview
   records nothing as an uninstall.

Turning on the email field needs an explicit `confirmPrivacyChange`, because the
privacy policy then has to say that the survey collects email addresses.

## Uninstall URL (`uninstallHook`)

```js
if (config.UNINSTALL_FORM_URL) {
	chrome.runtime.setUninstallURL(
		config.UNINSTALL_FORM_URL +
			"?v=" + chrome.runtime.getManifest().version +
			"&hl=" + chrome.i18n.getUILanguage(),
	)
}
```

- `config` is the project's integration config. A background file from the
  Extenshi starter already has this block: look for it before adding a second
  one.
- Call it at the top level of the background file, so it runs on every start
  and `v` always names the version the user left.
- `v` attributes each answer to a release; `hl` opens the survey in the
  browser's language when the project offers it.
- **Check the address, not the uninstall.** Log the string in a development
  build and open it in a tab: the survey loads with the version filled in.
  Removing the extension to test it records a real uninstall in the author's
  numbers, so leave that one check to the author.

## Feedback form (`feedbackForm`)

1. If `integration.unwired` lists `FEEDBACK_FORM_URL`, there is no form. Offer
   one to the author; they create it in Dojo.
2. Read it with `get_feedback_form`.
3. Set the categories and follow-up questions with `update_feedback_form`: a
   bug, a site it does not work on, an idea, something else. Ask per category
   what the author needs in order to act (for a broken site: what happened).
4. Check it with `preview_feedback_form`.

## Feedback links (`feedbackLinks`)

- `get_feedback_form` returns `openSnippet`, a helper that opens the form with
  the version, the place it was opened from (`popup`, `options`, `trial_end`,
  `nudge`) and the browser's language. Use it as returned.
- **Options page and popup:** a plain "Send feedback" link that calls the helper
  with its source.
- **"Doesn't work on this site?"** in the popup: preselect the category and
  pass the hostname of the active tab, never the full address:

  ```js
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  openFeedbackForm("popup", { cat: "site_not_working", site: new URL(tab.url).hostname })
  ```

  The helper puts the site in the URL fragment, which a browser does not send
  to a server. The person sees it in a field they can edit or clear, and it is
  transmitted only when they press Send. `activeTab` is enough to read the
  active tab after a click on the toolbar button.
- **A happy user:** `REVIEW_URLS` in the config holds the review page of each
  published store listing. Open that when it exists, and fall back to the
  feedback form until the listing is live.
- **Check that an answer arrives:** send one test answer from the built
  extension, then read it with `list_feedback_responses` and confirm the
  version, source and category. Tell the author which answer was the test.

## Reading answers later

`list_uninstall_responses` and `list_feedback_responses` return the answers
newest first, with counts by reason or category and by version. A cluster of
uninstalls on one version points at that release.

## How to report

- Each page: its address as returned by the project, and what it asks or shows.
- The code added per link, with the file.
- What was checked by opening or sending, and what is left to the author.
- Pages that do not exist yet, each as a request to the author.

## Stay accurate

- Do not open the welcome page on update, and do not open more than one tab at
  install.
- Do not send a page's full URL, title or content to a form. The hostname, in
  the fragment, is the limit.
- An email field or any new question that collects personal data changes the
  privacy policy. Raise it with the author before turning it on.
- Do not prompt for a review after a failure or on every open. One prompt, after
  the user has got value, with a way to decline.
