/**
 * Shipped-version history for the *bundled* skills, so seeding can tell an untouched old
 * default (safe to overwrite) from a body the user edited (leave alone, flag it).
 *
 * Before #401 this didn't exist: `bootstrapDefaultSkills` skipped any skill whose folder was
 * already present, and `metadata.version` was decorative. An improvement to a bundled skill
 * therefore reached new vaults only — hit concretely when `explore-vault` gained reformulation
 * guidance in #399 and existing vaults had no way to receive it.
 *
 * Only bundled skills are covered. User-created skills have no shipped version and are never
 * touched by any of this.
 */

import { BUNDLED_SKILLS } from "./defaults";
import { type ShippedHistory, currentShippedVersion, fingerprint } from "../utils/shippedDefaults";
import exploreVault10 from "./history/explore-vault-1.0.md?raw";

/**
 * Fingerprints of bundled-skill bodies we shipped in a PREVIOUS version and no longer ship
 * as the current default.
 *
 * ## How to add an entry (do this when you change a bundled SKILL.md)
 *
 * 1. BEFORE your edit, copy the current SKILL.md verbatim to
 *    `src/skills/history/<name>-<version>.md` and `?raw`-import it here.
 * 2. Add `fingerprint(<import>)` under the skill's name and its *current* version.
 * 3. Then make your edit and bump `metadata.version` in the SKILL.md.
 *
 * A retained copy is preferred over a hand-transcribed hex literal because it stays
 * provably exact (`git diff` can compare it to history), at the cost of never-displayed
 * bundle text. If the retained copies ever add up (`bases` alone is ~21KB), collapse old
 * entries to hex literals — log `fingerprint(...)` once and inline the string.
 *
 * Skip step 1-2 and existing vaults will read their untouched copy as a user customization:
 * they'll get a notice asking them to reconcile by hand instead of a silent update.
 *
 * Entries are append-only — removing one has the same effect as never adding it.
 */
const PRIOR_SKILL_FINGERPRINTS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
	// 1.0: before the "Compute, don't estimate" execute_javascript guidance was added.
	["explore-vault", new Map([["1.0", fingerprint(exploreVault10)]])],
]);

/**
 * skill name → (version → fingerprint of the body shipped at that version).
 *
 * Built at module load: each bundled skill's *current* body under its own
 * `metadata.version`, plus any retained prior bodies. Insertion order is oldest → newest, so
 * the last entry is the current version (see `currentSkillVersion`).
 */
export const SHIPPED_SKILL_HISTORY: ReadonlyMap<string, ShippedHistory> = buildHistory();

function buildHistory(): Map<string, ShippedHistory> {
	const history = new Map<string, ShippedHistory>();

	for (const skill of BUNDLED_SKILLS) {
		// A bundled skill with no `metadata.version` can't participate: there'd be no key to
		// record it under, so it keeps the old existence-only behaviour (seed if absent,
		// otherwise never touch). Validation requires the field, so this is defensive.
		if (!skill.version) continue;

		const versions = new Map<string, string>(PRIOR_SKILL_FINGERPRINTS.get(skill.name) ?? []);
		// Current last, so it's the newest entry even if a prior fingerprint was recorded late.
		versions.set(skill.version, fingerprint(skill.content));
		history.set(skill.name, versions);
	}

	return history;
}

/** The version a bundled skill currently ships at, or undefined if it isn't tracked. */
export function currentSkillVersion(skillName: string): string | undefined {
	const versions = SHIPPED_SKILL_HISTORY.get(skillName);
	if (!versions) return undefined;
	return currentShippedVersion(versions) as string | undefined;
}
