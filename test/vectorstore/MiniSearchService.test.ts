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
});
