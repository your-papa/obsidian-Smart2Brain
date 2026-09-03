import { describe, expect, it } from "vitest";
import {
	RELEVANCE_JUDGMENTS,
	ndcgAt,
	pairedBootstrapCI,
	reciprocalRank,
	signTest,
} from "../../integration/helpers/relevanceJudgments";

/*
 * The benchmark decides whether the ranking rework ships, so the metrics
 * themselves need to be trustworthy before they are used to judge anything.
 */

describe("ndcgAt", () => {
	const grades = { "a.md": 2, "b.md": 1 } as const;

	it("scores a perfect ordering as 1", () => {
		expect(ndcgAt(["a.md", "b.md", "x.md"], grades, 10)).toBeCloseTo(1, 10);
	});

	it("penalises a swapped ordering without zeroing it", () => {
		const score = ndcgAt(["b.md", "a.md"], grades, 10);
		expect(score).toBeLessThan(1);
		expect(score).toBeGreaterThan(0);
	});

	it("returns 0 when no judged note is retrieved", () => {
		expect(ndcgAt(["x.md", "y.md"], grades, 10)).toBe(0);
	});

	it("ranks the highly-relevant note first as better than the merely relevant one", () => {
		expect(ndcgAt(["a.md"], grades, 10)).toBeGreaterThan(ndcgAt(["b.md"], grades, 10));
	});

	it("respects the cutoff k", () => {
		// The only judged note sits at rank 3, outside k=2.
		expect(ndcgAt(["x.md", "y.md", "a.md"], grades, 2)).toBe(0);
		expect(ndcgAt(["x.md", "y.md", "a.md"], grades, 3)).toBeGreaterThan(0);
	});

	it("returns 0 when nothing is judged relevant", () => {
		expect(ndcgAt(["a.md"], { "a.md": 0 }, 10)).toBe(0);
	});
});

describe("reciprocalRank", () => {
	const grades = { "a.md": 2, "b.md": 1 } as const;

	it("is 1 when the target is first", () => {
		expect(reciprocalRank(["a.md", "b.md"], grades)).toBe(1);
	});

	it("decays with the target's rank", () => {
		expect(reciprocalRank(["x.md", "x2.md", "a.md"], grades)).toBeCloseTo(1 / 3, 10);
	});

	it("ignores merely-relevant results", () => {
		// 'b.md' is grade 1, not the answer — MRR should not credit it.
		expect(reciprocalRank(["b.md"], grades)).toBe(0);
	});

	it("is 0 when the target is missing", () => {
		expect(reciprocalRank(["x.md"], grades)).toBe(0);
	});
});

describe("judgment set", () => {
	it("is non-empty and every query has at least one highly-relevant target", () => {
		expect(RELEVANCE_JUDGMENTS.length).toBeGreaterThan(0);
		for (const judgment of RELEVANCE_JUDGMENTS) {
			const targets = Object.values(judgment.grades).filter((g) => g === 2);
			expect(targets.length, `query: ${judgment.query}`).toBeGreaterThan(0);
		}
	});

	it("documents what each case probes", () => {
		for (const judgment of RELEVANCE_JUDGMENTS) {
			expect(judgment.probes.length, `query: ${judgment.query}`).toBeGreaterThan(0);
		}
	});

	it("points only at vault-relative note paths", () => {
		for (const judgment of RELEVANCE_JUDGMENTS) {
			for (const path of Object.keys(judgment.grades)) {
				expect(path.endsWith(".md"), path).toBe(true);
				expect(path.startsWith("/"), path).toBe(false);
			}
		}
	});

	it("only marks notes recent that the same case also grades", () => {
		// A recency fixture pointing at an ungraded note would silently do nothing
		// measurable — the conflict it is supposed to create wouldn't be scored.
		for (const judgment of RELEVANCE_JUDGMENTS) {
			for (const path of judgment.recentNotes ?? []) {
				expect(Object.keys(judgment.grades), `query: ${judgment.query}`).toContain(path);
			}
		}
	});

	it("explains every known failure", () => {
		for (const judgment of RELEVANCE_JUDGMENTS) {
			if (judgment.knownFailure !== undefined) {
				expect(judgment.knownFailure.length, `query: ${judgment.query}`).toBeGreaterThan(0);
			}
		}
	});

	it("covers multi-target queries, so nDCG measures set ordering not just rank 1", () => {
		const multi = RELEVANCE_JUDGMENTS.filter((j) => Object.values(j.grades).filter((g) => g === 2).length > 1);
		expect(multi.length).toBeGreaterThan(0);
	});

	it("covers recency-vs-relevance conflicts", () => {
		const withRecency = RELEVANCE_JUDGMENTS.filter((j) => (j.recentNotes ?? []).length > 0);
		expect(withRecency.length).toBeGreaterThan(0);
	});
});

/*
 * Significance helpers. These decide whether a measured tier difference gets
 * acted on, so a wrong CI is worse than no CI — it launders noise as evidence.
 */

describe("pairedBootstrapCI", () => {
	it("is deterministic across runs", () => {
		const a = [1, 0, 1, 1, 0, 1, 0, 1];
		const b = [0, 0, 1, 0, 0, 1, 0, 0];
		expect(pairedBootstrapCI(a, b, 2000)).toEqual(pairedBootstrapCI(a, b, 2000));
	});

	it("reports no difference when both systems are identical", () => {
		const a = [1, 0.5, 0, 1, 0.25];
		const result = pairedBootstrapCI(a, [...a], 2000);
		expect(result.delta).toBe(0);
		expect(result.ciLow).toBe(0);
		expect(result.ciHigh).toBe(0);
		expect(result.significant).toBe(false);
	});

	it("detects a large consistent difference as significant", () => {
		// A wins every query by a wide margin — no resample can flip the sign.
		const a = Array.from({ length: 30 }, () => 1);
		const b = Array.from({ length: 30 }, () => 0);
		const result = pairedBootstrapCI(a, b, 2000);
		expect(result.delta).toBe(1);
		expect(result.significant).toBe(true);
		expect(result.ciLow).toBeGreaterThan(0);
	});

	it("does not call a one-query difference significant", () => {
		// The failure mode this exists to catch: a tier mean moving because a
		// single case flipped, which is what `polysemy` -0.0072 turned out to be.
		const a = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
		const b = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0];
		const result = pairedBootstrapCI(a, b, 2000);
		expect(result.delta).toBeCloseTo(0.1, 10);
		expect(result.significant).toBe(false);
	});

	it("brackets the observed delta with its interval", () => {
		const a = [1, 0.8, 0.6, 1, 0.4, 0.9];
		const b = [0.5, 0.4, 0.6, 0.2, 0.4, 0.1];
		const result = pairedBootstrapCI(a, b, 2000);
		expect(result.ciLow).toBeLessThanOrEqual(result.delta);
		expect(result.ciHigh).toBeGreaterThanOrEqual(result.delta);
	});

	it("handles an empty input without dividing by zero", () => {
		expect(pairedBootstrapCI([], [], 100)).toEqual({
			delta: 0,
			ciLow: 0,
			ciHigh: 0,
			significant: false,
			n: 0,
		});
	});

	it("refuses mismatched lengths rather than silently truncating", () => {
		expect(() => pairedBootstrapCI([1, 0], [1], 100)).toThrow(/equal-length/);
	});
});

describe("signTest", () => {
	it("counts wins, losses and ties", () => {
		expect(signTest([1, 0, 0.5, 1], [0, 1, 0.5, 1])).toEqual({ aWins: 1, bWins: 1, ties: 2 });
	});

	it("treats float noise as a tie rather than a win", () => {
		expect(signTest([0.1 + 0.2], [0.3])).toEqual({ aWins: 0, bWins: 0, ties: 1 });
	});

	it("refuses mismatched lengths", () => {
		expect(() => signTest([1], [1, 0])).toThrow(/equal-length/);
	});
});
