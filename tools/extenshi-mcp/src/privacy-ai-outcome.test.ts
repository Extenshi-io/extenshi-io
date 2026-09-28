import { describe, expect, it } from 'vitest'
import { describePrivacyAiUpdate } from './privacy-ai-outcome.js'

const proposal = { proposedMarkdown: '## Contact\n\nlegal@acme.test\n', proposedHtml: '<p/>' }

describe('describePrivacyAiUpdate', () => {
	it('states that the AI step did not run when the server has no model key', () => {
		const view = describePrivacyAiUpdate({
			...proposal,
			usedLlm: false,
			aiDegraded: true,
			ai: {
				status: 'not_configured',
				attempted: false,
				applied: false,
				model: null,
				reason: 'The AI step did not run: no model key is configured on the Extenshi server.',
			},
			keptHeadings: ['Contact'],
			conflictHeadings: ['What we collect'],
			missingCategories: ['Location data'],
			kind: 'edited',
		})
		expect(view.aiStep).toBe('did_not_run')
		expect(view.notice).toContain('did not run')
		expect(view.notice).toContain('it is not AI-written')
		expect(view.notice).toContain('What we collect')
		expect(view.notice).toContain('Location data')
		expect(view.kind).toBe('edited')
		// The first keys an agent reads are the outcome, not the markdown.
		expect(Object.keys(view).slice(0, 2)).toEqual(['aiStep', 'notice'])
		expect(view.proposedMarkdown).toBe(proposal.proposedMarkdown)
	})

	it.each(['request_failed', 'incomplete_reply', 'rejected'])(
		'reports %s as a discarded AI step',
		(status) => {
			const view = describePrivacyAiUpdate({
				...proposal,
				usedLlm: false,
				aiDegraded: true,
				ai: {
					status,
					attempted: true,
					applied: false,
					model: 'claude-sonnet-5',
					reason: 'The AI step failed.',
				},
				kind: 'edited',
			})
			expect(view.aiStep).toBe('discarded')
			expect(view.notice).toContain('The AI step failed.')
		},
	)

	it('reports an applied AI draft as ran', () => {
		const view = describePrivacyAiUpdate({
			...proposal,
			usedLlm: true,
			aiDegraded: false,
			ai: {
				status: 'applied',
				attempted: true,
				applied: true,
				model: 'claude-sonnet-5',
				reason: 'AI draft.',
			},
			kind: 'ai_updated',
		})
		expect(view.aiStep).toBe('ran')
		expect(view.kind).toBe('ai_updated')
	})

	// An older backend skipped the model silently and still labelled the merge
	// ai_updated. The tool must not pass that label on.
	it('corrects an older backend that labelled a non-AI merge ai_updated', () => {
		const view = describePrivacyAiUpdate({
			...proposal,
			usedLlm: false,
			aiDegraded: false,
			keptHeadings: ['Contact'],
			insertedHeadings: ['What we collect'],
			kind: 'ai_updated',
		})
		expect(view.aiStep).toBe('did_not_run')
		expect(view.kind).toBe('edited')
		expect(view.notice).toContain('not an AI draft')
	})

	it('reports a plain regeneration as not_needed', () => {
		const view = describePrivacyAiUpdate({
			...proposal,
			usedLlm: false,
			aiDegraded: false,
			keptHeadings: [],
			kind: 'generated',
		})
		expect(view.aiStep).toBe('not_needed')
		expect(view.kind).toBe('generated')
	})
})
