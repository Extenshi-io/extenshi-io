/** Published packages deliberately carry this small contract locally; BFF validates again. */
import { z } from 'zod'

const app = z.object({ appId: z.string().uuid() }).strict()
const sku = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/)
const publicUrl = z
	.string()
	.trim()
	.max(2048)
	.url()
	.refine((value) => {
		const url = new URL(value)
		return url.protocol === 'https:' && !url.username && !url.password
	}, 'Use an HTTPS URL without credentials')
export const paySchemas = {
	listPayApps: z
		.object({
			includeArchived: z.boolean().optional(),
			cursor: z.string().uuid().optional(),
			limit: z.number().int().min(1).max(100).optional(),
		})
		.strict(),
	createPayApp: z
		.object({ name: z.string().trim().min(1).max(120), linkedProjectId: z.string().uuid().optional() })
		.strict(),
	getPayApp: app,
	getPayReadiness: app,
	getPayPaymentEvidence: app,
	linkPayApp: app.extend({ projectId: z.string().uuid() }),
	unlinkPayApp: app,
	archivePayApp: app,
	exportPayData: app.extend({
		resource: z.enum(['offers', 'payments', 'subscriptions', 'entitlements', 'customers']),
		cursor: z.string().uuid().optional(),
		limit: z.number().int().min(1).max(500).optional(),
	}),
	getPaySeller: app,
	connectPaySeller: app.extend({
		provider: z.literal('stripe').default('stripe'),
		accountKind: z.enum(['standard', 'express']).default('standard'),
	}),
	refreshPaySeller: app,
	setPaySellerProfile: app.extend({
		profile: z
			.object({
				displayName: z.string().trim().min(1).max(160),
				supportUrl: z.union([publicUrl, z.string().trim().email().max(254)]),
				termsUrl: publicUrl.nullable(),
			})
			.strict(),
	}),
	upsertPayOffer: app.extend({
		sku,
		kind: z.enum(['one_time', 'subscription', 'lifetime']),
		interval: z.enum(['month', 'year']).nullable().default(null),
		amountMinor: z.number().int().min(199).max(100_000_00),
		currency: z.enum(['usd', 'eur', 'gbp']),
		title: z.string().trim().min(1).max(80),
		description: z.string().trim().max(500).nullable().default(null),
		features: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
		sortOrder: z.number().int().min(0).max(1000).default(0),
	}),
	archivePayOffer: app.extend({ sku }),
	getPayOfferTranslations: app,
	setPayOfferTranslations: app.extend({
		locale: z.string().max(35),
		translations: z.record(z.string().max(120), z.string().max(500)),
		sources: z.record(z.string().max(120), z.string().max(500)).optional(),
	}),
	setPayEnabled: app.extend({ enabled: z.boolean() }),
	rotatePayKey: app,
} as const
export type PayMethod = keyof typeof paySchemas
export type PayBff = { [M in PayMethod]: (input: z.infer<(typeof paySchemas)[M]>) => Promise<unknown> }
export const PAY_OPERATIONS = [
	[
		'listPayApps',
		'list_pay_apps',
		'list',
		'payApp.list',
		false,
		'List your independent Pay applications. No development project required. Paginated: nextCursor is set while more results exist.',
	],
	[
		'createPayApp',
		'create_pay_app',
		'create',
		'payApp.create',
		true,
		'Create an independent Pay application; linking a development project is optional. Not idempotent: each call creates a new application, including a call repeated after a timeout.',
	],
	[
		'getPayApp',
		'get_pay_app',
		'get',
		'payApp.get',
		false,
		'Read your Pay application and optional project link.',
	],
	[
		'getPayReadiness',
		'get_pay_readiness',
		'readiness',
		'payApp.readiness',
		false,
		'Check current checkout and launch prerequisites. A passing checkout check does not prove a live external purchase or SDK publication.',
	],
	[
		'getPayPaymentEvidence',
		'get_pay_payment_evidence',
		'payment-evidence',
		'payApp.paymentEvidence',
		false,
		"Read what Extenshi's own payment ledger proves about this application's payment path, per mode: checkout completed, license issued, an installation received the signed license, restored on a second installation, refund revoked. Derived from provider-signed webhooks, not from any report; opaque IDs and timestamps only, no buyer data. Only a live-mode purchase can satisfy a release's payment requirement; test-mode purchases are listed without satisfying it.",
	],
	[
		'linkPayApp',
		'link_pay_app',
		'link',
		'payApp.link',
		true,
		'Link your Pay application to your development project. Existing purchases remain attached to the Pay application.',
	],
	[
		'unlinkPayApp',
		'unlink_pay_app',
		'unlink',
		'payApp.unlink',
		true,
		'Remove the optional development-project link without deleting Pay data.',
	],
	[
		'archivePayApp',
		'archive_pay_app',
		'archive',
		'payApp.archive',
		true,
		'Archive your application and stop new checkout. Payment records and existing entitlements are preserved.',
	],
	[
		'exportPayData',
		'export_pay_data',
		'export',
		'payApp.export',
		false,
		'Export one page of one resource (offers, payments, subscriptions, entitlements or customers). nextCursor is null on the last page. The output contains sensitive customer and payment data.',
	],
	[
		'getPaySeller',
		'get_pay_seller',
		'seller',
		'paySeller.get',
		false,
		'Read seller connection, public profile, offers, the publishable SDK key and the public entitlement verification key. Those two keys are the ones meant to be embedded in extension code; secret keys are not part of the response. Agreement signing and KYC take place in the browser.',
	],
	[
		'connectPaySeller',
		'connect_pay_seller',
		'connect',
		'paySeller.connect',
		true,
		'Start Stripe Connect onboarding and return a browser action URL. KYC and legal acceptance are completed by the author at that URL; this tool does not perform them.',
	],
	[
		'refreshPaySeller',
		'refresh_pay_seller',
		'refresh',
		'paySeller.refreshStatus',
		true,
		'Refresh current payment-provider onboarding status. This does not complete KYC or accept agreements.',
	],
	[
		'setPaySellerProfile',
		'set_pay_seller_profile',
		'profile',
		'paySeller.setPublicProfile',
		true,
		'Save the public seller profile: display name, support URL or email, and terms URL. The values are stored as provided and are publicly visible.',
	],
	[
		'upsertPayOffer',
		'upsert_pay_offer',
		'offer-upsert',
		'paySeller.upsertOffer',
		true,
		'Create or update an offer keyed by a stable SKU. Price is in minor currency units. Subscriptions keep the given billing interval; one-time and lifetime offers store no interval. Price and features are stored as provided.',
	],
	[
		'archivePayOffer',
		'archive_pay_offer',
		'offer-archive',
		'paySeller.archiveOffer',
		true,
		'Stop offering a SKU for new checkout; historical purchases are preserved.',
	],
	[
		'getPayOfferTranslations',
		'get_pay_offer_translations',
		'offer-translations',
		'paySeller.getOfferTranslations',
		false,
		"Read the translatable text of the application's active offers (title, description, features) keyed `<sku>/<field>`, with the project's languages and each language's translated, missing and outdated fields. The paywall shows an offer in the buyer's browser language when the project ships it; the SDK's own buttons and labels are already translated.",
	],
	[
		'setPayOfferTranslations',
		'set_pay_offer_translations',
		'offer-translate',
		'paySeller.setOfferTranslations',
		true,
		"Save one language of the offers' translations: `translations` maps `<sku>/<field>` keys from get_pay_offer_translations to text; `sources` (optional) carries the original each was translated from, and a save whose original has changed since is refused. An empty string removes a translation. Prices, SKUs and plans are not changed.",
	],
	[
		'setPayEnabled',
		'set_pay_enabled',
		'enable',
		'paySeller.setEnabled',
		true,
		'Enable or disable new payments for the application; requires a connected payment provider. Enabling re-reads the seller status from the provider (charges and payouts). It does not verify the public profile, agreement or offer sync: buyers can check out only when every readiness check reported by get_pay_readiness passes. Enabling is a live commerce change.',
	],
	[
		'rotatePayKey',
		'rotate_pay_key',
		'rotate-key',
		'paySeller.rotatePublishableKey',
		true,
		'Generate a new publishable SDK key. Not idempotent: each call issues another key. Prior keys remain accepted for installed extension builds; this does not revoke any secret.',
	],
] as const

/** The legacy seller API uses projectId as the payment namespace. Never substitute a linked project ID. */
export function payWireInput(method: PayMethod, input: Record<string, unknown>): Record<string, unknown> {
	if (!PAY_OPERATIONS.find(([key]) => key === method)?.[3].startsWith('paySeller.')) return input
	const { appId, ...rest } = input
	return { ...rest, projectId: appId }
}
