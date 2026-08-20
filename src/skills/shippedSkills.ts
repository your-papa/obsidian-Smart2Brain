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

/**
 * Fingerprints of bundled-skill bodies we shipped in a PREVIOUS version and no longer have
 * on disk. Fingerprints, not verbatim bodies: every consumer only ever does an equality
 * test, and retaining old bodies as string constants would grow the bundle by the full body
 * on every revision (`bases` alone is ~21KB) with text that is never displayed.
 *
 * ## How to add an entry (do this when you change a bundled SKILL.md)
 *
 * 1. BEFORE your edit, compute the current body's fingerprint — e.g. drop
 *    `console.log(fingerprint(skill.content))` into any test in
 *    `test/skills/bootstrapDefaultSkills.test.ts` and run it, or call
 *    `fingerprint()` from `src/utils/shippedDefaults` anywhere convenient.
 * 2. Add the hex string here under the skill's name and its *current* version.
 * 3. Then make your edit and bump `metadata.version` in the SKILL.md.
 *
 * Skip step 1-2 and existing vaults will read their untouched copy as a user customization:
 * they'll get a notice asking them to reconcile by hand instead of a silent update.
 *
 * Entries are append-only — removing one has the same effect as never adding it.
 *
 * Empty today, by design: there are no released versions to preserve, so every bundled skill
 * is at the single version it currently ships (`explore-vault` was reset from 1.1 to 1.0 for
 * this reason). The map exists so the first real revision has an obvious place to go.
 */
const PRIOR_SKILL_FINGERPRINTS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
	// Example of the shape, for when the first revision lands:
	// ["explore-vault", new Map([["1.0", "a1b2c3d4e5f60718"]])],
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
