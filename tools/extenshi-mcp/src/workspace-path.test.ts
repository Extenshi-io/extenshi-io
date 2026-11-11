/**
 * Tool-supplied artifact paths stay inside the workspace: a
 * prompt-injected agent must not be able to point scan/publish at an
 * arbitrary absolute path (or a symlink/`../` hop out).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assertInsideWorkspace, WorkspacePathError } from './workspace-path.js'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extenshi-ws-path-'))
const WORKSPACE = path.join(ROOT, 'workspace')
const OUTSIDE = path.join(ROOT, 'outside')
fs.mkdirSync(path.join(WORKSPACE, 'dist'), { recursive: true })
fs.mkdirSync(OUTSIDE, { recursive: true })
fs.writeFileSync(path.join(WORKSPACE, 'dist', 'ext.zip'), 'zip')
fs.writeFileSync(path.join(OUTSIDE, 'secret.zip'), 'zip')
fs.symlinkSync(path.join(OUTSIDE, 'secret.zip'), path.join(WORKSPACE, 'linked.zip'))

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }))

describe('assertInsideWorkspace', () => {
	it('resolves relative and absolute paths inside the workspace', () => {
		expect(assertInsideWorkspace('dist/ext.zip', WORKSPACE)).toBe(
			fs.realpathSync(path.join(WORKSPACE, 'dist/ext.zip')),
		)
		expect(assertInsideWorkspace(path.join(WORKSPACE, 'dist/ext.zip'), WORKSPACE)).toBe(
			fs.realpathSync(path.join(WORKSPACE, 'dist/ext.zip')),
		)
	})

	it('refuses absolute paths outside the workspace', () => {
		expect(() => assertInsideWorkspace(path.join(OUTSIDE, 'secret.zip'), WORKSPACE)).toThrow(
			WorkspacePathError,
		)
	})

	it('refuses ../ traversal and symlink hops out', () => {
		expect(() => assertInsideWorkspace('../outside/secret.zip', WORKSPACE)).toThrow(/outside the workspace/)
		expect(() => assertInsideWorkspace('linked.zip', WORKSPACE)).toThrow(/outside the workspace/)
	})

	it('reports a missing file as not found', () => {
		expect(() => assertInsideWorkspace('nope.zip', WORKSPACE)).toThrow(/File not found/)
	})
})
