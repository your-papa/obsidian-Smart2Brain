import { describe, expect, it } from "vitest";
import {
	calculatePathBoost,
	calculateTagBoost,
	calculateTitleBoost,
	getAliasMatchKind,
} from "../../src/search/searchRanking";

describe("calculateTitleBoost", () => {
	it("does not boost multi-term queries on a single weak subterm match", () => {
		expect(calculateTitleBoost("pm an ch", "EKX Steering Sync Pre-Release (and previous syncs)", 100)).toBe(0);
		expect(calculateTitleBoost("pm an ch", "Psychologie für Ingenieure", 100)).toBe(0);
	});

	it("keeps multi-term title boosts for genuine overlapping title matches", () => {
		expect(calculateTitleBoost("pm an ch", "PM and chores", 100)).toBeGreaterThan(0);
	});

	it("distinguishes alias token matches from weaker contains matches", () => {
		expect(getAliasMatchKind("ekx", { aliases: ["SAP EKX"] })).toBe("token");
		expect(getAliasMatchKind("ekx", { aliases: ["Steering for project-ekx-rollout"] })).toBe("contains");
	});
});

/*
 * Token-wise path/tag matching.
 *
 * Both boosts used to compare the *whole query string* against a segment or tag,
 * so any conversational query scored 0 — folders and tags were inert for exactly
 * the queries people actually type. These cases pin the new token-wise tier and,
 * more importantly, the guardrails that keep it from becoming noise.
 */
describe("calculatePathBoost", () => {
	it("still gives a whole-query match the full boost", () => {
		expect(calculatePathBoost("smart cities", ["Topics", "Smart Cities"], 100)).toBe(100);
	});

	it("credits a conversational query that shares terms with a folder", () => {
		// Previously 0: the query is not equal to, a prefix of, or a substring of
		// any segment, so no whole-query tier could fire.
		expect(calculatePathBoost("what did the vendor call cover", ["Vendor Calls"], 100)).toBeGreaterThan(0);
	});

	it("keeps a token-wise match well below a whole-query match", () => {
		const whole = calculatePathBoost("vendor calls", ["Vendor Calls"], 100);
		const tokenwise = calculatePathBoost("what did the vendor call cover", ["Vendor Calls"], 100);
		expect(tokenwise).toBeLessThan(whole * 0.5);
	});

	it("scales with coverage, so an incidental one-token overlap stays small", () => {
		// "notes" is one token of a six-token query and one of two in the segment.
		const incidental = calculatePathBoost("notes about the migration i wrote", ["Meeting Notes"], 100);
		const substantial = calculatePathBoost("meeting notes", ["Meeting Notes"], 100);
		expect(incidental).toBeGreaterThan(0);
		expect(incidental).toBeLessThan(substantial);
	});

	it("does not fire on function words alone", () => {
		// The only shared token is a stopword. This is the case that would otherwise
		// let every folder containing "The" collect a boost on every query.
		expect(calculatePathBoost("what happened in the migration", ["The Archive"], 100)).toBe(0);
	});

	it("returns 0 when nothing overlaps", () => {
		expect(calculatePathBoost("sourdough hydration", ["Monetary Policy"], 100)).toBe(0);
	});
});

describe("calculateTagBoost", () => {
	it("gives a whole-query tag match the full boost", () => {
		expect(calculateTagBoost("review", ["#review"], 100)).toBe(100);
	});

	it("keeps prefix and substring tiers below an exact match", () => {
		const exact = calculateTagBoost("review", ["#review"], 100);
		const prefix = calculateTagBoost("review", ["#reviewing"], 100);
		expect(prefix).toBeGreaterThan(0);
		expect(prefix).toBeLessThan(exact);
	});

	/*
	 * The deliberate asymmetry with `calculatePathBoost`. Token-wise tag matching
	 * was measured and regressed `polysemy` 0.7560 → 0.7154 — on `the review is
	 * blocking me` the note tagged `#review` is the WRONG answer, because tags say
	 * what a note *is* and the query wants a note *about* the topic. This pins the
	 * decision so it is not "restored" as an oversight.
	 */
	it("does NOT fire token-wise on a conversational query", () => {
		expect(calculateTagBoost("the review is blocking me", ["#review"], 100)).toBe(0);
		expect(calculateTagBoost("how is the platform work going", ["#project/platform"], 100)).toBe(0);
	});

	it("returns 0 when nothing overlaps", () => {
		expect(calculateTagBoost("sourdough hydration", ["#monetary-policy"], 100)).toBe(0);
	});
});
