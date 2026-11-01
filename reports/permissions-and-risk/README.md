# Permissions & Risk

What do browser extensions actually ask for — and how risky do they score? This
report covers two things extenshi.io is built to measure: the **sensitive
permissions** extensions request, and the **automated risk rating** of the
extensions we've scanned.

> **Snapshot:** 2026-11-01 · Permissions over 418,267 extensions · Risk over 421,373 scanned extensions

## Sensitive permissions requested

Share of extensions whose latest version requests each permission. The benign,
ubiquitous ones (`storage`, `activeTab`, `alarms`) are intentionally excluded —
these are the ones that meaningfully widen access to you or your browsing.

| Permission | What it grants | Extensions | Share |
|---|---|---:|---:|
| `tabs` | Read your tabs | 114,289 | 27.3% |
| `<all_urls>` | Access all sites | 26,244 | 6.3% |
| `downloads` | Manage downloads | 25,998 | 6.2% |
| `cookies` | Read/write cookies | 20,955 | 5.0% |
| `webRequest` | Intercept web requests | 20,636 | 4.9% |
| `webNavigation` | Track navigation | 15,816 | 3.8% |
| `declarativeNetRequest` | Modify network requests | 13,356 | 3.2% |
| `webRequestBlocking` | Block web requests | 7,175 | 1.7% |
| `bookmarks` | Read/write bookmarks | 6,844 | 1.6% |
| `nativeMessaging` | Talk to native apps | 5,527 | 1.3% |
| `clipboardRead` | Read clipboard | 4,965 | 1.2% |
| `debugger` | Attach the debugger | 4,091 | 1.0% |
| `history` | Read browsing history | 3,744 | 0.9% |
| `proxy` | Control proxy settings | 3,163 | 0.8% |
| `management` | Manage other extensions | 2,655 | 0.6% |
| `geolocation` | Access location | 1,445 | 0.3% |
| `privacy` | Change privacy settings | 1,105 | 0.3% |

Raw data: [`data/sensitive-permissions.csv`](./data/sensitive-permissions.csv)

## Risk distribution

extenshi.io runs automated security scans and assigns each scanned extension a
risk tier. Across **421,373** extensions scanned so far:

| Risk tier | Extensions | Share |
|---|---:|---:|
| Critical | 2,458 | 0.6% |
| High | 196 | 0.0% |
| Medium | 13,883 | 3.3% |
| Low | 165,348 | 39.2% |
| None | 239,488 | 56.8% |

**2,654** extensions (0.6%) scored **High or Critical**.

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
