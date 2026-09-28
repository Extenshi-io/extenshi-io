/**
 * The extension-type catalog, rendered for an agent building an extension.
 *
 * Why a tool and not documentation: an agent asked to "build a Chrome extension
 * that helps fill forms" has to decide a shape before it writes a line, and the
 * decision it makes badly is permissions — either padding the manifest to look
 * capable, or missing the one key without which the chosen shape cannot work.
 * This hands it the four shapes with their REQUIRED permissions attached, so the
 * minimum is the easy path rather than the researched one.
 *
 * Free and keyless by construction: the catalog is compiled in, so this answers
 * without touching the BFF, without an API key, and without spending a credit —
 * the same reasoning as `search_docs`.
 */

import {
	EXTENSION_BACKGROUND_PATH,
	EXTENSION_TEMPLATE_CATALOG,
	extensionTemplateFiles,
	extensionTemplateRequiredPermissions,
	isExtensionTemplateId,
} from './extension-templates.js'

/** Where a developer picks the same types in the UI, so the two surfaces meet. */
export const MANIFEST_GENERATOR_URL = 'https://dojo.extenshi.io/manifest-generator'

function permissionLine(label: string, permissions: readonly string[]): string {
	return permissions.length > 0 ? `${label}: ${permissions.join(', ')}` : `${label}: none`
}

/**
 * Render one or all templates.
 *
 * Combinations are described rather than enumerated: the four types compose, so
 * listing every pair would be sixteen entries saying the same thing about union.
 */
export function renderExtensionTemplates(ids?: readonly string[]): string {
	const wanted = (ids ?? []).filter(isExtensionTemplateId)
	const shown =
		wanted.length > 0
			? EXTENSION_TEMPLATE_CATALOG.filter((t) => wanted.includes(t.id))
			: EXTENSION_TEMPLATE_CATALOG

	const lines: string[] = [
		'# Extension types',
		'',
		'Each type is a shape an extension can take. Types COMBINE — a side panel that',
		'also runs on the page is one extension with both capabilities, and the required',
		'permissions are the union. The smallest set that does the job is the easiest to',
		'approve: store reviewers treat every permission as a claim that needs a justification.',
		'',
	]

	for (const template of shown) {
		lines.push(
			`## ${template.label} (\`${template.id}\`)`,
			'',
			template.summary,
			'',
			`- ${permissionLine('Required permissions (cannot be dropped)', template.requiredPermissions)}`,
			`- ${permissionLine('Suggested, removable', template.recommendedPermissions)}`,
			`- Manifest components: ${template.requires.join(', ')}`,
			`- Files this type needs: ${template.emits.join(', ')}`,
		)
		if (template.defaultMatches && template.defaultMatches.length > 0) {
			lines.push(
				`- Default \`content_scripts.matches\`: ${template.defaultMatches.join(', ')} — normally narrowed to the exact sites the extension works on; \`<all_urls>\` triggers in-depth store review.`,
			)
		}
		lines.push('')
	}

	lines.push(
		'## Rules that hold for every type',
		'',
		`- Every extension gets a background service worker at \`${EXTENSION_BACKGROUND_PATH}\`; startup-time registrations belong there (for example the uninstall survey URL, which the browser reads at removal time when no other extension code can run).`,
		'- Chromium reads `side_panel.default_path` and needs the `sidePanel` permission; Firefox reads `sidebar_action` and has no such permission. Each browser build carries only the key its browser reads.',
		'- MV3 forbids inline script: a panel or popup with its logic in a `<script>` block renders blank. Logic ships as a separate script file.',
		'- Every path declared in the manifest has to exist in the package — a missing content script or icon makes the browser refuse the whole extension, not just that feature.',
		'',
		`The same types are selectable in the UI at ${MANIFEST_GENERATOR_URL}; a project's chosen types are part of its state (related tool: \`get_project_state\`).`,
	)

	const only = shown.length === 1 ? shown[0] : undefined
	if (only) {
		lines.push('', `Full file set for this type: ${extensionTemplateFiles([only.id]).join(', ')}.`)
		lines.push(
			`Union of required permissions: ${extensionTemplateRequiredPermissions([only.id]).join(', ') || 'none'}.`,
		)
	}

	return lines.join('\n')
}
