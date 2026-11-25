I'm building a browser extension with Extenshi in this repository (it has
`src/extenshi.config.js` and an `.extenshi/` folder). The build map is already
running; I accepted it last week.

Where do we stand, and what's next?

For reference, this is what `npx @extenshi/cli@latest map status --json` prints
right now (shortened to the fields that matter):

```json
{
  "server": { "running": true, "url": "http://127.0.0.1:4173/" },
  "offer": { "count": 1, "acceptedAt": "2026-11-18T09:12:00.000Z" },
  "project": { "name": "Tab Tidy", "version": "0.1.0" },
  "progress": { "done": 9, "active": 41, "percent": 22 },
  "needsYou": [
    {
      "id": "features",
      "label": "Modules",
      "question": "Which optional modules does the extension need? Now on: 5 modules, adding 6 steps.",
      "about": "Optional modules: analytics, uninstall survey, feedback form, localization, monetization, welcome page, promo tiles, niche research, CI evidence.",
      "options": [
        { "value": "features.analytics", "label": "Analytics", "on": false, "source": "default", "unconfirmed": true, "steps": ["analytics", "errors"], "data": "After the user consents in the extension: a weekly compatibility heartbeat, redacted errors and, with a second opt-in, usage events go to your own PostHog project.", "stores": "The privacy policy has to name the collection, the Chrome Web Store data-use form declares it, Firefox needs data_collection_permissions in the manifest, and the extension needs a consent toggle." },
        { "value": "features.uninstall", "label": "Uninstall survey", "on": true, "source": "default", "unconfirmed": true, "steps": ["survey", "uninstallHook"], "data": "Nothing from the extension. After removal the browser opens a survey page hosted by Extenshi; what the person types there is stored.", "stores": "No permission and no store form changes. The privacy policy mentions the survey and what its answers are used for." },
        { "value": "features.feedback", "label": "Feedback form", "on": true, "source": "default", "unconfirmed": true, "steps": ["feedbackForm", "feedbackLinks"], "data": "Nothing from the extension.", "stores": "No store form changes. The privacy policy mentions the form." },
        { "value": "features.onboarding", "label": "Welcome page", "on": true, "source": "default", "unconfirmed": true, "steps": ["onboarding"], "data": "Nothing from the extension.", "stores": "No store form changes." },
        { "value": "features.promo", "label": "Promo tiles", "on": true, "source": "default", "unconfirmed": true, "steps": ["promo"], "data": "Nothing leaves the device.", "stores": "Promo images for the Chrome Web Store listing." },
        { "value": "features.research", "label": "Niche research", "on": true, "source": "default", "unconfirmed": true, "steps": ["research"], "data": "Nothing from the extension. The agent reads the Extenshi catalog, which spends catalog reads.", "stores": "Nothing changes; the result feeds the listing texts." }
      ],
      "current": "Uninstall survey, Feedback form, Welcome page, Promo tiles, Niche research",
      "answer": "map",
      "record": "Record each answer with `extenshi map set features.<module> on|off` (MCP: set_build_module); the author then confirms the set on the map.",
      "link": "http://127.0.0.1:4173/#node=features",
      "blocks": ["research", "promo", "onboarding", "survey", "uninstallHook", "feedbackForm", "feedbackLinks"]
    }
  ],
  "modules": { "summary": { "on": 5, "steps": 6, "unconfirmed": 9, "confirmed": false } },
  "running": [],
  "next": ["perms", "iconConcepts", "unit"]
}
```
