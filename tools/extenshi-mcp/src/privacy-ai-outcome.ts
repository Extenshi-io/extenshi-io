/**
 * Agent-readable outcome for `update_privacy_policy_with_ai`.
 *
 * The backend always returns a proposal: an AI draft when the model ran and
 * its draft passed the category guard, otherwise a deterministic section
 * merge. This puts the difference first in the tool result (`aiStep` +
 * `notice`) so an agent cannot present a merge as an AI draft.
 *
 * Skew-safe in both directions: a backend that returns `ai` (2026-09+) is
 * described from it; an older backend that only returns `usedLlm` /
 * `aiDegraded` / `keptHeadings` is described from those, and its
 * `kind: 'ai_updated'` on a non-AI proposal is corrected to `edited`.
 */

export type AiStep = 'ran' | 'did_not_run' | 'discarded' | 'not_needed'

export interface PrivacyAiUpdateView {
	aiStep: AiStep
	notice: string
	[key: string]: unknown
}

const AI_STATUSES_NOT_RUN = new Set(['not_configured'])
const AI_STATUSES_DISCARDED = new Set(['request_failed', 'incomplete_reply', 'rejected'])

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function describePrivacyAiUpdate(result: unknown): PrivacyAiUpdateView {
	const r = asRecord(result)
	const ai = asRecord(r.ai)
	const status = typeof ai.status === 'string' ? ai.status : undefined
	const usedLlm = ai.applied === true || (status === undefined && r.usedLlm === true)
	const kept = strings(r.keptHeadings)
	const conflicts = strings(r.conflictHeadings)
	const missing = strings(r.missingCategories)

	let aiStep: AiStep
	if (usedLlm) aiStep = 'ran'
	else if (status === 'not_needed') aiStep = 'not_needed'
	else if (status && AI_STATUSES_NOT_RUN.has(status)) aiStep = 'did_not_run'
	else if (status && AI_STATUSES_DISCARDED.has(status)) aiStep = 'discarded'
	// Older backend: no `ai` field. It skipped the model silently when no key
	// was configured, so a customized policy without usedLlm did not get an AI pass.
	else if (r.aiDegraded === true || kept.length > 0) aiStep = 'did_not_run'
	else aiStep = 'not_needed'

	const reason = typeof ai.reason === 'string' && ai.reason ? ai.reason : undefined
	let reviewLine = ''
	if (conflicts.length) reviewLine += ` Sections that need a manual edit: ${conflicts.join(', ')}.`
	if (missing.length) reviewLine += ` Required data categories not mentioned: ${missing.join(', ')}.`

	let notice: string
	switch (aiStep) {
		case 'ran':
			notice = `${reason ?? 'The proposal is an AI draft.'} Nothing is live until it is published.${reviewLine}`
			break
		case 'not_needed':
			notice = `${reason ?? 'No AI step was needed; the proposal is the regenerated policy.'}${reviewLine}`
			break
		default:
			notice =
				`${reason ?? 'The AI step did not run. The proposal is the deterministic section merge, not an AI draft.'} ` +
				"proposedMarkdown keeps the author's sections and adds only sections new since the last generated " +
				`baseline; it is not AI-written.${reviewLine}`
	}

	// Never let a non-AI proposal carry the AI version label into publish.
	const kind = !usedLlm && r.kind === 'ai_updated' ? 'edited' : r.kind
	return { aiStep, notice, ...r, ...(kind === undefined ? {} : { kind }) }
}
