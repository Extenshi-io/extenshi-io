/**
 * Workspace confinement for tool-supplied file paths.
 *
 * MCP tool arguments are model-controlled, and the "data, not
 * instructions" boundary breaks the moment a prompt-injected agent can
 * name an arbitrary absolute path: scan_extension would upload any
 * .zip/.crx on the disk, publish_extension would ship any build it can
 * point at, under the user's own credentials. project-media.ts already
 * confines its reads to the workspace for exactly this reason; this is
 * the same gate for artifact paths.
 *
 * The check runs on realpaths, so `../` segments and symlink hops out of
 * the workspace are refused, not just literal absolute paths.
 */

import fs from 'node:fs'
import path from 'node:path'

export class WorkspacePathError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'WorkspacePathError'
	}
}

/**
 * Resolve `filePath` against `root` (default: cwd) and require the real
 * path to stay inside it. Returns the resolved real path.
 */
export function assertInsideWorkspace(filePath: string, root: string = process.cwd()): string {
	let resolved: string
	let rootReal: string
	try {
		resolved = fs.realpathSync(path.resolve(root, filePath))
		rootReal = fs.realpathSync(root)
	} catch {
		throw new WorkspacePathError(`File not found: ${filePath}`)
	}
	const relative = path.relative(rootReal, resolved)
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new WorkspacePathError(
			`"${filePath}" is outside the workspace (${rootReal}). ` +
				'Artifact paths are confined to the workspace so a tool call cannot read or publish arbitrary files; ' +
				'copy the artifact into the workspace first.',
		)
	}
	return resolved
}
