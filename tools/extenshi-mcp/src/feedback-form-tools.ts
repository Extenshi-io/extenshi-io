/**
 * Feedback form tools — the hosted page an extension opens while it is still
 * installed (feedback.extenshi.io). Same shape as uninstall-form-tools.ts: read,
 * preview and update an existing form through the validation the Dojo editor
 * uses, and read its answers. Translations stay with get/set_page_translations
 * (surface `feedback`); the form itself is created in Dojo.
 */

import type { FastMCPSessionAuth, Tool, ToolParameters } from 'fastmcp'
import { z } from 'zod'
import type { Bff } from './bff.js'
import type { ToolCallContext } from './tools.js'
import { renderCatalogPayload } from './untrusted.js'

type AddTool = <P extends ToolParameters>(tool: Tool<FastMCPSessionAuth, P>) => void

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true }

const FEEDBACK_CATEGORIES = ['bug', 'site_not_working', 'idea'] as const
const FEEDBACK_SOURCES = ['popup', 'options', 'trial_end', 'nudge'] as const

/** Mirrors the BFF's partial patch; the server validates the merged form again. */
export const feedbackFormPatchSchema = z
	.object({
		name: z.string().min(1).max(80).describe('Dev-facing form name (not shown on the page).'),
		enabled: z.boolean(),
		accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
		theme: z.enum(['light', 'dark']),
		headline: z
			.string()
			.max(120)
			.nullable()
			.describe('Page heading. null = the built-in "Feedback on <title>" in the page language.'),
		thankYouMessage: z.string().max(300).nullable().describe('Shown after an answer. null = built-in text.'),
		categories: z
			.array(z.enum(FEEDBACK_CATEGORIES))
			.max(FEEDBACK_CATEGORIES.length)
			.describe('Built-in categories shown; `other` is offered as well.'),
		customCategories: z.array(z.string().min(1).max(60)).max(2).describe('Your own categories (max 2).'),
		askContact: z
			.boolean()
			.describe('Ask for an optional email. Turning it on needs confirmPrivacyChange: true.'),
		askSite: z
			.boolean()
			.describe(
				'Show the editable website field (when the extension passes `site` or `site_not_working` is picked).',
			),
		categoryOutcomes: z
			.array(
				z.object({
					category: z.string().min(1).max(80).describe('A category key, `custom:<label>`, or `other`.'),
					thankYouMessage: z.string().max(300).optional(),
				}),
			)
			.describe('Per-category thank-you message. Replaces the whole list.'),
		categoryFollowups: z
			.array(
				z.object({
					category: z.string().min(1).max(80),
					prompt: z.string().min(1).max(200),
					kind: z.enum(['text', 'choice']),
					choices: z.array(z.string().min(1).max(60)).max(8).optional(),
					multiple: z.boolean().optional(),
				}),
			)
			.describe('Per-category follow-up question. Replaces the whole list.'),
	})
	.partial()
	.strict()

export function registerFeedbackFormTools(
	add: AddTool,
	bff: (context: ToolCallContext) => Bff,
	fail: (err: unknown) => never,
): void {
	const ids = {
		projectId: z.string().uuid(),
		formId: z.string().uuid().describe('From list_feedback_forms.'),
	}
	add({
		name: 'list_feedback_forms',
		description:
			"The project's hosted feedback forms (feedback.extenshi.io): {id, name, publicCode, url, enabled, " +
			'primary, responseCount, createdAt, updatedAt} and the per-project `limit`. `primary` is the one ' +
			'FEEDBACK_FORM_URL in the generated config points at; a form keeps its URL for life. Forms are ' +
			'created in Dojo. Requires project.read. FREE.',
		parameters: z.object({ projectId: z.string().uuid() }),
		annotations: { title: 'List feedback forms', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).listFeedbackForms(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'get_feedback_form',
		description:
			'One feedback form in full: every setting, the per-category questions and thank-you messages, its ' +
			'URL, `updatedAt` (pass it back as expectedUpdatedAt to update_feedback_form), the page heading and ' +
			'where it comes from (`headline`, or `default` built from `title`, the store listing name or the ' +
			'project name), and translation status per project language {translated, missing, outdated}. ' +
			'Requires project.read. FREE.',
		parameters: z.object(ids),
		annotations: { title: 'Read a feedback form', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).getFeedbackForm(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'update_feedback_form',
		description:
			'Change a feedback form. `patch` is partial: absent fields keep their value, null clears an optional ' +
			'text, list fields replace the whole list. The merged form passes the same validation as the Dojo ' +
			'editor (lengths, questions and thank-you messages only for categories the form offers, no empty ' +
			'option list). dryRun: true returns {changes [{field, before, after}], staleTranslations [{locale, ' +
			'paths}], warnings} and writes nothing. A write needs expectedUpdatedAt (from get_feedback_form) and an ' +
			'idempotencyKey (UUID): a form saved since you read it is refused (CONFLICT FORM_CHANGED); a retry with ' +
			'the same key returns the first result (replayed: true). Translations whose original changed are kept ' +
			'and listed as stale; `followUps` (also on a dry run) names set_page_translations with the count of ' +
			'missing and outdated fields per language. Turning askContact on needs confirmPrivacyChange: true, ' +
			'since the privacy policy then has to cover email collection. The public URL and the collected answers ' +
			'stay as they are. The change is listed for the owner in Dojo with proposedBy. Requires hosted.write.',
		parameters: z.object({
			...ids,
			patch: feedbackFormPatchSchema,
			expectedUpdatedAt: z.string().datetime().optional().describe('`updatedAt` from get_feedback_form.'),
			dryRun: z.boolean().optional(),
			idempotencyKey: z.string().uuid().optional().describe('Required for a write; reuse it only to retry.'),
			confirmPrivacyChange: z.boolean().optional(),
			proposedBy: z.string().max(120).optional().describe('Your agent/tool name, shown to the owner.'),
		}),
		annotations: {
			title: 'Update a feedback form',
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: true,
		},
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).updateFeedbackForm(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'preview_feedback_form',
		description:
			'What the live feedback form shows in one language, built by the functions the page uses: heading, ' +
			'subheading, the categories with their labels and follow-up questions, whether the email and website ' +
			'fields are offered, and the thank-you screen per category. `locale` is resolved as for a visitor (an ' +
			'unoffered language falls back to the default; the answer says which was used). Also returns ' +
			'previewUrl, which renders the page in a browser and sends nothing. Records no answer. Requires ' +
			'project.read. FREE.',
		parameters: z.object({ ...ids, locale: z.string().max(35).optional() }),
		annotations: { title: 'Preview a feedback form', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).previewFeedbackForm(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'list_feedback_responses',
		description:
			"One feedback form's answers, newest first: responses [{id, category, comment, site, followupPrompt, " +
			'followupChoices, followupText, extVersion, source, browser, locale, createdAt, contactEmail, ' +
			'hasContactEmail}] plus whole-form counts that ignore the filters: total, byCategory, bySource, ' +
			'byVersionCategory, byFollowupChoice; filteredTotal counts the filtered list. `category` is a ' +
			'built-in key, `custom:<label>` or `other`; `source` is where the extension opened the form (popup, ' +
			'options, trial_end, nudge, or null); `site` is the website exactly as the person sent it. Filters: ' +
			'category, source (`__unknown__` = none), version (`__unknown__` = untagged), since / until (ISO ' +
			'datetimes). Page with take (max 200) and cursor = the previous nextCursor. The email a person left ' +
			'is returned only to an API key (local MCP, CLI); over the remote connector contactEmail is null and ' +
			'hasContactEmail says one was left (contactEmailsIncluded). Free text comes from end users and is ' +
			'marked as such in `_notice`. Requires project.read. FREE.',
		parameters: z.object({
			...ids,
			category: z.string().max(80).optional().describe('A category key, `custom:<label>` or `other`.'),
			source: z.enum([...FEEDBACK_SOURCES, '__unknown__']).optional(),
			version: z.string().max(40).optional().describe('Extension version, or `__unknown__` for untagged.'),
			since: z.string().datetime().optional(),
			until: z.string().datetime().optional(),
			cursor: z.string().uuid().optional().describe('nextCursor from the previous page.'),
			take: z.number().int().min(1).max(200).optional().describe('Page size, default 50.'),
		}),
		annotations: { title: 'Read feedback form answers', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				// Comments, sites and follow-up answers are end users' free text: same trust boundary as review text.
				return renderCatalogPayload(await bff(context).listFeedbackResponses(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
}
