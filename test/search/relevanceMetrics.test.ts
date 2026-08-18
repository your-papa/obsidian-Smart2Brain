import { describe, expect, it } from "vitest";
import { RELEVANCE_JUDGMENTS, ndcgAt, reciprocalRank } from "../../integration/helpers/relevanceJudgments";

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
