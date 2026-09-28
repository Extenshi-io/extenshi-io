import { describe, expect, it } from 'vitest'
import { excerpt, rankPassages, rankSections, renderPassages, splitPassages, splitSections } from './docs.js'

// A miniature `llms-full.txt` fixture: a site header plus two pages, one of
// which has a fenced code block containing a `# comment` line that must NOT be
// treated as a page boundary.
const FIXTURE = [
	'# Extenshi documentation',
	'',
	'> Intro blurb.',
	'',
	'---',
	'',
	'# CLI',
	'',
	'*Source: https://docs.extenshi.io/developers/cli*',
	'',
	'Scan a packaged extension before publishing.',
	'',
	'```bash',
	'# this hash is a shell comment, not a heading',
	'extenshi scan ./dist/app.zip --json',
	'```',
	'',
	'---',
	'',
	'# MCP server',
	'',
	'*Source: https://docs.extenshi.io/developers/mcp*',
	'',
	'Use the Model Context Protocol server inside Claude Code.',
].join('\n')

describe('splitSections', () => {
	it('splits on top-level headings, ignoring # inside code fences', () => {
		const sections = splitSections(FIXTURE)
		expect(sections.map((s) => s.title)).toEqual(['Extenshi documentation', 'CLI', 'MCP server'])
	})

	it('keeps fenced CLI examples intact within their section', () => {
		const cli = splitSections(FIXTURE).find((s) => s.title === 'CLI')
		expect(cli?.body).toContain('extenshi scan ./dist/app.zip --json')
		expect(cli?.body).toContain('# this hash is a shell comment')
	})
})

describe('rankSections', () => {
	it('ranks the most relevant page first and honors the limit', () => {
		const results = rankSections(FIXTURE, 'scan a zip with the cli', 1)
		expect(results).toHaveLength(1)
		expect(results[0].title).toBe('CLI')
	})

	it('weights a title match above body mentions', () => {
		const results = rankSections(FIXTURE, 'mcp', 5)
		expect(results[0].title).toBe('MCP server')
	})

	it('returns nothing for a query with no meaningful terms', () => {
		expect(rankSections(FIXTURE, '   ?  ', 5)).toEqual([])
	})

	it('returns nothing when no section matches', () => {
		expect(rankSections(FIXTURE, 'kubernetes helm chart', 5)).toEqual([])
	})

	it('boosts a hyphenated command name over pages that only share its bare words', () => {
		// "Store policy" mentions review/store often; only the CLI page has the
		// literal command `review-risk`. The phrase boost must win.
		const fixture = [
			'# Store policy reference',
			'Chrome may reject an extension during review; the store reviews every update.',
			'Store review can be slow. Review, review, review.',
			'',
			'# CLI',
			'Run `extenshi review-risk app.zip` to predict review-risk before you submit.',
		].join('\n')
		const results = rankSections(fixture, 'review-risk flags', 2)
		expect(results[0].title).toBe('CLI')
	})
})

describe('splitPassages', () => {
	it('splits pages into ## passages, carries the source URL and ignores ## inside fences', () => {
		const fixture = [
			'# CLI',
			'*Source: https://docs.extenshi.io/developers/cli*',
			'Intro text.',
			'## scan',
			'```bash',
			'## not a heading',
			'extenshi scan app.zip',
			'```',
			'## review-risk',
			'Predict store review.',
		].join('\n')
		const passages = splitPassages(fixture)
		expect(passages.map((p) => p.heading)).toEqual([undefined, 'scan', 'review-risk'])
		expect(passages.every((p) => p.url === 'https://docs.extenshi.io/developers/cli')).toBe(true)
		expect(passages[1].body).toContain('## not a heading')
		expect(passages[0].body).not.toContain('*Source:')
	})
})

describe('rankPassages', () => {
	const fixture = [
		'# Store policy reference',
		'## Chrome',
		'Store review can be slow. Review, review, review. '.repeat(30),
		'# CLI',
		'*Source: https://docs.extenshi.io/developers/cli*',
		'## review-risk',
		'Run `extenshi review-risk app.zip` to predict review-risk.',
		'## scan',
		'Scan a zip.',
	].join('\n')

	it('prefers the short passage that names the command over a long repetitive one', () => {
		const results = rankPassages(fixture, 'review-risk flags', 3)
		expect(results[0].heading).toBe('review-risk')
	})

	it('caps passages per page and honours the limit', () => {
		expect(rankPassages(fixture, 'review scan zip', 1)).toHaveLength(1)
		const pages = rankPassages(fixture, 'review scan zip', 10).map((p) => p.page)
		expect(pages.filter((p) => p === 'CLI').length).toBeLessThanOrEqual(2)
	})

	it('returns nothing for a query with no meaningful terms', () => {
		expect(rankPassages(fixture, ' ? ', 5)).toEqual([])
	})
})

describe('excerpt / renderPassages', () => {
	it('cuts on a line boundary and closes an open code fence', () => {
		const body = ['line one', '```bash', 'a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50), '```'].join('\n')
		const { text, truncated } = excerpt(body, 120)
		expect(truncated).toBe(true)
		expect(text.length).toBeLessThanOrEqual(124)
		expect(text.endsWith('```')).toBe(true)
	})

	it('states a no-match result factually', () => {
		const out = renderPassages('kubernetes', [], 1500)
		expect(out).toContain('No documentation passage matched "kubernetes"')
		expect(out).not.toMatch(/\bcall\b/i)
	})
})
