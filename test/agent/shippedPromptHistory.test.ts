/**
 * Guards the shipped-prompt histories in `src/agent/prompts.ts` against the failure that hit
 * the bundled skills: bumping a version without retaining the body that version replaced.
 *
 * The reconcile machinery itself is covered by promptFilesReconcile.test.ts, but that suite
 * substitutes *mocked* histories to exercise the state transitions. Nothing asserted anything
 * about the real SHIPPED_BASE_PROMPTS / SHIPPED_MEMORY_PROMPTS, so a missing entry would have
 * been caught by no test at all.
 *
 * Why this matters more here than for skills: a base prompt is assembled into every agent's
 * system prompt, so an orphaned version misclassifies every install at once — each one gets a
 * "your customized version was kept" notice for a file the user never touched, and never
 * receives the new prompt.
 *
 * These are structural checks, deliberately not fingerprint literals: asserting an expected
 * hex value would just restate the implementation and would have to be edited in lockstep
 * with every legitimate change, which is precisely the manual step that fails.
 */

import { describe, expect, it } from "vitest";

import {
	BASE_SYSTEM_PROMPT,
	BASE_SYSTEM_PROMPT_VERSION,
	DEFAULT_MEMORY_PROMPT,
	DEFAULT_MEMORY_PROMPT_VERSION,
	SHIPPED_BASE_PROMPTS,
	SHIPPED_MEMORY_PROMPTS,
} from "../../src/agent/prompts";
import { type ShippedHistory, currentShippedVersion, fingerprint } from "../../src/utils/shippedDefaults";

const surfaces = [
	{
		label: "base system prompt",
		history: SHIPPED_BASE_PROMPTS,
		current: BASE_SYSTEM_PROMPT,
		version: BASE_SYSTEM_PROMPT_VERSION,
	},
	{
		label: "memory prompt",
		history: SHIPPED_MEMORY_PROMPTS,
		current: DEFAULT_MEMORY_PROMPT,
		version: DEFAULT_MEMORY_PROMPT_VERSION,
	},
] satisfies { label: string; history: ShippedHistory; current: string; version: number }[];

/**
 * Fingerprint of each prompt's text as it stands at the current version — stored as a
 * literal, on purpose.
 *
 * This is the one check that cannot be structural. Every other assertion here compares the
 * history against the constants, but the history *is built from* those constants, so editing
 * a prompt without bumping its version keeps everything self-consistent: `history.get(2)` is
 * recomputed from the edited text and still matches. That is exactly the bug that shipped in
 * `dataview`/`tasknotes` — new body, unchanged version, so the version no longer identified
 * a body and every existing install read as customized.
 *
 * For skills the equivalent check replays release tags, but a prompt's prior text is a
 * constant in this same file rather than a standalone .md, so there is nothing external to
 * diff against. Pinning the hash here is what makes an unbumped edit fail loudly.
 *
 * WHEN THIS FAILS: you changed a prompt. Either bump its *_VERSION and retain the old text as
 * a new *_V<n> constant (see the doc comments in prompts.ts), or — if the edit is genuinely
 * cosmetic and no shipped build carries the old text — update the literal below.
 */
const CURRENT_FINGERPRINTS: Record<string, string> = {
	"base system prompt": "b9ecc80dc4496cf1", // BASE_SYSTEM_PROMPT at v2
	"memory prompt": "4545e67125dc25fe", // DEFAULT_MEMORY_PROMPT at v2
};

describe.each(surfaces)("$label shipped history", ({ label, history, current, version }) => {
	it("registers the current text under the current version", () => {
		expect(history.get(version)).toBe(fingerprint(current));
	});

	it("has not changed without a version bump", () => {
		expect(fingerprint(current)).toBe(CURRENT_FINGERPRINTS[label]);
	});

	/**
	 * The load-bearing one, and the exact shape of the `edit-notes` bug: bumping the version
	 * while leaving history holding only the new entry. Every version from 1 to the current
	 * one must be present, so an untouched copy of any of them still resolves.
	 */
	it("covers every version from 1 to the current one", () => {
		const missing = Array.from({ length: version }, (_, i) => i + 1).filter((v) => !history.has(v));

		expect(
			missing,
			`no retained body for version(s) ${missing.join(", ")} — bumping the version means keeping the text it replaced`,
		).toEqual([]);
	});

	it("is ordered oldest to newest, so the current version reads as current", () => {
		// currentShippedVersion trusts insertion order rather than sorting; an out-of-order
		// entry would silently make an older version look like the live one.
		expect(currentShippedVersion(history)).toBe(version);
		expect([...history.keys()]).toEqual([...history.keys()].sort((a, b) => Number(a) - Number(b)));
	});

	/**
	 * Two versions sharing a fingerprint means one of the retained constants was never
	 * actually updated (copy-paste), so the version it claims to represent has no real body
	 * in history — the same orphaning as a missing entry, just harder to see.
	 */
	it("has a distinct body per version", () => {
		expect(new Set(history.values()).size).toBe(history.size);
	});
});
