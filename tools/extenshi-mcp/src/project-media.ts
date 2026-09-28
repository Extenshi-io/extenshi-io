/**
 * Client-side half of `upload_project_media`: turn a tool call into the BFF's
 * `{ mime, dataBase64 }` payload.
 *
 * The BFF is the real gate (magic bytes, metadata stripping, dimension and
 * quota limits). What only the client can decide is WHICH local file may be
 * read at all. The stdio server runs with the developer's filesystem, so a
 * `filePath` is confined to the workspace (the server's working directory):
 * a prompt-injected "upload ~/Pictures/passport.jpg" must not be able to
 * publish an arbitrary personal image to a public bucket. Files elsewhere go
 * through the CLI (`extenshi media upload`), where the path is on the command
 * line in front of the developer.
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export type ProjectMediaMime = 'image/png' | 'image/jpeg' | 'image/webp'

export const PROJECT_MEDIA_MAX_BYTES = 2 * 1024 * 1024
export const PROJECT_MEDIA_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export class ProjectMediaInputError extends Error {}

/** Same signatures the BFF accepts. Anything else (SVG, HTML, GIF) → null. */
export function sniffMediaMime(bytes: Uint8Array): ProjectMediaMime | null {
	const b = bytes
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
	if (
		b.length >= 12 &&
		String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
		String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
	)
		return 'image/webp'
	return null
}

const NOT_AN_IMAGE =
	'is not a PNG, JPEG or WebP image (checked by content). SVG is not accepted: rasterize it first ' +
	'(npx @extenshi/cli@latest icon store-assets <file.svg>) or pass an inline logo as logoSvg to publish_landing_page.'

/** Read a workspace-local image for upload. `root` is the workspace (default: cwd). */
export async function readWorkspaceImage(
	filePath: string,
	root = process.cwd(),
): Promise<{ mime: ProjectMediaMime; dataBase64: string; bytes: number }> {
	let resolved: string
	let rootReal: string
	try {
		resolved = await realpath(path.resolve(root, filePath))
		rootReal = await realpath(root)
	} catch {
		throw new ProjectMediaInputError(`File not found: ${filePath}`)
	}
	const relative = path.relative(rootReal, resolved)
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new ProjectMediaInputError(
			`"${filePath}" is outside the workspace (${rootReal}). upload_project_media only reads files inside it; ` +
				'for other files run `npx @extenshi/cli@latest media upload <file> --project <id>` or send dataBase64.',
		)
	}
	const info = await stat(resolved)
	if (!info.isFile()) throw new ProjectMediaInputError(`"${filePath}" is not a file.`)
	if (info.size > PROJECT_MEDIA_MAX_BYTES) {
		throw new ProjectMediaInputError(
			`"${filePath}" is ${(info.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB per image.`,
		)
	}
	const bytes = await readFile(resolved)
	const mime = sniffMediaMime(bytes)
	if (!mime) throw new ProjectMediaInputError(`"${filePath}" ${NOT_AN_IMAGE}`)
	return { mime, dataBase64: bytes.toString('base64'), bytes: bytes.length }
}

/** Validate an inline payload the same way before it is sent. */
export function checkInlineImage(dataBase64: string, declared: ProjectMediaMime): void {
	const bytes = Buffer.from(dataBase64.slice(0, 64), 'base64')
	const mime = sniffMediaMime(bytes)
	if (!mime) throw new ProjectMediaInputError(`dataBase64 ${NOT_AN_IMAGE}`)
	if (mime !== declared)
		throw new ProjectMediaInputError(`dataBase64 contains ${mime} but mime says ${declared}.`)
}
