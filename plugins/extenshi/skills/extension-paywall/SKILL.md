---
name: extension-paywall
description: >
  Add a paywall to a browser extension with @extenshi/pay: gate a feature,
  sell it on the developer's own Stripe account, verify the licence offline.
  Use when the user asks to monetize an extension, add premium features, a
  paywall, in-extension purchases or a subscription ("add a paywall to my
  extension", "make this feature paid", "монетизируй расширение", "добавь
  платную версию", "charge for the pro version", "add Stripe to my extension").
---

# Extension paywall

Turn a feature of a browser extension into a paid one with `@extenshi/pay`.
The paywall is compiled into the extension bundle (no iframe, no remote code,
store approval is not guaranteed), the checkout is a hosted Stripe page in a new
tab, and the licence is an Ed25519-signed entitlement the SDK caches and
verifies offline. The developer is the seller on their own Stripe account;
extenshi keeps the ledger and takes 2% per charge. There is no backend to write.

## What you need from the developer

Use the application's **publishable key** (`pk_ext_` + 32 hex characters) and
its **entitlement public key** from [Payments](https://dojo.extenshi.io/payments).
Create an independent Pay application: no development project is required. Both
keys are public and safe to bundle. The verification key enables offline restarts.

The SDK is published on npm as `@extenshi/pay`. Check the installed version's API
before using examples from newer repository code. Connected sellers also require
a live agreement and completed provider onboarding before checkout can be enabled.

With authorized `pay.read` / `pay.write` access, use `create_pay_app`,
`get_pay_readiness`, `connect_pay_seller`, `set_pay_seller_profile` and
`upsert_pay_offer`. Use the author's approved identity, prices and terms. Return
onboarding and agreement URLs for the author to complete in their browser.
To change an existing offer's text, send `upsert_pay_offer` with `appId`, `sku`
and only the new `title` or `description`: omitted fields keep their stored
values, so the price, features and paywall order stay as they are.
A development project can be linked later using `link_pay_app`; Pay data survives
unlinking or project deletion. Existing API keys need explicit Pay grants in dojo.

- If the project was scaffolded through extenshi, look for
  `PAY_PUBLISHABLE_KEY` in `extenshi.config.js` first.
- If there is no key yet, build everything in **mock mode** (below) and leave
  a clear `TODO` where the key goes. Do not invent a key and do not ask for
  any Stripe secret — the extension never holds one.

## Steps

1. **Install** — `npm install @extenshi/pay`.
   `@extenshi/pay/lite` has gating and checkout but no paywall UI.
2. **Decide the feature names.** Each offer in dojo unlocks a list of feature
   names (for example `pdf-export`, `sync`). Use the same strings in code.
3. **Gate the feature** where the paid path starts:

   ```ts
   import ExtenshiPay from '@extenshi/pay'

   const pay = new ExtenshiPay({
     publishableKey: 'pk_ext_…',
     entitlementPublicKey: '<Ed25519 public key from Payments>',
   })
   await pay.initialize()

   const ok = await pay.requireFeature('pdf-export', {
   	onUnlock: () => enablePdfExport(),
   })
   ```

   `requireFeature()` shows the paywall when the installation has no matching
   entitlement and resolves `true` once a checkout completes, `false` when the
   user dismisses it. For your own upgrade screen use `isPaid()`,
   `hasFeature()`, `openCheckout(sku)` and `onEntitlementChange()` instead.
4. **Show the paywall deliberately** when the UI calls for it:
   `pay.showPaywall({ mode: 'modal' | 'inline' | 'sidebar' | 'fullscreen' | 'minimal', sku, container, theme })`.
   Prices come from the offer and are formatted in the user's locale; do not
   hardcode a price string in the extension. An offer's `features` are
   entitlement keys (`requireFeature('pdf-export')` checks them) and are never
   translated, so do not translate them; pass localized bullet points from the
   extension's `_locales` as `showPaywall({ features: [...] })`.
5. **Test without Stripe** in mock mode — no network, no account:

   ```ts
   const pay = new ExtenshiPay({
     publishableKey: 'pk_ext_' + '0'.repeat(32),
   	mock: true,
   	mockData: {
   		offers: [{ sku: 'pro', kind: 'one_time', interval: null, amountMinor: 499, currency: 'usd', title: 'Pro', description: null, features: ['pdf-export'] }],
   		entitlements: [],
   		checkoutEnabled: true,
   		claimAfterPolls: 2,
   	},
   })
   ```

   Write the unit tests against mock mode; switch `mock` off and put the real
   key in for the build the developer ships.
6. **Update the store privacy disclosure.** Payment calls send the publishable
   key, random installation id, sku and locale; checkout claims send a session
   id. Optional recovery sends a recovery session id, claim challenge and claim
   secret (POST body). Billing profile selection sends an opaque customer id. Email and verification codes are entered on the hosted
   recovery page. Disclose installation/license verification and optional hosted
   recovery when enabled; the SDK does not collect extension settings.

## Where it runs

The SDK targets the extension runtime: `chrome.storage.local` for the
installation id and the cached entitlement, `chrome.tabs.create` for the
checkout tab. Call it from the extension's own pages (popup, options, side
panel) or the service worker. Outside an extension page it falls back to
`localStorage` and `window.open`, which is fine for a demo page and not for
production.

## Do not

- Do not fetch the paywall, a template or a script from a URL at runtime. The
  bundled paywall is what keeps the extension inside the store's remote-code
  rule.
- Do not put a Stripe secret key, a webhook secret or any server credential in
  the extension. Only public application and entitlement verification keys belong in the extension.
- Do not treat the cached entitlement as a second source of truth. It is a
  signed projection of the payment ledger; the server recomputes it. Paid access
  requires a verified signature bound to the application key. Offline use is
  limited to 48 hours from signed issuance; never bypass failed verification.
- Do not write "unlimited", "best" or price guarantees into paywall copy.
  Feature lists and prices belong in the offer in dojo.

## Reference

- Guide and API: https://docs.extenshi.io/developers/pay-sdk
- Landing with the fee and the seller terms: https://catalog.extenshi.io/monetization
