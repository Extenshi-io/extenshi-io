/**
 * Documentation access for the Extenshi MCP server (`search_docs` tool).
 *
 * Teaches the assistant to consult the LIVE extenshi.io documentation —
 * including the full `@extenshi/cli` command reference — so it can answer
 * "how do I…" questions and quote exact CLI commands instead of guessing.
 *
 * Source of truth is the docs site's machine-readable export (the llms.txt
 * convention), regenerated on every docs deploy:
 *   - <docsUrl>/llms.txt        a one-line index of every page
 *   - <docsUrl>/llms-full.txt   the full text of every page (one H1 per page)
 *
 * Both are PUBLIC static files — no API key, no metering — so this tool works
 * even before a developer has configured a key (handy for guiding setup). We
 * fetch lazily, cache in-process with a short TTL, and rank sections locally.
 *
 * stdout is the MCP protocol channel — this module must NEVER write to it.
 */

/** A failure the tool layer turns into an actionable `UserError`. */
export class DocsError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DocsError'
	}
}

/** One page-sized chunk of `llms-full.txt`, split on top-level headings. */
export interface DocSection {
	title: string
	body: string
}

const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 10 * 60 * 1000

// A descriptive, identifiable UA — deliberately NOT an AI-crawler signature
// (GPTBot/ClaudeBot/…), so the Cloudflare edge AI-bot block never catches this
// server-side fetch, and the operator can allowlist it by name if bot rules
// tighten. This runs on the developer's machine for their own MCP session.
const DOCS_FETCH_UA = 'extenshi-mcp (+https://docs.extenshi.io/developers/mcp)'

interface CacheEntry {
	text: string
	fetchedAt: number
}

// Keyed by absolute URL so the index and full-text entries cache independently.
const cache = new Map<string, CacheEntry>()

/** Monotonic-enough clock; isolated so tests can stay deterministic. */
function now(): number {
	return Date.now()
}

async function fetchText(url: string): Promise<string> {
	let res: Response
	try {
		res = await fetch(url, {
			headers: { accept: 'text/plain', 'user-agent': DOCS_FETCH_UA },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		throw new DocsError(`Could not reach the Extenshi docs at ${url} (${reason}).`)
	}
	if (!res.ok) {
		throw new DocsError(`Extenshi docs request failed: ${res.status} ${res.statusText} (${url}).`)
	}
	return res.text()
}

/** Fetch `url` through the in-process TTL cache. */
async function fetchCached(url: string): Promise<string> {
	const hit = cache.get(url)
	if (hit && now() - hit.fetchedAt < CACHE_TTL_MS) return hit.text
	const text = await fetchText(url)
	cache.set(url, { text, fetchedAt: now() })
	return text
}

/** Clear the cache — test seam, also usable to force a refresh. */
export function clearDocsCache(): void {
	cache.clear()
}

/**
 * Split `llms-full.txt` into per-page sections on top-level (`# `) headings.
 * Fence-aware: a `# comment` inside a ``` code block is NOT a boundary, so CLI
 * examples never get chopped in half.
 */
export function splitSections(full: string): DocSection[] {
	const sections: DocSection[] = []
	let title = ''
	let lines: string[] = []
	let inFence = false

	const flush = () => {
		if (title || lines.some((l) => l.trim())) {
			sections.push({ title, body: lines.join('\n').trim() })
		}
	}

	for (const line of full.split('\n')) {
		if (/^\s*```/.test(line)) inFence = !inFence
		const h1 = !inFence ? /^#\s+(.+)$/.exec(line) : null
		if (h1) {
			flush()
			title = h1[1].trim()
			lines = []
			continue
		}
		lines.push(line)
	}
	flush()
	return sections
}

/**
 * Tokenize a query two ways:
 *  - `words`:   alphanumeric terms for broad recall — `review-risk` → review, risk
 *  - `phrases`: distinctive tokens that keep internal separators or are long
 *               (`review-risk`, `scan_extension`, `extenshi`) — high-precision
 *               signals for command and flag names that bare words dilute.
 */
function tokenize(query: string): { words: string[]; phrases: string[] } {
	const lower = query.toLowerCase()
	const words = Array.from(new Set(lower.split(/[^a-z0-9]+/).filter((t) => t.length > 1)))
	const phrases = Array.from(
		new Set(
			lower
				.split(/\s+/)
				.map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
				.filter((t) => t.length > 1 && (/[-_.]/.test(t) || t.length >= 5)),
		),
	)
	return { words, phrases }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0
	let count = 0
	let from = 0
	for (;;) {
		const idx = haystack.indexOf(needle, from)
		if (idx === -1) return count
		count++
		from = idx + needle.length
	}
}

/**
 * Rank sections against a query. A term in the title is worth more than one in
 * the body. Pure (no I/O) so it is unit-testable with a fixture.
 */
export function rankSections(full: string, query: string, limit: number): DocSection[] {
	const { words, phrases } = tokenize(query)
	if (words.length === 0) return []

	const scored = splitSections(full)
		.map((section) => {
			const title = section.title.toLowerCase()
			const body = section.body.toLowerCase()
			let score = 0
			for (const w of words) {
				if (title.includes(w)) score += 5
				score += countOccurrences(body, w)
			}
			// Command/flag names (e.g. "review-risk") are strong, precise signals.
			for (const p of phrases) {
				if (title.includes(p)) score += 8
				score += countOccurrences(body, p) * 3
			}
			return { section, score }
		})
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)

	return scored.slice(0, Math.max(1, limit)).map((s) => s.section)
}

/**
 * One searchable passage: a `##` subsection of a docs page (or the page intro
 * before its first `##`). Returning passages instead of whole pages keeps a
 * search result proportional to the question — a page can run to 8k+ chars,
 * while the answer usually lives in one subsection.
 */
export interface DocPassage {
	page: string
	heading?: string
	url?: string
	body: string
}

const SOURCE_LINE = /^\*Source:\s*(\S+?)\*\s*$/m

/** Split `llms-full.txt` into `##`-level passages, fence-aware, carrying the page source URL. */
export function splitPassages(full: string): DocPassage[] {
	const passages: DocPassage[] = []
	const urlByTitle = new Map<string, string>()
	for (const section of splitSections(full)) {
		// The export sometimes repeats a page's H1 after its source line; the
		// repeat inherits the URL recorded for the same title.
		const url = SOURCE_LINE.exec(section.body)?.[1] ?? urlByTitle.get(section.title)
		if (url) urlByTitle.set(section.title, url)
		const body = section.body.replace(SOURCE_LINE, '').trim()
		let heading: string | undefined
		let lines: string[] = []
		let inFence = false
		const flush = () => {
			const text = lines.join('\n').trim()
			if (text || heading) passages.push({ page: section.title, heading, url, body: text })
		}
		for (const line of body.split('\n')) {
			if (/^\s*```/.test(line)) inFence = !inFence
			const h2 = !inFence ? /^##\s+(.+)$/.exec(line) : null
			if (h2) {
				flush()
				heading = h2[1].trim()
				lines = []
				continue
			}
			lines.push(line)
		}
		flush()
	}
	return passages
}

/** Passages returned from one page at most, so a single long page cannot crowd out the rest. */
const MAX_PASSAGES_PER_PAGE = 2

/** BM25 parameters: term-frequency saturation and length normalisation. */
const BM25_K1 = 1.2
const BM25_B = 0.75

function wordCounts(text: string): Map<string, number> {
	const counts = new Map<string, number>()
	for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
		if (token) counts.set(token, (counts.get(token) ?? 0) + 1)
	}
	return counts
}

/**
 * Rank passages against a query with BM25 over passage bodies, so a long
 * passage that merely repeats common words does not outrank a short one that
 * answers the question. Heading and page-title matches add a bonus; hyphenated
 * or long tokens (command and flag names) get a phrase boost. Pure (no I/O) so
 * it is unit-testable with a fixture.
 */
export function rankPassages(full: string, query: string, limit: number): DocPassage[] {
	const { words, phrases } = tokenize(query)
	if (words.length === 0) return []

	const indexed = splitPassages(full).map((passage, index) => {
		const body = passage.body.toLowerCase()
		const tf = wordCounts(body)
		let len = 0
		for (const n of tf.values()) len += n
		return {
			passage,
			index,
			body,
			heading: (passage.heading ?? '').toLowerCase(),
			headingWords: wordCounts(passage.heading ?? ''),
			pageWords: wordCounts(passage.page),
			tf,
			len,
		}
	})
	if (indexed.length === 0) return []
	const avgLen = indexed.reduce((sum, d) => sum + d.len, 0) / indexed.length || 1
	const n = indexed.length
	const idf = (df: number) => Math.log(1 + (n - df + 0.5) / (df + 0.5))
	const saturate = (tf: number, len: number) =>
		(tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * len) / avgLen))

	const wordIdf = new Map(
		words.map((w) => [w, idf(indexed.filter((d) => d.tf.has(w) || d.headingWords.has(w)).length)]),
	)
	const phraseIdf = new Map(
		phrases.map((p) => [p, idf(indexed.filter((d) => d.body.includes(p) || d.heading.includes(p)).length)]),
	)

	const scored = indexed
		.map((d) => {
			let score = 0
			for (const w of words) {
				const weight = wordIdf.get(w) ?? 0
				const tf = d.tf.get(w) ?? 0
				if (tf > 0) score += weight * saturate(tf, d.len)
				if (d.headingWords.has(w)) score += weight * 2
				if (d.pageWords.has(w)) score += weight
			}
			for (const p of phrases) {
				const weight = phraseIdf.get(p) ?? 0
				const count = countOccurrences(d.body, p)
				if (count > 0) score += weight * 1.5 * saturate(count, d.len)
				if (d.heading.includes(p)) score += weight * 3
			}
			return { passage: d.passage, score, index: d.index }
		})
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)

	const perPage = new Map<string, number>()
	const picked: DocPassage[] = []
	for (const { passage } of scored) {
		if (picked.length >= Math.max(1, limit)) break
		const seen = perPage.get(passage.page) ?? 0
		if (seen >= MAX_PASSAGES_PER_PAGE) continue
		perPage.set(passage.page, seen + 1)
		picked.push(passage)
	}
	return picked
}

/** Default and bounds for the per-result excerpt length (characters). */
export const DEFAULT_EXCERPT_CHARS = 1500
export const MIN_EXCERPT_CHARS = 200
export const MAX_EXCERPT_CHARS = 8000

/**
 * Cut a passage to `maxChars` on a line boundary. An unterminated code fence is
 * closed so the rest of the response still renders as prose.
 */
export function excerpt(body: string, maxChars: number): { text: string; truncated: boolean } {
	if (body.length <= maxChars) return { text: body, truncated: false }
	let cut = body.slice(0, maxChars)
	const lastBreak = cut.lastIndexOf('\n')
	if (lastBreak > maxChars / 2) cut = cut.slice(0, lastBreak)
	cut = cut.trimEnd()
	const fences = cut.split('\n').filter((line) => /^\s*```/.test(line)).length
	if (fences % 2 === 1) cut += '\n```'
	return { text: cut, truncated: true }
}

/** Fetch the docs index (`llms.txt`) — the page list returned when no query is given. */
export async function getDocsIndex(docsUrl: string): Promise<string> {
	return fetchCached(`${docsUrl}/llms.txt`)
}

export interface SearchDocsOptions {
	/** Max passages returned. */
	limit: number
	/** Max characters per passage excerpt. */
	maxChars?: number
}

/** Render ranked passages: page › heading, source URL, bounded excerpt. Pure. */
export function renderPassages(query: string, matches: DocPassage[], maxChars: number): string {
	if (matches.length === 0) {
		return `No documentation passage matched "${query}". The full page index is returned when the query is omitted.`
	}
	const blocks = matches.map((m) => {
		const title = [m.page || 'Untitled', m.heading].filter(Boolean).join(' › ')
		const { text, truncated } = excerpt(m.body, maxChars)
		const source = m.url ? `Source: ${m.url}\n\n` : ''
		const more = truncated ? `\n\n…(excerpt truncated${m.url ? `; full page: ${m.url}` : ''})` : ''
		return `## ${title}\n${source}${text}${more}`
	})
	return `Top ${matches.length} documentation passage(s) for "${query}":\n\n${blocks.join('\n\n---\n\n')}`
}

/**
 * Search the docs and return the top matching passages, each with its source
 * link and a bounded excerpt. Falls back to a "nothing matched" note.
 */
export async function searchDocs(
	docsUrl: string,
	query: string,
	options: SearchDocsOptions,
): Promise<string> {
	const full = await fetchCached(`${docsUrl}/llms-full.txt`)
	const maxChars = Math.min(
		MAX_EXCERPT_CHARS,
		Math.max(MIN_EXCERPT_CHARS, options.maxChars ?? DEFAULT_EXCERPT_CHARS),
	)
	return renderPassages(query, rankPassages(full, query, options.limit), maxChars)
}
