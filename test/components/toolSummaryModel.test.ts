import { describe, expect, it } from "vitest";
import { buildToolOutputRenderModel } from "../../src/components/chat/toolOutputRenderModel";
import { buildToolSummary, buildMergedToolSummary } from "../../src/components/chat/toolSummaryModel";

/** Build the output render model the way ToolCallsSection does before summarizing. */
function model(toolName: string, output: unknown, input?: Record<string, unknown>) {
	return buildToolOutputRenderModel(toolName, output, input);
}

describe("buildToolSummary", () => {
	describe("tense", () => {
		it("uses present continuous while running", () => {
			const s = buildToolSummary("read_content", { target: "Notes/main.md" }, undefined, "running");
			expect(s.label).toBe("Reading main.md");
		});

		it("uses past tense once completed", () => {
			const out = model("read_content", 'Content of "Notes/main.md":\n\na\nb\nc');
			const s = buildToolSummary("read_content", { target: "Notes/main.md" }, out, "completed");
			expect(s.label).toBe("Read main.md");
		});

		it("uses past tense when failed", () => {
			const s = buildToolSummary("read_content", { target: "Notes/main.md" }, undefined, "failed");
			expect(s.label).toBe("Read main.md");
			expect(s.summary).toBe("failed");
		});
	});

	describe("search_notes", () => {
		it("labels with the query and counts notes", () => {
			const out = model(
				"search_notes",
				JSON.stringify({ query: "vector store", totalResults: 3, results: [{ rank: 1, name: "A" }] }),
			);
			const s = buildToolSummary("search_notes", { query: "vector store" }, out, "completed");
			expect(s.label).toBe("Searched notes for “vector store”");
			expect(s.summary).toBe("3 notes");
		});

		it("reports no matches for an empty result set", () => {
			const out = model("search_notes", JSON.stringify({ query: "zzz", totalResults: 0, results: [] }));
			const s = buildToolSummary("search_notes", { query: "zzz" }, out, "completed");
			expect(s.summary).toBe("no matches");
		});

		it("handles recent-only searches without a query", () => {
			const s = buildToolSummary("search_notes", { recentOnly: true }, undefined, "running");
			expect(s.label).toBe("Looking at recent notes");
		});
	});

	describe("grep_notes", () => {
		it("counts matches and files from the raw payload", () => {
			const payload = JSON.stringify({ pattern: "TODO", total_matches: 5, files_searched: 2, results: [] });
			const out = model("grep_notes", payload);
			const s = buildToolSummary("grep_notes", { pattern: "TODO" }, out, "completed");
			expect(s.label).toBe("Searched for text “TODO”");
			expect(s.summary).toBe("5 matches in 2 files");
		});

		it("reports no matches", () => {
			const out = model("grep_notes", JSON.stringify({ pattern: "TODO", total_matches: 0, files_searched: 4 }));
			const s = buildToolSummary("grep_notes", { pattern: "TODO" }, out, "completed");
			expect(s.summary).toBe("no matches");
		});
	});

	describe("list_directory", () => {
		it("labels with the folder basename and counts entries", () => {
			const out = model("list_directory", {
				root: "Projects",
				tree: { folders: {}, files: [{ name: "a.md" }] },
				totalFolders: 1,
				totalFiles: 2,
			});
			const s = buildToolSummary("list_directory", { path: "Notes/Projects" }, out, "completed");
			expect(s.label).toBe("Listed folder Projects");
			expect(s.summary).toBe("1 folder, 2 files");
		});

		it("labels the vault root", () => {
			const s = buildToolSummary("list_directory", { path: "/" }, undefined, "running");
			expect(s.label).toBe("Listing the vault");
		});
	});

	describe("read_content", () => {
		it("counts lines in the returned content", () => {
			const out = model("read_content", 'Content of "Notes/deep/main.md":\n\none\ntwo\nthree');
			const s = buildToolSummary("read_content", { target: "Notes/deep/main.md" }, out, "completed");
			expect(s.label).toBe("Read main.md");
			expect(s.summary).toBe("3 lines");
		});

		it("flags truncated reads", () => {
			const out = model("read_content", 'Content of "big.md":\n\na\nb\n[Content truncated at 2 lines]');
			const s = buildToolSummary("read_content", { target: "big.md" }, out, "completed");
			expect(s.summary).toContain("truncated");
		});
	});

	describe("manage_notes", () => {
		it("summarizes operations and note count", () => {
			const out = model("manage_notes", "Proposed 2 note operation(s) across 1 path(s) (1 create, 1 append)");
			const s = buildToolSummary("manage_notes", {}, out, "completed");
			expect(s.label).toBe("Edited a note");
			expect(s.summary).toBe("2 operations · 1 note");
		});

		it("uses present tense while editing", () => {
			const s = buildToolSummary("manage_notes", {}, undefined, "running");
			expect(s.label).toBe("Editing notes");
		});
	});

	describe("execute_javascript", () => {
		it("reports an error state", () => {
			const out = model("execute_javascript", "JavaScript execution failed: boom", { code: "throw 1" });
			const s = buildToolSummary("execute_javascript", { code: "throw 1" }, out, "completed");
			expect(s.label).toBe("Ran JavaScript");
			expect(s.summary).toBe("error");
		});

		it("summarizes logs and duration on success", () => {
			const out = model(
				"execute_javascript",
				"Execution completed in 12ms.\n\nConsole output:\nhello\nworld\n\nReturn value:\n42",
				{ code: "console.log('hi')" },
			);
			const s = buildToolSummary("execute_javascript", { code: "console.log('hi')" }, out, "completed");
			expect(s.summary).toContain("2 logs");
			expect(s.summary).toContain("12ms");
		});

		it("uses present tense while running", () => {
			const s = buildToolSummary("execute_javascript", {}, undefined, "running");
			expect(s.label).toBe("Running JavaScript");
		});
	});

	describe("web_search", () => {
		it("labels with the query", () => {
			const s = buildToolSummary("web_search", { query: "svelte runes" }, undefined, "running");
			expect(s.label).toBe("Searching the web for “svelte runes”");
		});
	});

	describe("fetch_url", () => {
		it("labels with the host", () => {
			const s = buildToolSummary("fetch_url", { url: "https://example.com/a/b?c=1" }, undefined, "completed");
			expect(s.label).toBe("Fetched example.com");
		});

		it("falls back gracefully for a malformed url", () => {
			const s = buildToolSummary("fetch_url", { url: "not a url" }, undefined, "completed");
			expect(s.label).toBe("Fetched not a url");
		});
	});

	describe("load_skill", () => {
		it("labels with the skill name", () => {
			const s = buildToolSummary("load_skill", { name: "canvas" }, undefined, "completed");
			expect(s.label).toBe("Loaded skill canvas");
		});
	});

	describe("generic fallback (unknown / renamed tools)", () => {
		it("title-cases the tool name and uses a neutral frame", () => {
			const s = buildToolSummary("my_custom_tool", {}, undefined, "running");
			expect(s.label).toBe("Using My Custom Tool");
		});

		it("uses past tense when completed", () => {
			const s = buildToolSummary("my_custom_tool", {}, undefined, "completed");
			expect(s.label).toBe("Used My Custom Tool");
		});

		it("appends the first string input as a target hint", () => {
			const s = buildToolSummary("my_custom_tool", { path: "Notes/x.md" }, undefined, "running");
			expect(s.label).toBe("Using My Custom Tool: Notes/x.md");
		});

		it("derives a count hint from list output", () => {
			const out = model("my_custom_tool", ["a", "b", "c"]);
			const s = buildToolSummary("my_custom_tool", {}, out, "completed");
			expect(s.summary).toBe("3 items");
		});
	});

	describe("truncation", () => {
		it("truncates a very long query", () => {
			const longQuery = "x".repeat(100);
			const s = buildToolSummary("search_notes", { query: longQuery }, undefined, "running");
			expect(s.label.length).toBeLessThan(longQuery.length + 30);
			expect(s.label).toContain("…");
		});
	});
});

describe("buildMergedToolSummary", () => {
	const mergedCall = (toolName: string, output: unknown, input: Record<string, unknown>) => ({
		input,
		model: buildToolOutputRenderModel(toolName, output, input),
	});

	it("defers to the single-call summary for a group of one", () => {
		const s = buildMergedToolSummary(
			"search_notes",
			[mergedCall("search_notes", JSON.stringify({ totalResults: 2, results: [] }), { query: "a" })],
			"completed",
		);
		expect(s.label).toBe("Searched notes for “a”");
	});

	it("lists grep patterns and sums matches", () => {
		const calls = [
			mergedCall("grep_notes", JSON.stringify({ total_matches: 3, files_searched: 1 }), { pattern: "foo" }),
			mergedCall("grep_notes", JSON.stringify({ total_matches: 2, files_searched: 1 }), { pattern: "bar" }),
		];
		const s = buildMergedToolSummary("grep_notes", calls, "completed");
		expect(s.label).toBe("Searched for text “foo” and “bar”");
		expect(s.summary).toBe("5 matches");
	});

	it("lists search queries with an Oxford-style 'and' and sums notes", () => {
		const calls = [
			mergedCall("search_notes", JSON.stringify({ totalResults: 2, results: [] }), { query: "a" }),
			mergedCall("search_notes", JSON.stringify({ totalResults: 1, results: [] }), { query: "b" }),
			mergedCall("search_notes", JSON.stringify({ totalResults: 4, results: [] }), { query: "c" }),
		];
		const s = buildMergedToolSummary("search_notes", calls, "completed");
		expect(s.label).toBe("Searched notes for “a”, “b” and “c”");
		expect(s.summary).toBe("7 notes");
	});

	it("caps a long target list with '+N more'", () => {
		const calls = ["a", "b", "c", "d", "e", "f"].map((q) =>
			mergedCall("search_notes", JSON.stringify({ totalResults: 0, results: [] }), { query: q }),
		);
		const s = buildMergedToolSummary("search_notes", calls, "completed");
		expect(s.label).toBe("Searched notes for “a”, “b”, “c”, “d” and 2 more");
	});

	it("lists read targets by basename and sums lines", () => {
		const calls = [
			mergedCall("read_content", 'Content of "Notes/a.md":\n\none\ntwo', { target: "Notes/a.md" }),
			mergedCall("read_content", 'Content of "Notes/b.md":\n\none\ntwo\nthree', { target: "Notes/b.md" }),
		];
		const s = buildMergedToolSummary("read_content", calls, "completed");
		expect(s.label).toBe("Read a.md and b.md");
		expect(s.summary).toBe("5 lines total");
	});

	it("falls back to a count when some calls lack a target", () => {
		const calls = [
			mergedCall("search_notes", JSON.stringify({ totalResults: 1, results: [] }), { query: "a" }),
			mergedCall("search_notes", JSON.stringify({ totalResults: 1, results: [] }), {}),
		];
		const s = buildMergedToolSummary("search_notes", calls, "completed");
		expect(s.label).toBe("Searched notes for 2 items");
	});

	it("uses present tense and empty summary while running", () => {
		const calls = [
			mergedCall("grep_notes", JSON.stringify({ total_matches: 3 }), { pattern: "foo" }),
			mergedCall("grep_notes", JSON.stringify({ total_matches: 2 }), { pattern: "bar" }),
		];
		const s = buildMergedToolSummary("grep_notes", calls, "running");
		expect(s.label).toBe("Searching for text “foo” and “bar”");
		expect(s.summary).toBe("");
	});

	it("falls back to a ×N label for tools without a merge recipe", () => {
		const calls = [
			mergedCall("get_all_tags", ["#a", "#b"], {}),
			mergedCall("get_all_tags", ["#a", "#b"], {}),
		];
		const s = buildMergedToolSummary("get_all_tags", calls, "completed");
		expect(s.label).toContain("×2");
	});
});
