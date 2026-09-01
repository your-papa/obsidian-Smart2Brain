/**
 * Guards the shipped-skill history protocol documented in `src/skills/shippedSkills.ts`.
 *
 * That protocol is three manual steps performed at edit time (retain the old body, register
 * its fingerprint, bump the version), and skipping any of them fails *silently and in the
 * worst direction*: every existing vault's untouched copy stops matching a shipped
 * fingerprint, so it reads as a user customization. The user is then shown a "your customized
 * version was kept" notice for a file they never touched, and the improvement never reaches
 * them. Nothing at runtime can tell that apart from a real edit — which is exactly why it has
 * to be caught here, at the point where the bundled text is still checked in.
 *
 * Both failure modes this catches were live in the tree when it was written: `edit-notes` was
 * bumped 1.0 → 1.1 with no retained 1.0 body, and `dataview`/`tasknotes` had their bodies
 * changed under an unchanged "1.0".
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { BUNDLED_SKILLS } from "../../src/skills/defaults";
import { SHIPPED_SKILL_HISTORY, currentSkillVersion } from "../../src/skills/shippedSkills";
import { fingerprint, normalizeShipped } from "../../src/utils/shippedDefaults";

/** Repo-relative path of a bundled skill's SKILL.md, or null if it isn't in a known dir. */
function skillSourcePath(name: string): string | null {
	for (const dir of ["src/skills/defaults", "src/skills/integrations"]) {
		const path = `${dir}/${name}/SKILL.md`;
		try {
			execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { stdio: "ignore" });
			return path;
		} catch {
			// Not at this path (or not committed yet) — try the next dir.
		}
	}
	return null;
}

/**
 * The body of a file as it stood at each release tag. Uses git rather than a fixture because
 * the protocol's whole subject is bodies that are *no longer* in the working tree.
 *
 * Tags, not commits, are the right unit: "shipped" means a body that reached a user's vault,
 * and only tagged revisions did. Mid-development commits within one version are invisible to
 * every install, so requiring a fingerprint for each of them would demand retained copies of
 * text nobody ever ran — and would fail on `explore-vault`, which followed the protocol
 * correctly but was touched twice between releases.
 */
function releasedRevisions(path: string): string[] {
	const tags = execFileSync("git", ["tag", "--list"], { encoding: "utf8" }).split("\n").filter(Boolean);

	const bodies: string[] = [];
	for (const tag of tags) {
		try {
			bodies.push(
				execFileSync("git", ["show", `${tag}:${path}`], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				}),
			);
		} catch {
			// The skill didn't exist at that release.
		}
	}
	return bodies;
}

/** `metadata.version` as written in a SKILL.md body. */
function versionOf(content: string): string | undefined {
	return content.match(/^\s+version:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim();
}

const trackedSkills = BUNDLED_SKILLS.filter((s) => s.version);

describe("shipped skill history", () => {
	it("tracks every bundled skill (all carry metadata.version)", () => {
		expect(BUNDLED_SKILLS.filter((s) => !s.version).map((s) => s.name)).toEqual([]);
	});

	it.each(trackedSkills.map((s) => s.name))("%s: current body is registered as its version", (name) => {
		const skill = BUNDLED_SKILLS.find((s) => s.name === name);
		if (!skill) throw new Error(`missing skill ${name}`);

		expect(currentSkillVersion(name)).toBe(skill.version);
		expect(SHIPPED_SKILL_HISTORY.get(name)?.get(skill.version as string)).toBe(fingerprint(skill.content));
	});

	/**
	 * The load-bearing one. A previously-shipped body that carries no fingerprint is a vault
	 * that can never be updated, so every released revision must resolve to some entry.
	 *
	 * Revisions are compared by normalized text, matching how `shippedVersion` compares them:
	 * a body reformatted-but-unchanged is one shipped body, not two.
	 */
	it.each(trackedSkills.map((s) => s.name))("%s: every previously shipped body is fingerprinted", (name) => {
		const path = skillSourcePath(name);
		if (!path) return; // Uncommitted new skill: nothing shipped yet, nothing to retain.

		const history = SHIPPED_SKILL_HISTORY.get(name);
		const known = new Set(history?.values() ?? []);

		const unretained = [...new Set(releasedRevisions(path).map(normalizeShipped))]
			.filter((body) => !known.has(fingerprint(body)))
			.map((body) => versionOf(body) ?? "(no version)");

		expect(
			unretained,
			`${name} has shipped bodies with no fingerprint (versions: ${unretained.join(", ")})`,
		).toEqual([]);
	});

	/**
	 * The quieter one: changing a body without bumping `metadata.version` records the NEW
	 * fingerprint under the OLD key, so the old body drops out of history entirely. The check
	 * above would also catch this, but only as a confusing "(no version)"-style miss — this
	 * names the actual mistake.
	 */
	it.each(trackedSkills.map((s) => s.name))("%s: each shipped version has exactly one body", (name) => {
		const path = skillSourcePath(name);
		if (!path) return;

		// The working-tree body is included: it hasn't been tagged yet, but it is what the next
		// release will ship, so an edit that forgot to bump must fail now rather than after it
		// has already gone out and become unfixable.
		const current = BUNDLED_SKILLS.find((s) => s.name === name)?.content;

		const bodiesByVersion = new Map<string, Set<string>>();
		for (const body of [...releasedRevisions(path), ...(current ? [current] : [])]) {
			const version = versionOf(body);
			if (!version) continue;
			const bodies = bodiesByVersion.get(version) ?? new Set<string>();
			bodies.add(normalizeShipped(body));
			bodiesByVersion.set(version, bodies);
		}

		const reused = [...bodiesByVersion].filter(([, bodies]) => bodies.size > 1).map(([version]) => version);

		expect(reused, `${name} changed under an unchanged version (bump it): ${reused.join(", ")}`).toEqual([]);
	});
});
