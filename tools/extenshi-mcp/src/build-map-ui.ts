/**
 * Names of the build map in a chat (MCP Apps, plan 2026-11-03-extension-build-map
 * phase 4), apart from build-map-app.ts so that tools.ts, which the hosted
 * connector also loads, can link show_build_map to the page without loading it.
 */

/** The page the host draws for show_build_map. */
export const BUILD_MAP_UI = 'ui://extenshi/build-map'

/** MCP Apps HTML resources (2026-01-26). */
export const MCP_APP_MIME = 'text/html;profile=mcp-app'

/** The extension a client advertises in `capabilities.extensions` when it shows MCP Apps. */
export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui'

/** Tools only the page calls: the host keeps them from the model. */
export const BUILD_MAP_APP_TOOLS = ['build_map_view', 'build_map_answer', 'build_map_file'] as const

/** True when the client said it shows MCP Apps HTML. */
export function clientShowsApps(capabilities: unknown): boolean {
	const extensions = (capabilities as { extensions?: Record<string, unknown> } | null | undefined)?.extensions
	const ui = extensions?.[MCP_APPS_EXTENSION] as { mimeTypes?: unknown } | undefined
	return Array.isArray(ui?.mimeTypes) && ui.mimeTypes.includes(MCP_APP_MIME)
}
