import { describe, expect, it, vi } from "vitest";
import { resolveViewFilter, describeViewFilter, getAllMarkdownPaths } from "../../src/lib/views";
import type { ViewFilter, ViewFilterGroup } from "../../src/types/graph";
import type { App, CachedMetadata, TFile } from "obsidian";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock Obsidian App with the given file paths and optional tag map.
 */
function createMockApp(
	files: string[],
	fileTags: Record<string, string[]> = {},
): App {
	const mockFiles = files.map((path) => ({
		path,
		basename: path.replace(/\.[^.]+$/, "").split("/").pop(),
		extension: path.split(".").pop() ?? "md",
		name: path.split("/").pop(),
	}));

	const getFileCache = vi.fn((file: TFile): CachedMetadata | null => {
		const tags = fileTags[file.path];
		if (!tags) return null;
		return {
			tags: tags.map((tag) => ({
				tag,
				position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
			})),
		} as unknown as CachedMetadata;
	});

	return {
		metadataCache: { getFileCache },
		vault: {
			getMarkdownFiles: () => mockFiles.filter((f) => f.extension === "md"),
			getFiles: () => mockFiles,
			getAbstractFileByPath: (path: string) =>
				mockFiles.find((f) => f.path === path) ?? null,
		},
	} as unknown as App;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveViewFilter", () => {
	const FILES = [
		"Work/project-a.md",
		"Work/project-b.md",
		"Personal/journal.md",
		"Personal/recipes.md",
		"Root.md",
		"Research/ml-paper.md",
		"Research/deep-learning.md",
		"Research/notes.pdf",
	];

	const TAGS: Record<string, string[]> = {
		"Work/project-a.md": ["#work", "#urgent"],
		"Work/project-b.md": ["#work"],
		"Personal/journal.md": ["#personal", "#daily"],
		"Research/ml-paper.md": ["#ml", "#research"],
		"Research/deep-learning.md": ["#ml", "#ml/transformers", "#research"],
	};

	// ── Leaf: folder ────────────────────────────────────────────────────

	describe("folder leaf", () => {
		it("matches files in a top-level folder", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = { type: "folder", value: "Work" };
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(new Set(["Work/project-a.md", "Work/project-b.md"]));
			expect(result.stalePaths).toEqual([]);
		});

		it("returns empty set for non-existent folder", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = { type: "folder", value: "NonExistent" };
			const result = resolveViewFilter(app, filter);

			expect(result.paths.size).toBe(0);
		});

		it("matches root-level files when path prefix matches", () => {
			const app = createMockApp(FILES, TAGS);
			// "Root.md" should match prefix "Root" (exact path match)
			const filter: ViewFilter = { type: "folder", value: "Root.md" };
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(new Set(["Root.md"]));
		});
	});

	// ── Leaf: tag ───────────────────────────────────────────────────────

	describe("tag leaf", () => {
		it("matches files with a given tag", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = { type: "tag", value: "#work" };
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(new Set(["Work/project-a.md", "Work/project-b.md"]));
		});

		it("matches hierarchical tags", () => {
			const app = createMockApp(FILES, TAGS);
			// #ml should match both #ml and #ml/transformers
			const filter: ViewFilter = { type: "tag", value: "#ml" };
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(new Set(["Research/ml-paper.md", "Research/deep-learning.md"]));
		});

		it("works with or without # prefix", () => {
			const app = createMockApp(FILES, TAGS);
			const withHash = resolveViewFilter(app, { type: "tag", value: "#research" });
			const withoutHash = resolveViewFilter(app, { type: "tag", value: "research" });

			expect(withHash.paths).toEqual(withoutHash.paths);
			expect(withHash.paths.size).toBe(2);
		});

		it("returns empty for unmatched tag", () => {
			const app = createMockApp(FILES, TAGS);
			const result = resolveViewFilter(app, { type: "tag", value: "#nonexistent" });

			expect(result.paths.size).toBe(0);
		});
	});

	// ── Leaf: extension ─────────────────────────────────────────────────

	describe("extension leaf", () => {
		it("matches files by extension with custom universe", () => {
			const app = createMockApp(FILES, TAGS);
			// Default universe is markdown-only; pass full universe to include pdf
			const universe = new Set(FILES);
			const filter: ViewFilter = { type: "extension", value: "pdf" };
			const result = resolveViewFilter(app, filter, universe);

			expect(result.paths).toEqual(new Set(["Research/notes.pdf"]));
		});

		it("handles dot prefix", () => {
			const app = createMockApp(FILES, TAGS);
			const universe = new Set(FILES);
			const filter: ViewFilter = { type: "extension", value: ".pdf" };
			const result = resolveViewFilter(app, filter, universe);

			expect(result.paths).toEqual(new Set(["Research/notes.pdf"]));
		});

		it("matches all markdown files", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = { type: "extension", value: "md" };
			const result = resolveViewFilter(app, filter);

			// Default universe = getMarkdownFiles() = all .md files
			expect(result.paths.size).toBe(7);
		});
	});

	// ── Leaf: paths (frozen) ────────────────────────────────────────────

	describe("paths leaf", () => {
		it("returns existing paths and reports stale ones", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = {
				type: "paths",
				value: ["Work/project-a.md", "deleted-file.md", "Research/ml-paper.md"],
			};
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(new Set(["Work/project-a.md", "Research/ml-paper.md"]));
			expect(result.stalePaths).toEqual(["deleted-file.md"]);
		});

		it("all paths stale", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = {
				type: "paths",
				value: ["gone1.md", "gone2.md"],
			};
			const result = resolveViewFilter(app, filter);

			expect(result.paths.size).toBe(0);
			expect(result.stalePaths).toEqual(["gone1.md", "gone2.md"]);
		});

		it("empty paths array", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = { type: "paths", value: [] };
			const result = resolveViewFilter(app, filter);

			expect(result.paths.size).toBe(0);
			expect(result.stalePaths).toEqual([]);
		});
	});

	// ── Group: all (AND / intersection) ─────────────────────────────────

	describe("all (AND) group", () => {
		it("intersects folder + tag", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = {
				type: "all",
				conditions: [
					{ type: "folder", value: "Research" },
					{ type: "tag", value: "#ml" },
				],
			};
			const result = resolveViewFilter(app, filter);

			// Research/ml-paper.md has #ml, Research/deep-learning.md has #ml
			// Research/notes.pdf does NOT have #ml
			expect(result.paths).toEqual(
				new Set(["Research/ml-paper.md", "Research/deep-learning.md"]),
			);
		});

		it("intersects three conditions", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = {
				type: "all",
				conditions: [
					{ type: "folder", value: "Work" },
					{ type: "tag", value: "#work" },
					{ type: "tag", value: "#urgent" },
				],
			};
			const result = resolveViewFilter(app, filter);

			// Only project-a has both #work and #urgent
			expect(result.paths).toEqual(new Set(["Work/project-a.md"]));
		});

		it("empty conditions = everything", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = { type: "all", conditions: [] };
			const result = resolveViewFilter(app, filter);

			// All markdown files (universe = getMarkdownFiles)
			expect(result.paths.size).toBe(7);
		});

		it("disjoint conditions = empty result", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = {
				type: "all",
				conditions: [
					{ type: "folder", value: "Work" },
					{ type: "folder", value: "Personal" },
				],
			};
			const result = resolveViewFilter(app, filter);

			expect(result.paths.size).toBe(0);
		});
	});

	// ── Group: any (OR / union) ─────────────────────────────────────────

	describe("any (OR) group", () => {
		it("unions folder + tag", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = {
				type: "any",
				conditions: [
					{ type: "folder", value: "Personal" },
					{ type: "tag", value: "#ml" },
				],
			};
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(
				new Set([
					"Personal/journal.md",
					"Personal/recipes.md",
					"Research/ml-paper.md",
					"Research/deep-learning.md",
				]),
			);
		});

		it("empty conditions = nothing", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = { type: "any", conditions: [] };
			const result = resolveViewFilter(app, filter);

			expect(result.paths.size).toBe(0);
		});
	});

	// ── Group: none (NOT-ANY / complement) ──────────────────────────────

	describe("none (NOT) group", () => {
		it("excludes matching files", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = {
				type: "none",
				conditions: [{ type: "folder", value: "Work" }],
			};
			const result = resolveViewFilter(app, filter);

			// Everything except Work/ files
			expect(result.paths.has("Work/project-a.md")).toBe(false);
			expect(result.paths.has("Work/project-b.md")).toBe(false);
			expect(result.paths.has("Personal/journal.md")).toBe(true);
			expect(result.paths.has("Root.md")).toBe(true);
		});

		it("empty conditions = everything (complement of nothing)", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilterGroup = { type: "none", conditions: [] };
			const result = resolveViewFilter(app, filter);

			// none of nothing = complement of empty set = universe
			expect(result.paths.size).toBe(7);
		});
	});

	// ── Nested (composite) ──────────────────────────────────────────────

	describe("nested composite filters", () => {
		it("all(folder:Research, any(tag:#ml, tag:#research))", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = {
				type: "all",
				conditions: [
					{ type: "folder", value: "Research" },
					{
						type: "any",
						conditions: [
							{ type: "tag", value: "#ml" },
							{ type: "tag", value: "#research" },
						],
					},
				],
			};
			const result = resolveViewFilter(app, filter);

			// Research files with #ml or #research: ml-paper.md, deep-learning.md
			// Research/notes.pdf is not in universe (pdf, not md... wait it IS in files but may not have tags)
			expect(result.paths).toEqual(
				new Set(["Research/ml-paper.md", "Research/deep-learning.md"]),
			);
		});

		it("any(all(folder:Work, tag:#urgent), folder:Personal)", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = {
				type: "any",
				conditions: [
					{
						type: "all",
						conditions: [
							{ type: "folder", value: "Work" },
							{ type: "tag", value: "#urgent" },
						],
					},
					{ type: "folder", value: "Personal" },
				],
			};
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(
				new Set(["Work/project-a.md", "Personal/journal.md", "Personal/recipes.md"]),
			);
		});

		it("collects stale paths from nested frozen leaves", () => {
			const app = createMockApp(FILES, TAGS);
			const filter: ViewFilter = {
				type: "any",
				conditions: [
					{ type: "paths", value: ["Work/project-a.md", "gone1.md"] },
					{ type: "paths", value: ["Personal/journal.md", "gone2.md"] },
				],
			};
			const result = resolveViewFilter(app, filter);

			expect(result.paths).toEqual(
				new Set(["Work/project-a.md", "Personal/journal.md"]),
			);
			expect(result.stalePaths).toEqual(expect.arrayContaining(["gone1.md", "gone2.md"]));
			expect(result.stalePaths).toHaveLength(2);
		});
	});

	// ── Universe parameter ──────────────────────────────────────────────

	describe("custom universe", () => {
		it("restricts resolution to provided universe", () => {
			const app = createMockApp(FILES, TAGS);
			const universe = new Set(["Work/project-a.md", "Work/project-b.md"]);
			const filter: ViewFilter = { type: "tag", value: "#urgent" };
			const result = resolveViewFilter(app, filter, universe);

			// Only project-a has #urgent, and both are in universe
			expect(result.paths).toEqual(new Set(["Work/project-a.md"]));
		});
	});
});

// ---------------------------------------------------------------------------
// describeViewFilter
// ---------------------------------------------------------------------------

describe("describeViewFilter", () => {
	it("describes a folder leaf", () => {
		expect(describeViewFilter({ type: "folder", value: "Work" })).toBe("folder:Work");
	});

	it("describes a tag leaf", () => {
		expect(describeViewFilter({ type: "tag", value: "#ml" })).toBe("tag:#ml");
	});

	it("describes an extension leaf", () => {
		expect(describeViewFilter({ type: "extension", value: "pdf" })).toBe("ext:.pdf");
	});

	it("describes a paths leaf", () => {
		expect(describeViewFilter({ type: "paths", value: ["a.md", "b.md", "c.md"] })).toBe("3 notes");
	});

	it("describes a paths leaf with 1 note", () => {
		expect(describeViewFilter({ type: "paths", value: ["a.md"] })).toBe("1 note");
	});

	it("describes a composite filter", () => {
		const filter: ViewFilter = {
			type: "all",
			conditions: [
				{ type: "folder", value: "Work" },
				{ type: "tag", value: "#ml" },
			],
		};
		expect(describeViewFilter(filter)).toBe("all(folder:Work, tag:#ml)");
	});

	it("describes nested composites", () => {
		const filter: ViewFilter = {
			type: "any",
			conditions: [
				{
					type: "all",
					conditions: [
						{ type: "folder", value: "A" },
						{ type: "tag", value: "#x" },
					],
				},
				{ type: "extension", value: "pdf" },
			],
		};
		expect(describeViewFilter(filter)).toBe("any(all(folder:A, tag:#x), ext:.pdf)");
	});
});

// ---------------------------------------------------------------------------
// getAllMarkdownPaths
// ---------------------------------------------------------------------------

describe("getAllMarkdownPaths", () => {
	it("returns only markdown file paths", () => {
		const app = createMockApp([
			"notes/a.md",
			"notes/b.md",
			"assets/image.png",
			"data.pdf",
		]);
		const paths = getAllMarkdownPaths(app);

		expect(paths).toEqual(new Set(["notes/a.md", "notes/b.md"]));
	});
});
