/**
 * The Extenshi agent skills, served over MCP.
 *
 * The skills are the ones the Claude plugin installs (plugins/extenshi/skills in
 * the monorepo), compiled into this package by scripts/generate-mcp-skills.mjs.
 * A client with no plugin reaches them here in two ways:
 *
 *   - the Skills extension of MCP (`io.modelcontextprotocol/skills`, SEP-2640):
 *     every file is a `skill://<name>/<file>` resource, `skills/list` returns the
 *     catalog with a SHA-256 digest and size per file, `skills/get` one entry;
 *   - the `get_skill` tool (tools.ts), for clients that do not implement the
 *     extension, which on 2026-11-18 is most of them.
 *
 * fastmcp has no API for either extension capabilities or custom methods, and it
 * builds a session itself, answering `initialize` before its `connect` event
 * fires. So `attachSkillsExtension` wraps the session class's `connect`: the
 * capability and the two handlers are registered on the SDK server of each
 * session before its transport is attached, which is the last moment the SDK
 * accepts a capability.
 *
 * Spec: https://modelcontextprotocol.io/seps/2640-skills-extension
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { BUNDLED_SKILLS } from './generated/skills.js'

export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills'

/** JSON-RPC "Invalid params": what `skills/get` returns for a URI that is not a skill of this server. */
const INVALID_PARAMS = -32602

export interface SkillResource {
	uri: string
	/** `sha256:` and 64 lowercase hex characters, over the UTF-8 bytes of the file. */
	digest: string
	/** Length of the file in bytes. */
	size: number
}

/** One entry of `skills/list`, and the `skill` of `skills/get`. */
export interface SkillEntry {
	/** The resource URI of the skill's SKILL.md. */
	uri: string
	frontmatter: Record<string, unknown>
	/** Every file of the skill, SKILL.md included. */
	resources: SkillResource[]
}

/** A skill file as an MCP resource. */
export interface SkillFile {
	uri: string
	/** The skill name for SKILL.md, `<skill>/<path>` for a supporting file. */
	name: string
	description?: string
	mimeType: string
	text: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
	md: 'text/markdown',
	json: 'application/json',
	yaml: 'application/yaml',
	yml: 'application/yaml',
	html: 'text/html',
	css: 'text/css',
	js: 'text/javascript',
	ts: 'text/typescript',
	py: 'text/x-python',
	sh: 'application/x-sh',
	svg: 'image/svg+xml',
}

const mimeOf = (file: string): string =>
	MIME_BY_EXTENSION[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'text/plain'

/** Each path segment is escaped; the skill name is already restricted to a-z, 0-9 and hyphens. */
const uriOf = (skill: string, file: string): string =>
	`skill://${skill}/${file.split('/').map(encodeURIComponent).join('/')}`

export const skillUri = (name: string): string => uriOf(name, 'SKILL.md')

const digestOf = (text: string): string => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`

/** Every file of every skill, in catalog order. */
export const SKILL_FILES: readonly SkillFile[] = BUNDLED_SKILLS.flatMap((skill) =>
	skill.files.map((file) => ({
		uri: uriOf(skill.name, file.path),
		name: file.path === 'SKILL.md' ? skill.name : `${skill.name}/${file.path}`,
		...(file.path === 'SKILL.md' && typeof skill.frontmatter.description === 'string'
			? { description: skill.frontmatter.description.trim() }
			: {}),
		mimeType: mimeOf(file.path),
		text: file.text,
	})),
)

/** The catalog `skills/list` returns: complete, since the set is fixed at build time. */
export const SKILL_ENTRIES: readonly SkillEntry[] = BUNDLED_SKILLS.map((skill) => ({
	uri: skillUri(skill.name),
	frontmatter: skill.frontmatter,
	resources: skill.files.map((file) => ({
		uri: uriOf(skill.name, file.path),
		digest: digestOf(file.text),
		size: Buffer.byteLength(file.text, 'utf8'),
	})),
}))

export const SKILL_NAMES: readonly string[] = BUNDLED_SKILLS.map((skill) => skill.name)

/** The name and one-line purpose of every skill, for the get_skill listing. */
export function skillSummaries(): { name: string; description: string; uri: string }[] {
	return BUNDLED_SKILLS.map((skill) => ({
		name: skill.name,
		description: String(skill.frontmatter.description ?? '')
			.replace(/\s+/g, ' ')
			.trim(),
		uri: skillUri(skill.name),
	}))
}

/** The SKILL.md of a skill, byte for byte as `skill://<name>/SKILL.md` serves it. */
export function skillText(name: string): string | undefined {
	return BUNDLED_SKILLS.find((skill) => skill.name === name)?.files[0]?.text
}

export function listSkills(): { resultType: 'complete'; skills: readonly SkillEntry[] } {
	// One page: an entry is never split, and eighteen of them need no cursor.
	return { resultType: 'complete', skills: SKILL_ENTRIES }
}

export function getSkill(uri: unknown): { resultType: 'complete'; skill: SkillEntry } {
	const skill = typeof uri === 'string' ? SKILL_ENTRIES.find((entry) => entry.uri === uri) : undefined
	if (!skill) {
		// The SDK sends an error's own integer `code`; any other throw becomes an internal error.
		throw Object.assign(new Error(`Not a skill of this server: ${String(uri)}`), { code: INVALID_PARAMS })
	}
	return { resultType: 'complete', skill }
}

// ── Wiring into fastmcp ─────────────────────────────────────────────────────

/** The part of a FastMCP server this module uses; both physical copies of fastmcp fit it. */
interface ResourceServer {
	addResource(resource: {
		uri: string
		name: string
		description?: string
		mimeType: string
		load: () => Promise<{ text: string; mimeType: string }>
	}): void
}

/** The MCP SDK server inside a fastmcp session. */
interface SdkServer {
	registerCapabilities(capabilities: Record<string, unknown>): void
	setRequestHandler(schema: unknown, handler: (request: { params?: { uri?: unknown } }) => unknown): void
}

interface SessionPrototype {
	connect(this: { server: SdkServer }, ...args: unknown[]): Promise<unknown>
}

/** The session class of the fastmcp copy the server was built from (`FastMCPSession`). */
export interface SessionClass {
	prototype: object
}

const ATTACHED = Symbol.for('extenshi.mcp.skills-extension')

/** Registers every skill file as a `skill://` resource. Call before `server.start()`. */
export function addSkillResources(server: ResourceServer): void {
	for (const file of SKILL_FILES) {
		server.addResource({
			uri: file.uri,
			name: file.name,
			...(file.description ? { description: file.description } : {}),
			mimeType: file.mimeType,
			load: async () => ({ text: file.text, mimeType: file.mimeType }),
		})
	}
}

// The SDK reads the method name off the schema and validates the request with it.
const listRequest = z.object({
	method: z.literal('skills/list'),
	params: z.object({ cursor: z.string().optional() }).passthrough().optional(),
})
const getRequest = z.object({
	method: z.literal('skills/get'),
	params: z.object({ uri: z.unknown().optional() }).passthrough().optional(),
})

/** Makes every session of `sessionClass` declare the Skills extension and answer `skills/list` and `skills/get`. */
export function attachSkillsExtension(sessionClass: SessionClass): void {
	const prototype = sessionClass.prototype as SessionPrototype & { [ATTACHED]?: true }
	if (prototype[ATTACHED]) return
	const connect = prototype.connect
	prototype.connect = function (...args) {
		// No directoryRead: resources/directory/read is not served, and every file is in the listing.
		this.server.registerCapabilities({ extensions: { [SKILLS_EXTENSION]: {} } })
		this.server.setRequestHandler(listRequest, () => listSkills())
		this.server.setRequestHandler(getRequest, (request) => getSkill(request.params?.uri))
		return connect.apply(this, args)
	}
	prototype[ATTACHED] = true
}

/** Both halves at once: the `skill://` resources and the extension. Call before `server.start()`. */
export function registerSkills(server: ResourceServer, sessionClass: SessionClass): void {
	addSkillResources(server)
	attachSkillsExtension(sessionClass)
}
