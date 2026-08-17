import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniSearchService } from "../../src/vectorstore/MiniSearchService";

describe("MiniSearchService", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps leading numeric title matches ahead of plain text matches", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "numeric-ranking");
		service.addDocument("Notes/semester.md", "9. Semester", "Program overview and module planning.");
		service.addDocument(
			"Notes/meeting.md",
			"Semester Steering",
			"Semester steering notes mentioning seme several times for lexical competition.",
		);
		service.addDocument("Notes/reference.md", "Reference", "semester semester semester semester");

		const results = service.search("9. seme", 3);

		expect(results[0]?.name).toBe("9. Semester");
	});

	it("prioritizes numeric-leading token prefix title matches over content-heavy matches", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "numeric-token-prefix");
		service.addDocument("Notes/semester.md", "9. Semester", "Program overview and module planning.");
		service.addDocument(
			"Notes/release.md",
			"EKK Pre-Release Steering (and previous syncs)",
			"9 semester 9 semester 9 semester 9 semester 9 semester",
		);
		service.addDocument(
			"Notes/floats.md",
			"Defeating Nondeterminism in LLM Inference",
			"9 semester floating point examples and semes-style partial matches",
		);

		const results = service.search("9. semes", 5);

		expect(results[0]?.name).toBe("9. Semester");
	});

	it("strongly prefers titles that start with a numeric query token", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "numeric-prefix");
		service.addDocument("Notes/semester.md", "9. Semester", "file.name: 252 note.prof: 184 note.credits: 96");
		service.addDocument("Notes/release.md", "EKK Pre-Release Steering", "9 9 9 9 9 9 9 9 9 9");
		service.addDocument("Notes/floats.md", "Floating Point 32Bit IEEE", "9 19 29 39 49 59 69 79 89 99");

		const results = service.search("9.", 3);

		expect(results[0]?.name).toBe("9. Semester");
		expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
	});

	it("rescues numeric-leading title prefixes when the trailing text is only one character", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "numeric-short-prefix");
		service.addDocument("Notes/semester.md", "9. Semester", "file.name: 252 note.prof: 184 note.credits: 96");
		service.addDocument(
			"Notes/release.md",
			"EKK Pre-Release Steering",
			"9 9 9 9 9 9 9 9 9 9 semester steering release plan",
		);
		service.addDocument("Notes/floats.md", "Floating Point 32Bit IEEE", "9 19 29 39 49 59 69 79 89 99");

		const results = service.search("9. s", 5);

		expect(results[0]?.name).toBe("9. Semester");
	});

	it("keeps exact alias matches ahead of content-heavy lexical matches", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "alias-ranking");
		service.addDocument(
			"Notes/alias.md",
			"Alias Fixture",
			[
				"---",
				"aliases:",
				"  - Rocket Science",
				"---",
				"",
				"# Alias Fixture",
				"",
				"This note is about spacecraft and propulsion.",
			].join("\n"),
		);
		service.addDocument(
			"Notes/noisy.md",
			"Noisy Content",
			"rocket science rocket science rocket science rocket science rocket science",
		);

		const results = service.search("Rocket Science", 5);

		expect(results[0]?.name).toBe("Alias Fixture");
		expect(results[0]?.aliases).toContain("Rocket Science");
	});

	it("keeps alias contains matches visible alongside strong title matches", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "alias-contains-ranking");
		service.addDocument(
			"Notes/sap-ekx.md",
			"SAP Workstream",
			["---", "aliases:", "  - SAP EKX", "---", "", "# SAP Workstream"].join("\n"),
		);
		service.addDocument("Notes/ekx-one.md", "EKX Steering Sync", "Title-led EKX note.");
		service.addDocument("Notes/ekx-two.md", "EKX State of the Union", "Another title-led EKX note.");
		service.addDocument("Notes/ekx-three.md", "EKX Architecture Session", "Yet another EKX title.");

		const results = service.search("ekx", 10);

		expect(results.map((result) => result.name)).toContain("SAP Workstream");
	});

	it("prefers alias token matches over plain title-prefix matches for acronyms", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "alias-token-ranking");
		service.addDocument(
			"Notes/sap-ekx.md",
			"SAP Workstream",
			["---", "aliases:", "  - SAP EKX", "---", "", "# SAP Workstream"].join("\n"),
		);
		service.addDocument("Notes/ekx-one.md", "EKX Steering Sync", "Title-led EKX note.");

		const results = service.search("ekx", 5);

		expect(results[0]?.name).toBe("SAP Workstream");
		expect(results[0]?.aliases).toContain("SAP EKX");
	});

	it("keeps strong title matches ahead of content-only matches", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "title-vs-content");
		service.addDocument("Notes/pm-and-comms.md", "PM and comms", "Short note with a direct title match.");
		service.addDocument(
			"Notes/psychologie.md",
			"Psychologie für Ingenieure",
			"pm an pm an pm an pm an pm an pm an pm an pm an pm an pm an",
		);

		const results = service.search("pm an", 5);

		expect(results[0]?.name).toBe("PM and comms");
		expect(results[1]?.name).toBe("Psychologie für Ingenieure");
	});

	it("returns title-prefix matches for one- and two-character queries", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "short-title-prefixes");
		service.addDocument("Notes/pm-board.md", "PM Board", "Project management board and planning notes.");
		service.addDocument(
			"Notes/noisy.md",
			"Noisy Content",
			"pm pm pm pm pm pm repeated in content only to compete with the title match.",
		);

		const oneCharResults = service.search("p", 5);
		const twoCharResults = service.search("pm", 5);

		expect(oneCharResults[0]?.name).toBe("PM Board");
		expect(twoCharResults[0]?.name).toBe("PM Board");
	});

	it("ignores weak short tokens for BM25 retrieval when stronger terms exist", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "mixed-short-token-query");
		service.addDocument("Notes/pm-tasks.md", "PM and tasks", "Short note with the intended title match.");
		service.addDocument(
			"Notes/ekx-sync.md",
			"EKX Steering Sync Pre-Release",
			"and and and and and choose choose choose choose choose",
		);
		service.addDocument(
			"Notes/psychologie.md",
			"Psychologie für Ingenieure",
			"an an an an an an an an an choose once in content",
		);

		const results = service.search("pm an task", 5);

		expect(results[0]?.name).toBe("PM and tasks");
		expect(results.slice(0, 2).map((result) => result.name)).not.toContain("EKX Steering Sync Pre-Release");
	});

	it("keeps the unsuffixed base title ahead of numeric variants", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "base-title-vs-variants");
		service.addDocument("Notes/pm-and-chores.md", "PM and chores", "Canonical PM chores note.");
		service.addDocument("Notes/pm-and-chores-5.md", "PM and chores-5", "Repeated PM chores note variant.");
		service.addDocument("Notes/pm-and-chores-12.md", "PM and chores-12", "Repeated PM chores note variant.");

		const results = service.search("pm an ch", 5);

		expect(results[0]?.name).toBe("PM and chores");
		expect(results[1]?.name).toMatch(/^PM and chores-/);
	});

	it("keeps the leading short acronym token in mixed numeric queries", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "leading-short-token-numeric-query");
		service.addDocument("Notes/pm-and-chores-2.md", "PM and chores-2", "Target note for the mixed query.");
		service.addDocument(
			"Notes/machine-intelligence-2.md",
			"Machine Intelligence 2",
			"Content mentions chore chores choose and other lexical noise.",
		);

		const results = service.search("pm an cho 2", 5);

		expect(results[0]?.name).toBe("PM and chores-2");
		expect(results[1]?.name).toBe("Machine Intelligence 2");
	});

	it("maintains autocomplete tag and folder aggregates incrementally", () => {
		vi.useFakeTimers();

		const service = new MiniSearchService("test-vault", "autocomplete-cache");
		service.addDocument("Projects/Alpha/Spec.md", "Spec", "Alpha note", ["project/alpha", "shared"]);
		service.addDocument("Projects/Beta/Plan.md", "Plan", "Beta note", ["project/beta", "shared"]);

		let snapshot = service.getAutocompleteCache();

		expect(snapshot.tags).toEqual(["project", "project/alpha", "project/beta", "shared"]);
		expect(Array.from(snapshot.tagChildCount.entries())).toEqual([["project", 2]]);
		expect(snapshot.folders).toEqual(["Projects", "Projects/Alpha", "Projects/Beta"]);

		service.addDocument("Projects/Alpha/Spec.md", "Spec", "Alpha note", ["project/alpha/v2"]);
		snapshot = service.getAutocompleteCache();

		expect(snapshot.tags).toEqual(["project", "project/alpha", "project/alpha/v2", "project/beta", "shared"]);
		expect(Array.from(snapshot.tagChildCount.entries())).toEqual([
			["project", 2],
			["project/alpha", 1],
		]);

		service.removeDocument("Projects/Beta/Plan.md");
		snapshot = service.getAutocompleteCache();

		expect(snapshot.tags).toEqual(["project", "project/alpha", "project/alpha/v2"]);
		expect(Array.from(snapshot.tagChildCount.entries())).toEqual([
			["project", 1],
			["project/alpha", 1],
		]);
		expect(snapshot.folders).toEqual(["Projects", "Projects/Alpha"]);
	});

	describe("content prefix coverage", () => {
		it("does not let a short query term match a long word that merely starts with it", () => {
			vi.useFakeTimers();

			// The reported case: German "essen" (food) matched "essentially", so a
			// hydrothermal-vent note outranked the only note about Greek food.
			const service = new MiniSearchService("test-vault", "prefix-coverage");
			service.addDocument(
				"Corpus/vent.md",
				"Vent Chemosynthesis",
				"The vent community is essentially chemosynthetic and essentially self-sustaining.",
			);
			service.addDocument(
				"Corpus/greek.md",
				"Cooking Mediterranean Recipes",
				"Greek Salad Horiatiki with tomatoes, Kalamata olives and feta cheese.",
			);

			const results = service.search("essen", 5);

			expect(results.map((r) => r.path)).not.toContain("Corpus/vent.md");
		});

		it("still matches a genuine prefix of a word", () => {
			vi.useFakeTimers();

			const service = new MiniSearchService("test-vault", "prefix-legit");
			service.addDocument("Corpus/greek.md", "Recipes", "Mediterranean cuisine from the region.");

			// 8 of 13 characters — the user typing a real prefix.
			expect(service.search("mediterr", 5).map((r) => r.path)).toContain("Corpus/greek.md");
		});

		it("still matches inflections and plurals", () => {
			vi.useFakeTimers();

			const service = new MiniSearchService("test-vault", "prefix-inflection");
			service.addDocument("Corpus/a.md", "Recipes", "A page of recipes for the week.");
			service.addDocument("Corpus/b.md", "Sourdough", "Notes on sourdough starters.");

			expect(service.search("recipe", 5).map((r) => r.path)).toContain("Corpus/a.md");
			expect(service.search("sourdo", 5).map((r) => r.path)).toContain("Corpus/b.md");
		});

		it("keeps exact matches regardless of word length", () => {
			vi.useFakeTimers();

			const service = new MiniSearchService("test-vault", "prefix-exact");
			service.addDocument("Corpus/a.md", "Long Words", "The word internationalization appears here.");

			expect(service.search("internationalization", 5).map((r) => r.path)).toContain("Corpus/a.md");
		});

		it("does not let one well-covered query term rescue a poorly-covered one in the same result", () => {
			vi.useFakeTimers();

			// A multi-term query where one term matches exactly ("griechisch") and the
			// other only through a spurious prefix expansion ("essen" -> "essentially").
			// MiniSearch sums both matched terms' contributions into one score with no
			// per-term breakdown, so a filter that accepts the result whenever ANY term
			// clears coverage still hands it the "essentially" contribution. Because the
			// two cannot be separated after the fact, the whole content-channel result is
			// dropped for this query — the note is still findable via "griechisch" alone
			// (see the next test), just not through this specific noisy combination.
			const service = new MiniSearchService("test-vault", "prefix-coverage-multi-term");
			service.addDocument("Corpus/mixed.md", "Mixed", "griechisch salad recipe essentially good food");
			service.addDocument("Corpus/clean.md", "Clean", "griechisch salad recipe good food");

			const results = service.search("griechisch essen", 5);

			expect(results.map((r) => r.path)).not.toContain("Corpus/mixed.md");
			expect(results.map((r) => r.path)).toContain("Corpus/clean.md");
		});

		it("keeps a genuine match findable on its own even when a noisy combined query drops it", () => {
			vi.useFakeTimers();

			const service = new MiniSearchService("test-vault", "prefix-coverage-findable-alone");
			service.addDocument("Corpus/mixed.md", "Mixed", "griechisch salad recipe essentially good food");

			expect(service.search("griechisch", 5).map((r) => r.path)).toContain("Corpus/mixed.md");
		});

		it("does not let an unrelated query term's length coincidentally cover a matched word", () => {
			vi.useFakeTimers();

			// `griechisch` (10 chars) is 91% the length of the unrelated `essentially`
			// (11 chars) and clears a bare length-ratio check on its own, despite sharing
			// no prefix and no near-miss spelling with it (edit distance 10). Coverage
			// must require the query term to plausibly have PRODUCED the matched word —
			// via a real prefix or MiniSearch's own fuzzy edit-distance budget — not
			// merely be long enough to pass a ratio test against some unrelated term.
			const service = new MiniSearchService("test-vault", "prefix-coverage-coincidental-length");
			service.addDocument("Corpus/only-noise.md", "Only Noise", "this note is essentially about nothing");

			const results = service.search("griechisch essen", 5);

			expect(results.map((r) => r.path)).not.toContain("Corpus/only-noise.md");
		});
	});
});
