# Permissions & Risk

What do browser extensions actually ask for — and how risky do they score? This
report covers two things extenshi.io is built to measure: the **sensitive
permissions** extensions request, and the **automated risk rating** of the
extensions we've scanned.

> **Snapshot:** 2026-10-01 · Permissions over 392,811 extensions · Risk over 321,327 scanned extensions

## Sensitive permissions requested

Share of extensions whose latest version requests each permission. The benign,
ubiquitous ones (`storage`, `activeTab`, `alarms`) are intentionally excluded —
these are the ones that meaningfully widen access to you or your browsing.

| Permission | What it grants | Extensions | Share |
|---|---|---:|---:|
| `tabs` | Read your tabs | 109,889 | 28.0% |
| `<all_urls>` | Access all sites | 26,340 | 6.7% |
| `downloads` | Manage downloads | 23,576 | 6.0% |
| `cookies` | Read/write cookies | 19,768 | 5.0% |
| `webRequest` | Intercept web requests | 19,608 | 5.0% |
| `webNavigation` | Track navigation | 14,780 | 3.8% |
| `declarativeNetRequest` | Modify network requests | 12,301 | 3.1% |
| `webRequestBlocking` | Block web requests | 7,208 | 1.8% |
| `bookmarks` | Read/write bookmarks | 6,472 | 1.6% |
| `nativeMessaging` | Talk to native apps | 4,799 | 1.2% |
| `clipboardRead` | Read clipboard | 4,723 | 1.2% |
| `history` | Read browsing history | 3,566 | 0.9% |
| `debugger` | Attach the debugger | 3,273 | 0.8% |
| `proxy` | Control proxy settings | 3,082 | 0.8% |
| `management` | Manage other extensions | 2,575 | 0.7% |
| `geolocation` | Access location | 1,355 | 0.3% |
| `privacy` | Change privacy settings | 993 | 0.3% |

Raw data: [`data/sensitive-permissions.csv`](./data/sensitive-permissions.csv)

## Risk distribution

extenshi.io runs automated security scans and assigns each scanned extension a
risk tier. Across **321,327** extensions scanned so far:

| Risk tier | Extensions | Share |
|---|---:|---:|
| Critical | 1,493 | 0.5% |
| High | 1,326 | 0.4% |
| Medium | 23,649 | 7.4% |
| Low | 148,615 | 46.3% |
| None | 146,244 | 45.5% |

**2,819** extensions (0.9%) scored **High or Critical**.

Raw data: [`data/risk-distribution.csv`](./data/risk-distribution.csv)

## How to read this

A permission isn't a verdict — `tabs` or `<all_urls>` are load-bearing for
plenty of legitimate tools. The risk tier is the automated judgement that
weighs permissions *together with* code-level signals from the scan. See the
methodology and disclaimer at
<https://catalog.extenshi.io/disclaimers/security-risk>.

## Methodology

Permission counts use each extension's latest visible snapshot
(`permissionsRequired`). Risk uses each extension's latest **completed** scan,
so the denominator is "extensions scanned", not the whole catalog — scan
coverage grows over time. Source: public store listings + extenshi.io scans.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribution to
**extenshi.io** (<https://extenshi.io>).
