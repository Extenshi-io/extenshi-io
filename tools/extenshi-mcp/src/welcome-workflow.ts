/**
 * Static content for the free `generate_welcome_page_workflow` MCP tool.
 *
 * Like `generate_icon_workflow`, this path deliberately spends ZERO Extenshi
 * credits and touches no Extenshi infrastructure: the brief is a pure function
 * of its arguments, so the tool works offline and can never fail on a docs or
 * BFF outage. The output is a neutral content specification — what to
 * illustrate, how annotations are positioned, the block JSON format — that a
 * developer could read on its own.
 *
 * The brief itself lives in ./welcome-agent-brief.ts, a byte-identical copy of
 * shared-types/welcome-agent-brief.ts. That sync is what guarantees the spec an
 * agent is handed here is the same spec catalog-bff enforces on save.
 *
 * Store screenshots are NOT fetched here: that would need a catalog read (an
 * API key and a credit) and would turn a free tool into a paid one. Callers that
 * already hold them (e.g. from `get_extension`) pass the URLs in via
 * `store_screenshots`.
 */

import { buildWelcomeAgentBrief, isWelcomeGoal, type WelcomeGoal } from './welcome-agent-brief.js'

export const CONSTRUCTOR_URL = 'https://dojo.extenshi.io/tools/onboarding-page'

export interface WelcomeWorkflowArgs {
	extensionName?: string
	goal?: string
	whatItDoes?: string
	targetSite?: string
	storeScreenshots?: string[]
	existingSteps?: string[]
	accentColor?: string
}

export function renderWelcomeWorkflow(args: WelcomeWorkflowArgs): string {
	// An unrecognised goal falls back to the ~90% case rather than erroring: a
	// slightly-wrong preset still produces a usable brief, and a hard failure
	// here would strand the agent with nothing.
	const goal: WelcomeGoal = isWelcomeGoal(args.goal) ? args.goal : 'PIN_EXTENSION'

	const brief = buildWelcomeAgentBrief({
		extensionName: args.extensionName ?? '',
		goal,
		whatItDoes: args.whatItDoes,
		targetSite: args.targetSite,
		storeScreenshots: args.storeScreenshots,
		existingSteps: args.existingSteps,
		accentColor: args.accentColor,
		constructorUrl: CONSTRUCTOR_URL,
	})

	return [
		brief,
		'',
		'---',
		'',
		'## Publishing',
		'',
		'No self-hosting is required. Saving in the constructor publishes the page at',
		'`welcome.extenshi.io/{code}` — a short permanent link tied to the page, not to a catalog id —',
		'and produces a `chrome.runtime.onInstalled` snippet that opens it once on first install',
		'(not on update) and counts confirmed installs by version and browser.',
		'',
		'Authors who host the page themselves set their own URL in the constructor instead; the',
		'generated snippet then opens that page and fires a separate permission-free beacon, so the',
		'install counter keeps working either way. The block JSON above then serves as the content',
		'spec for the self-hosted page.',
	].join('\n')
}
