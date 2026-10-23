/**
 * Uninstall survey tools (plan 2026-10-18 §3).
 *
 * Until these, the survey was editable only in Dojo: an extension renamed after
 * launch kept its old name in the survey headline, the thank-you screens and
 * their translations, and an agent could not fix it. These read, preview and
 * update one survey through the same validation the Dojo editor uses; its
 * translations stay with get/set_page_translations (surface `uninstall`).
 * find_brand_mentions finds the old name across every hosted text first.
 */

import type { FastMCPSessionAuth, Tool, ToolParameters } from 'fastmcp'
import { z } from 'zod'
import type { Bff } from './bff.js'
import type { ToolCallContext } from './tools.js'

type AddTool = <P extends ToolParameters>(tool: Tool<FastMCPSessionAuth, P>) => void

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true }

const UNINSTALL_REASONS = [
	'too_buggy',
	'found_alternative',
	'not_needed',
	'privacy_concerns',
	'too_expensive',
	'confusing',
	'missing_features',
	'slows_browser',
] as const

const httpUrl = z.string().url().max(500)

/** Mirrors the BFF's partial patch; the server validates the merged form again. */
export const uninstallFormPatchSchema = z
	.object({
		name: z.string().min(1).max(80).describe('Dev-facing variant name (not shown on the page).'),
		enabled: z.boolean(),
		accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
		theme: z.enum(['light', 'dark']),
		headline: z
			.string()
			.max(120)
			.nullable()
			.describe(
				'Page heading. null = the built-in "Sorry to see you uninstall <title>" in the page language.',
			),
		thankYouMessage: z.string().max(300).nullable().describe('Shown after an answer. null = built-in text.'),
		reasons: z.array(z.enum(UNINSTALL_REASONS)).min(1).max(UNINSTALL_REASONS.length),
		customReasons: z.array(z.string().min(1).max(60)).max(2).describe('Your own reason chips (max 2).'),
		askComment: z.boolean(),
		askContact: z
			.boolean()
			.describe('Ask for an email address. Turning it on needs confirmPrivacyChange: true.'),
		winbackUrl: httpUrl.nullable().describe('Form-level win-back button link (http/https).'),
		winbackLabel: z.string().max(80).nullable(),
		reasonOutcomes: z
			.array(
				z.object({
					reason: z.string().min(1).max(80).describe('A reason key, `custom:<label>`, or `other`.'),
					thankYouMessage: z.string().max(300).optional(),
					winbackUrl: httpUrl.optional(),
					winbackLabel: z.string().max(80).optional(),
				}),
			)
			.describe('Per-reason after-submit screen. Replaces the whole list.'),
		reasonFollowups: z
			.array(
				z.object({
					reason: z.string().min(1).max(80),
					prompt: z.string().min(1).max(200),
					kind: z.enum(['text', 'choice']),
					choices: z.array(z.string().min(1).max(60)).max(8).optional(),
					multiple: z.boolean().optional(),
				}),
			)
			.describe('Per-reason follow-up question. Replaces the whole list.'),
	})
	.partial()
	.strict()

export function registerUninstallFormTools(
	add: AddTool,
	bff: (context: ToolCallContext) => Bff,
	fail: (err: unknown) => never,
): void {
	const ids = {
		projectId: z.string().uuid(),
		formId: z.string().uuid().describe('From list_uninstall_forms.'),
	}
	add({
		name: 'list_uninstall_forms',
		description:
			"The project's hosted uninstall surveys: {id, name, publicCode, url, enabled, primary, responseCount, " +
			'createdAt, updatedAt}. `primary` is the one generated setUninstallURL code points at; a survey keeps ' +
			'its URL for life. Requires project.read. FREE.',
		parameters: z.object({ projectId: z.string().uuid() }),
		annotations: { title: 'List uninstall surveys', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).listUninstallForms(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'get_uninstall_form',
		description:
			'One uninstall survey in full: every setting, the per-reason outcomes and follow-up questions, its ' +
			'URL, `updatedAt` (pass it back as expectedUpdatedAt to update_uninstall_form), the page heading and ' +
			'where it comes from (`headline`, or `default` built from `title`, which is the store listing name ' +
			'or the project name), and translation status per project language {translated, missing, outdated}. ' +
			'Requires project.read. FREE.',
		parameters: z.object(ids),
		annotations: { title: 'Read an uninstall survey', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).getUninstallForm(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'update_uninstall_form',
		description:
			'Change an uninstall survey. `patch` is partial: absent fields keep their value, null clears an ' +
			'optional text, list fields replace the whole list. The merged survey passes the same validation as ' +
			'the Dojo editor (lengths, http(s) links, outcomes and questions only for reasons the survey offers). ' +
			'dryRun: true returns {changes [{field, before, after}], staleTranslations [{locale, paths}], ' +
			'warnings} and writes nothing. A write needs expectedUpdatedAt (from get_uninstall_form) and an ' +
			'idempotencyKey (UUID): a survey saved since you read it is refused (CONFLICT FORM_CHANGED); a retry ' +
			'with the same key returns the first result (replayed: true). Translations whose original changed ' +
			'are kept and listed as stale: re-translate them with set_page_translations; `followUps` (also on a dry ' +
			'run) names that tool with the count of missing and outdated fields per language. Turning askContact on ' +
			'needs confirmPrivacyChange: true, since the privacy policy then has to cover email collection. The public ' +
			'URL and the collected responses stay as they are. The change is listed for the owner in Dojo with ' +
			'proposedBy. Requires hosted.write.',
		parameters: z.object({
			...ids,
			patch: uninstallFormPatchSchema,
			expectedUpdatedAt: z.string().datetime().optional().describe('`updatedAt` from get_uninstall_form.'),
			dryRun: z.boolean().optional(),
			idempotencyKey: z.string().uuid().optional().describe('Required for a write; reuse it only to retry.'),
			confirmPrivacyChange: z.boolean().optional(),
			proposedBy: z.string().max(120).optional().describe('Your agent/tool name, shown to the owner.'),
		}),
		annotations: {
			title: 'Update an uninstall survey',
			readOnlyHint: false,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: true,
		},
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).updateUninstallForm(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'preview_uninstall_form',
		description:
			'What the live survey shows in one language, built by the functions the page uses: heading, ' +
			'subheading, the reason chips with their labels and follow-up questions, whether a comment or email ' +
			'is asked, and the after-submit screen per reason (message and win-back button). `locale` is ' +
			'resolved as for a visitor (an unoffered language falls back to the default; the answer says which ' +
			'was used). Also returns previewUrl, which renders the page in a browser without counting an ' +
			'uninstall. Records no visit and no response. Requires project.read. FREE.',
		parameters: z.object({ ...ids, locale: z.string().max(35).optional() }),
		annotations: { title: 'Preview an uninstall survey', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).previewUninstallForm(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
	add({
		name: 'find_brand_mentions',
		description:
			"Find where a name (e.g. the extension's old name) still appears in the project's hosted text: " +
			'uninstall surveys, welcome pages, install instructions, the live homepage, the live privacy policy ' +
			'and its form, and with pay.read also the license terms and Pay offers — each with its translations. ' +
			'Case-insensitive. Each match: {surface, id, publicCode, name, path, locale, term, excerpt, fix}, ' +
			'where `fix` names the tool that changes that field. `skipped` lists surfaces this credential cannot ' +
			'read. Read-only. Requires project.read. FREE.',
		parameters: z.object({
			projectId: z.string().uuid(),
			terms: z.array(z.string().min(2).max(120)).min(1).max(5),
		}),
		annotations: { title: 'Find a name in hosted pages', ...READ_ONLY },
		execute: async (args, context) => {
			try {
				return JSON.stringify(await bff(context).findBrandMentions(args))
			} catch (err) {
				return fail(err)
			}
		},
	})
}
