import { describe, expect, it } from "vitest";
import { tokenizeSearchText } from "../../src/search/searchTermUtils";
import { STOPWORD_BOOST, getTermBoost, isStopword } from "../../src/search/stopwords";

describe("isStopword", () => {
	it("recognises the German function words that hijacked ranking", () => {
		// "wie spare ich strom" ranked two unrelated German filler notes first,
		// on `wie` (19.27) and `ich` (4.71) alone.
		expect(isStopword("wie")).toBe(true);
		expect(isStopword("ich")).toBe(true);
	});

	it("recognises English function words", () => {
		expect(isStopword("the")).toBe(true);
		expect(isStopword("how")).toBe(true);
	});

	it("leaves content words alone in both languages", () => {
		for (const term of ["spare", "strom", "save", "energy", "octopus", "sourdough"]) {
			expect(isStopword(term), term).toBe(false);
		}
	});

	it("keeps domain terms out of the stopword set", () => {
		// `tag` is a German stopword ("day") but a first-class Obsidian concept.
		expect(isStopword("tag")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(isStopword("Wie")).toBe(true);
		expect(isStopword("THE")).toBe(true);
	});

	it("does not treat an empty term as a stopword", () => {
		expect(isStopword("")).toBe(false);
	});
});

describe("getTermBoost", () => {
	it("down-weights stopwords without zeroing them", () => {
		expect(getTermBoost("wie")).toBe(STOPWORD_BOOST);
		expect(STOPWORD_BOOST).toBeGreaterThan(0);
		expect(STOPWORD_BOOST).toBeLessThan(1);
	});

	it("leaves content words neutral", () => {
		expect(getTermBoost("strom")).toBe(1);
		expect(getTermBoost("tag")).toBe(1);
	});
});

describe("all-stopword queries", () => {
	// Stopwords are down-weighted rather than removed precisely so these still work.
	it("still yields searchable terms", () => {
		for (const query of ["the who", "how to"]) {
			const tokens = tokenizeSearchText(query);
			expect(tokens.length, query).toBeGreaterThan(0);
			expect(
				tokens.every((token) => getTermBoost(token) > 0),
				query,
			).toBe(true);
		}
	});
});

describe("query term weighting end to end", () => {
	it("weights the content words of the reported query above its function words", () => {
		const tokens = tokenizeSearchText("wie spare ich strom");
		const weighted = Object.fromEntries(tokens.map((token) => [token, getTermBoost(token)]));

		expect(weighted.spare).toBeGreaterThan(weighted.wie);
		expect(weighted.strom).toBeGreaterThan(weighted.ich);
	});
});
