# Manifest V3 Migration Tracker

Manifest V3 (MV3) is the current extension platform; Manifest V2 (MV2) is the
legacy format being retired — most visibly by Google, which has been disabling
MV2 extensions in Chrome. This report tracks how far each store's catalog has
actually moved.

Each extension is counted once, by the manifest version of its **latest visible
snapshot**.

> **Snapshot:** 2026-11-01 · **Catalog-wide MV3 adoption: 83.5%**

## The headline

- **Chrome — effectively 100% MV3.** The Chrome Web Store has finished retiring
  MV2; MV2 listings are essentially gone.
- **Firefox — still majority MV2 (61.2%).** Firefox supports both formats and
  has not force-migrated, so a large legacy MV2 long-tail persists.
- **Edge — mostly MV3 (89.6%),** following Chromium, with a smaller MV2 remainder.

## By store

| Store | Extensions | Manifest V3 | Manifest V2 | Unknown |
|---|---:|---:|---:|---:|
| Chrome Web Store | 285,418 | 285,417 (100.0%) | 0 (0.0%) | 1 |
| Firefox Add-ons | 106,481 | 40,396 (37.9%) | 65,197 (61.2%) | 888 |
| Edge Add-ons | 26,368 | 23,616 (89.6%) | 2,752 (10.4%) | 0 |

```
Chrome   ████████████████████████████████████████  MV3 100.0%
Firefox  ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░  MV3 37.9%
Edge     ████████████████████████████████████░░░░  MV3 89.6%
```

Catalog-wide: **349,429 MV3** (83.5%) · **67,949 MV2** (16.2%) · 889 unknown.

Raw data: [`data/manifest-version.csv`](./data/manifest-version.csv)

## Why it matters

If you build extensions, MV2 is a dead end on Chrome and a shrinking one
elsewhere — but Firefox's large MV2 base means cross-browser code can't assume
MV3-only APIs yet. If you use extensions, an extension still shipping MV2 on
Chrome is, by definition, no longer updated there.

## Methodology

"Unknown" = a visible snapshot whose manifest version wasn't parseable at crawl
time. Counts use each extension's latest visible snapshot, so an extension that
migrated MV2→MV3 is counted only in MV3. Source: public store listings via
extenshi.io's crawl pipeline.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribution to
**extenshi.io** (<https://extenshi.io>).
