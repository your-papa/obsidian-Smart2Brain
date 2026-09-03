import { describe, expect, it } from "vitest";
import { compileFilter, matchesPathFilter, matchesSearchFilter } from "../../src/search/searchFilters";

describe("matchesPathFilter", () => {
	it("keeps everything when there is no filter", () => {
		expect(matchesPathFilter("Notes/a.md")).toBe(true);
		expect(matchesPathFilter("Notes/a.md", { tags: ["#x"] })).toBe(true);
	});

	it("matches on folder prefix, respecting folder boundaries", () => {
		const filter = { pathPrefixes: ["Corpus/Typography"] };
		expect(matchesPathFilter("Corpus/Typography/kerning.md", filter)).toBe(true);
		expect(matchesPathFilter("Corpus/TypographyOther/kerning.md", filter)).toBe(false);
		expect(matchesPathFilter("Corpus/Fermentation/miso.md", filter)).toBe(false);
	});

	it("is permissive about tag constraints it cannot evaluate", () => {
		// Tags need the metadata cache, which the pre-filter does not have. It must
		// keep path-qualifying candidates so the authoritative check can see them —
		// dropping them here would silently lose real matches.
		const filter = { pathPrefixes: ["Corpus"], tags: ["#nope"] };
		expect(matchesPathFilter("Corpus/Typography/kerning.md", filter)).toBe(true);
		expect(matchesSearchFilter("Corpus/Typography/kerning.md", [], filter)).toBe(false);
	});

	it("agrees with matchesSearchFilter for path-only filters", () => {
		const filter = { pathPrefixes: ["Corpus/Typography", "Topics"] };
		for (const path of [
			"Corpus/Typography/kerning.md",
			"Topics/Smart Cities/IoT.md",
			"Corpus/Fermentation/miso.md",
			"Other/x.md",
		]) {
			expect(matchesPathFilter(path, filter)).toBe(matchesSearchFilter(path, [], filter));
		}
	});

	it("works through a compiled filter, including the exact-path Set path", () => {
		// compileFilter switches to a Set above a threshold; both branches must
		// behave identically.
		const many = Array.from({ length: 40 }, (_, i) => `Corpus/Note ${i}.md`);
		const compiled = compileFilter({ pathPrefixes: many });

		expect(matchesPathFilter("Corpus/Note 7.md", compiled)).toBe(true);
		expect(matchesPathFilter("Corpus/Note 999.md", compiled)).toBe(false);

		const small = compileFilter({ pathPrefixes: ["Corpus/Typography"] });
		expect(matchesPathFilter("Corpus/Typography/kerning.md", small)).toBe(true);
		expect(matchesPathFilter("Corpus/Fermentation/miso.md", small)).toBe(false);
	});
});
