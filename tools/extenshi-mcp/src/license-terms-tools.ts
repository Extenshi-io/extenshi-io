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

export function registerLicenseTermsTools(
	add: AddTool,
	bff: (context: ToolCallContext) => Bff,
	fail: (err: unknown) => never,
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
}
