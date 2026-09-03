/**
 * Links from the plugin into the documentation site (smartsecondbrain.dev).
 *
 * User-facing docs deliberately live in the `s2b-dev/site` repo rather than in this
 * one, so anything the UI wants to explain at length is a link rather than a
 * paragraph. Those URLs are a contract with that repo: its routes have already been
 * restructured once (`/features/*` → `/search/`, `/agents/*`), which is exactly why
 * the site still carries a `redirects` block in its `astro.config.mjs` for the stale
 * links the README had scattered inline. Keeping every URL here means the next move
 * is a one-file reconciliation instead of a grep.
 *
 * Every entry must be an absolute URL with a **trailing slash** — that is the form
 * the site emits (see its `dist/sitemap-0.xml`), and the redirect table is keyed on
 * it too.
 */

export const DOCS_BASE = "https://smartsecondbrain.dev";

/**
 * Doc slug → absolute URL. Keys are named for what the *caller* is explaining, not
 * for the site's directory layout, so a route move doesn't ripple into call sites.
 */
export const DOCS = Object.freeze({
	home: `${DOCS_BASE}/`,

	// Getting started
	installation: `${DOCS_BASE}/start/installation/`,
	firstRun: `${DOCS_BASE}/start/first-run/`,
	providers: `${DOCS_BASE}/start/providers/`,

	// Features
	search: `${DOCS_BASE}/search/`,
	graph: `${DOCS_BASE}/graph/`,

	// Agents
	agents: `${DOCS_BASE}/agents/`,
	skills: `${DOCS_BASE}/agents/skills/`,
	integrations: `${DOCS_BASE}/agents/integrations/`,
	memory: `${DOCS_BASE}/agents/memory/`,
	mcp: `${DOCS_BASE}/agents/mcp/`,

	// Privacy
	privacyModel: `${DOCS_BASE}/privacy/model/`,
	trustedProviders: `${DOCS_BASE}/privacy/trusted-providers/`,

	// Help
	troubleshooting: `${DOCS_BASE}/help/troubleshooting/`,
	faq: `${DOCS_BASE}/help/faq/`,
});

export type DocKey = keyof typeof DOCS;

/**
 * Open a documentation page in the user's browser.
 *
 * For button-style callers. Anything that can be an anchor should render one instead
 * (see `DocsLink.svelte`): Obsidian hands external `_blank` anchors to the system
 * browser on both desktop and mobile, so a real link needs no platform branching.
 */
export function openDocs(doc: DocKey): void {
	window.open(DOCS[doc], "_blank", "noopener,noreferrer");
}
