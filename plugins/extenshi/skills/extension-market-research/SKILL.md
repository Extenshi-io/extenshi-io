---
name: extension-market-research
description: >
  Research a browser-extension niche with real catalog data before building or
  positioning an extension: who the incumbents are, how crowded and how fresh the
  niche is, what they charge, what permissions they ask for, and what users
  complain about. Use when the user asks to "validate my extension idea", "who
  are my competitors", "is there room for an extension that...", "analyze the
  market for X", "compare extensions in this category", or wants a competitor
  brief across Chrome, Firefox and Edge.
---

# Extension market research

Produce a short, sourced brief about a niche using the Extenshi catalog, which
spans the Chrome Web Store, Firefox Add-ons and Edge Add-ons. The goal is a
grounded decision, not a promise: catalog data shows the supply side of a market
and cannot show revenue.

## Before you start

- Ask for the idea in one sentence, the target browsers, and whether the user
  wants to build, position an existing extension, or pick between ideas.
- Each lookup costs read credits (`search_extensions`, `get_extension`,
  `get_reviews`, `market_overview`: 1 each). Check `get_credit_balance` first and
  size the research to fit: one search per store, about five detail lookups.

## Workflow

1. **Size the niche.** Call `market_overview` with `query` set to the niche (and
   `stores` if browsers are fixed). Read total matches, store split, Manifest
   V2/V3 adoption, sensitive-permission histogram, risk tiers, update recency and
   review-count buckets. Call it once with no arguments if a catalog-wide
   baseline helps ("how does this niche compare to the whole store?").
2. **Find the incumbents.** `search_extensions` with the same query,
   `sortBy: "popular"`, `limit: 10`, once per store that matters. Re-run with
   `sortBy: "rating"` and `minReviews: 50` to separate loved from merely popular.
3. **Find the gaps** with filters, each as its own search:
   - **Neglected leaders:** `updatedWithin: "stale"` or `manifestVersions: [2]`
     sorted by popularity. Popular but unmaintained extensions are the easiest
     to displace.
   - **Weak spots:** `maxRating: 3.5` with `minReviews: 100`. Many users, low
     satisfaction.
   - **Pricing room:** repeat with `pricing: ["FREE"]` and
     `pricing: ["FREEMIUM","SUBSCRIPTION"]` and compare who exists on each side.
   - **Privacy positioning:** `noTelemetry: true` or `isOpenSource: true`
     (author-declared) to see whether that angle is already taken.
4. **Study the top five to eight.** `get_extension` for each: users, ratings per
   store, pricing, categories, last update, manifest version. Build a comparison
   table.
5. **Read what users say.** `get_reviews` on the strongest competitors, at
   `limit: 30`, sorted `recent` and again by `rating`. Firefox and Edge return
   review excerpts; Chrome returns only the store aggregate and a link, so say
   when a competitor's complaints could not be read. Group repeated themes:
   missing features, ads, slowness, permission fear, price, support.
6. **Compare permission footprints.** Note which permissions the leaders request
   (from `market_overview` or `get_extension`). A leader that asks for broad
   access is a differentiation opening for a narrower extension; say so only
   when the feature set does not need that access.

## How to report

Write a one-page brief:

- **The idea and the question** in one line.
- **Market shape:** number of matching extensions per store, how many have real
  usage (reviews, users), freshness, manifest versions.
- **Incumbents table:** name, store, users, rating, pricing, last update.
- **Gaps and opportunities**, each tied to the data behind it.
- **What users ask for**, grouped, with counts where you have them.
- **Risks:** a dominant leader, a saturated niche, or a Manifest V3 or store-policy
  constraint that affects the idea.
- **Recommendation:** `build`, `build with a specific angle`, or `pick another
  niche`, with the reasoning. Give a recommendation, not a survey.
- **What this cannot tell you.**

## Stay accurate

- The catalog has no revenue, conversion or install-to-active data. Users and
  ratings are the store's public figures; weekly downloads exist only for
  Firefox (`minWeeklyDownloads` is Firefox-only). Do not estimate earnings.
- "Author-declared" filters (`noTelemetry`, `isOpenSource`, `hasPaywall`,
  `monetizationModels`) come from questionnaires and may be missing. A missing
  answer is not a "no".
- A crowded niche can still be worth entering, and an empty one may be empty for
  a reason. Present the data and the trade-off, and let the user decide.
- Use the research to differentiate. Do not advise copying a competitor's name,
  icon, copy or code.
