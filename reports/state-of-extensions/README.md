# State of Browser Extensions

An open, periodically-updated snapshot of the browser-extension ecosystem,
derived from extenshi.io's continuous crawl of the public Chrome Web Store,
Firefox Add-ons, and Microsoft Edge Add-ons stores.

All figures are **aggregate and anonymized** — counts and distributions across
the public catalog, never per-user data.

> **Snapshot:** 2026-11-01 · **Catalog size:** 418,267 extensions

## Headline numbers

| Metric | Value |
|---|---:|
| Extensions tracked (Chrome + Firefox + Edge) | **418,267** |
| On the current Manifest V3 format | 349,429 (83.5%) |
| Still on legacy Manifest V2 | 67,949 (16.2%) |
| Updated in the last year | 242,352 (57.9%) |

## Store distribution

| Store | Extensions | Share |
|---|---:|---:|
| Chrome Web Store | 285,418 | 68.2% |
| Firefox Add-ons | 106,481 | 25.5% |
| Edge Add-ons | 26,368 | 6.3% |

```
Chrome   ███████████████████████████░░░░░░░░░░░░░  68.2%
Firefox  ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  25.5%
Edge     ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  6.3%
```

Raw data: [`data/store-distribution.csv`](./data/store-distribution.csv)

## More cuts

- [**Manifest V3 Migration Tracker**](../manifest-v3-migration/) — who's still on MV2.
- [**Permissions & Risk**](../permissions-and-risk/) — what extensions ask for, and how risky they score.

## Methodology

- **Source.** Public store listings, gathered by extenshi.io's crawl pipeline.
  Each extension is counted once, by its latest visible snapshot.
- **Aggregation.** Catalog-wide totals only; no per-user / install / telemetry data.
- **Cadence.** Regenerated periodically; each snapshot is dated.

## License

This report and its data are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — share/adapt with
attribution to **extenshi.io** (<https://extenshi.io>).
