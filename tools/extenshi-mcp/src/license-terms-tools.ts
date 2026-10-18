/**
 * Read-only license terms tools (DX report 2026-10-10 §2 row 16).
 *
 * Without pay.read an agent could not see the "License terms & refunds"
 * questionnaire at all; it existed only in the Dojo card. These two tools give
 * it the questions and an unsaved draft from its own answers, under project
 * read access. They carry no saved answers (the seller's legal name, address
 * and registration live there) and no Pay state, which is what keeps them off
 * pay.read; saving and publishing stay with the owner in Dojo.
 */

import type { FastMCPSessionAuth, Tool, ToolParameters } from 'fastmcp'
import { z } from 'zod'
import type { Bff } from './bff.js'
import type { ToolCallContext } from './tools.js'

type AddTool = <P extends ToolParameters>(tool: Tool<FastMCPSessionAuth, P>) => void

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true }

const projectId = z.string().uuid().describe('Pay application id (appId) or its linked project id.')
const draftHash = z
	.string()
	.regex(/^[0-9a-f]{64}$/)
	.describe('draftHash from get_license_terms or save_license_terms_draft: the draft you reviewed.')

export function registerLicenseTermsTools(
	add: AddTool,
	bff: (context: ToolCallContext) => Bff,
	fail: (err: unknown) => never,
	opts: { oauth?: boolean } = {},
): void {
	add({
		name: 'get_license_terms_questionnaire',
		description:
			'The questions of the project\'s "License terms & refunds" questionnaire as data: field, question, ' +
			'type, choices, length and number limits, and when each answer is required before the owner can ' +
			'publish. Questions only: it returns no saved answers, seller or Pay state, so project read access ' +
			'is enough (no pay.read). Pair it with draft_license_terms. FREE.',
		parameters: z.object({ projectId: z.string().uuid() }),
		annotations: { title: 'Read the license terms questionnaire', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).getLicenseTermsQuestionnaire(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'draft_license_terms',
		description:
			'Generate the license terms & refunds text from answers supplied in the call, without saving ' +
			'anything: the markdown the owner would publish, the unanswered questions that block publishing, ' +
			'and the normalized answers. An empty extensionName takes the project name. Saved answers, the ' +
			'seller and Pay offers are not read (they need pay.read), so plan types the seller sells are not ' +
			'cross-checked here; Dojo checks them when the owner saves and publishes. FREE.',
		parameters: z.object({
			projectId: z.string().uuid(),
			answers: z
				.record(z.unknown())
				.optional()
				.describe(
					'Answers keyed by the field names get_license_terms_questionnaire lists, e.g. {"sellerCountry": "Spain", "planKinds": ["lifetime"], "refundPolicy": "window", "refundWindowDays": 14}. Omitted fields count as unanswered.',
				),
		}),
		annotations: { title: 'Draft license terms from answers', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).draftLicenseTerms(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	// Saved terms, publication and checks (plan 2026-10-18 §4). Saved answers name the seller: pay.read.
	add({
		name: 'get_license_terms',
		description:
			'The saved license terms & refunds of a Pay application: status (none, draft, published, outdated), ' +
			'the draft answers and text with its draftHash, the published version {versionNumber, url, ' +
			'versionUrl, contentHash, effectiveDate}, every version, missingRequired (unanswered fields that ' +
			'block publishing), ownerInputRequired (seller identity fields only the owner fills in Dojo) and ' +
			'problems. Requires pay.read. FREE.',
		parameters: z.object({ projectId }),
		annotations: { title: 'Read the saved license terms', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).getLicenseTerms(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'save_license_terms_draft',
		description:
			'Save answers to the license terms questionnaire as the draft (field names from ' +
			'get_license_terms_questionnaire). The seller identity answers (sellerLegalName, sellerCountry, ' +
			'sellerAddress, sellerRegistration) stay as the owner saved them: send them empty or unchanged; a ' +
			'different value is refused (OWNER_INPUT_ONLY), and empty ones are listed in ownerInputRequired. A ' +
			'draft the owner edited by hand in Dojo is refused (DRAFT_HAND_EDITED). dryRun: true returns the ' +
			'preview without saving. expectedDraftHash refuses the save when the draft changed since you read it ' +
			'(DRAFT_CHANGED); saving the same answers again is a no-op (unchanged: true). Returns {draftHash, ' +
			'preview {markdown, html}, missingRequired, ownerInputRequired, problems, publishable}. Nothing is ' +
			'published. Requires pay.write.',
		parameters: z.object({
			projectId,
			answers: z.record(z.unknown()).describe('Every answer, keyed by questionnaire field.'),
			expectedDraftHash: draftHash.optional(),
			dryRun: z.boolean().optional(),
			idempotencyKey: z.string().uuid().optional(),
		}),
		annotations: {
			title: 'Save the license terms draft',
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: true,
		},
		execute: async ({ answers, ...args }, context) => {
			try {
				return JSON.stringify(await bff(context).saveLicenseTermsDraft({ ...args, input: answers }))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'request_license_terms_publication',
		description:
			'Ask the owner to publish the draft with this draftHash. Returns {status: pending_approval, ' +
			'approvalId, approvalUrl, expiresAt}: nothing is published until the owner approves it in Dojo, ' +
			'where they see the text against the live version; get_approval returns the outcome (result ' +
			"{versionNumber, url, sellerTermsDecided}). With alsoDecideSellerTerms (default true) the owner's " +
			'approval also decides seller.terms as the published URL. Refused straight away when the draft ' +
			'changed or has open questions. Requires pay.write.',
		parameters: z.object({ projectId, draftHash, alsoDecideSellerTerms: z.boolean().optional() }),
		annotations: {
			title: 'Ask the owner to publish the license terms',
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: true,
		},
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).requestLicenseTermsPublication(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	// A direct publish exists only for a developer key the owner granted pay.legal.publish; the connector has none.
	if (!opts.oauth)
		add({
			name: 'publish_license_terms',
			description:
				'Publish the draft with this draftHash as a new version of the public license terms page, without ' +
				'an approval step. Needs an API key with the separate pay.legal.publish permission (granted at ' +
				'dojo.extenshi.io/api-keys); otherwise PAY_LEGAL_PUBLISH_REQUIRED, and ' +
				'request_license_terms_publication asks the owner instead. Returns {versionNumber, url, versionUrl, ' +
				'contentHash, sellerTerms}; seller.terms is proposed as the URL for the owner to decide. Changes ' +
				'the page buyers read before they pay. Requires pay.write and pay.legal.publish.',
			parameters: z.object({ projectId, draftHash }),
			annotations: {
				title: 'Publish the license terms',
				readOnlyHint: false,
				idempotentHint: false,
				destructiveHint: true,
				openWorldHint: true,
			},
			execute: async (args, context) => {
				try {
					return JSON.stringify(await bff(context).publishLicenseTerms(args))
				} catch (err) {
					return fail(err)
				}
			},
		})
	add({
		name: 'verify_license_terms_live',
		description:
			'Check that the published license terms are what buyers get: {ok, url, versionNumber, checks [{id, ' +
			'ok, detail}]} for published, content_hash (stored text matches its hash), page_reachable, ' +
			'page_serves_version (the public page shows this version), paywall_links (the paywall links ' +
			'"License terms" and "Refund policy" to it) and seller_terms_decision (seller.terms is decided as ' +
			'this URL). A failed check is a result, not an error. Requires project.read. FREE.',
		parameters: z.object({ projectId }),
		annotations: { title: 'Verify the live license terms', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).verifyLicenseTermsLive(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'rollback_license_terms',
		description:
			'Bring back an earlier version of the license terms: its text becomes the draft, then it is ' +
			'published as a new version (history stays). mode request (default) asks the owner exactly like ' +
			'request_license_terms_publication and returns pending_approval; mode publish publishes directly ' +
			'and needs an API key with pay.legal.publish. Returns {restored {draftHash, restoredFrom}, ' +
			'publication}. Requires pay.write.',
		parameters: z.object({
			projectId,
			versionNumber: z.number().int().positive().describe('From get_license_terms versions.'),
			mode: z.enum(opts.oauth ? ['request'] : ['request', 'publish']).optional(),
			alsoDecideSellerTerms: z.boolean().optional(),
		}),
		annotations: {
			title: 'Restore an earlier license terms version',
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: true,
		},
		execute: async ({ mode, alsoDecideSellerTerms, ...args }, context) => {
			try {
				const client = bff(context)
				// Check the direct-publish permission before the draft is replaced, so a refusal changes nothing.
				if (mode === 'publish') {
					const diagnostics = (await client.connectionDiagnostics()) as { scopes?: string[] }
					if (!diagnostics.scopes?.includes('pay.legal.publish'))
						return fail(
							new Error(
								'PAY_LEGAL_PUBLISH_REQUIRED: this key cannot publish license terms directly; nothing was changed. Use mode request, or grant pay.legal.publish at dojo.extenshi.io/api-keys.',
							),
						)
				}
				const restored = (await client.restoreLicenseTermsVersion(args)) as { draftHash: string }
				const publication =
					mode === 'publish'
						? await client.publishLicenseTerms({ projectId: args.projectId, draftHash: restored.draftHash })
						: await client.requestLicenseTermsPublication({
								projectId: args.projectId,
								draftHash: restored.draftHash,
								...(alsoDecideSellerTerms === undefined ? {} : { alsoDecideSellerTerms }),
							})
				return JSON.stringify({ restored, publication })
			} catch (err) {
				return fail(err)
			}
		},
	})
}
