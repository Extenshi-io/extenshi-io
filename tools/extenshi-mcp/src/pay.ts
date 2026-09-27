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
		'List your independent Pay applications. No development project required. Follow nextCursor for more results.',
	],
	[
		'createPayApp',
		'create_pay_app',
		'create',
		'payApp.create',
		true,
		'Create an independent Pay application; linking a development project is optional. Creates a new application on every call: do not retry blindly after a timeout.',
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
		'Archive your application and stop new checkout. Preserve payment records and existing entitlements.',
	],
	[
		'exportPayData',
		'export_pay_data',
		'export',
		'payApp.export',
		false,
		'Export one page of your application data. Follow nextCursor until null for a complete export. Customer/payment data is sensitive: save only to an author-controlled destination; never paste into public issues.',
	],
	[
		'getPaySeller',
		'get_pay_seller',
		'seller',
		'paySeller.get',
		false,
		'Read seller connection, public profile, offers and publishable SDK key. Agreement signing and KYC require the author in the browser.',
	],
	[
		'connectPaySeller',
		'connect_pay_seller',
		'connect',
		'paySeller.connect',
		true,
		'Start Stripe Connect onboarding and return a browser action URL. The author must complete KYC and legal acceptance; never do these on their behalf.',
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
		'Save author-confirmed public seller identity, support and terms links. Never invent legal identity or terms.',
	],
	[
		'upsertPayOffer',
		'upsert_pay_offer',
		'offer-upsert',
		'paySeller.upsertOffer',
		true,
		'Create or update an offer by stable SKU. Price is in minor currency units. Use only the author-approved price, billing interval and features.',
	],
	[
		'archivePayOffer',
		'archive_pay_offer',
		'offer-archive',
		'paySeller.archiveOffer',
		true,
		'Stop offering a SKU for new checkout; preserve historical purchases.',
	],
	[
		'setPayEnabled',
		'set_pay_enabled',
		'enable',
		'paySeller.setEnabled',
		true,
		'Explicitly enable or disable new payments. Enabling is a live commerce change: only do so with author authorization and after checking readiness. Backend prerequisites remain enforced.',
	],
	[
		'rotatePayKey',
		'rotate_pay_key',
		'rotate-key',
		'paySeller.rotatePublishableKey',
		true,
		'Generate a new publishable SDK key. Prior keys remain accepted for installed extension builds; this is not secret revocation. Never retry blindly.',
	],
] as const

/** The legacy seller API uses projectId as the payment namespace. Never substitute a linked project ID. */
export function payWireInput(method: PayMethod, input: Record<string, unknown>): Record<string, unknown> {
	if (!PAY_OPERATIONS.find(([key]) => key === method)?.[3].startsWith('paySeller.')) return input
	const { appId, ...rest } = input
	return { ...rest, projectId: appId }
}
