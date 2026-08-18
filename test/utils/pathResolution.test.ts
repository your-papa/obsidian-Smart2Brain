import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

import { TFile, type App } from "obsidian";
import {
	extractReferenceInfo,
	normalizeReferencePath,
	resolveFileReferenceDetailed,
	resolveMarkdownFileDetailed,
	resolveVaultFileDetailed,
} from "../../src/utils/pathResolution";

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.basename = file.name.replace(/\.[^.]+$/, "");
	file.extension = file.name.includes(".") ? (file.name.split(".").pop() ?? "") : "";
	return file;
}

function createMockApp(files: TFile[]): App {
	const byPath = new Map(files.map((f) => [f.path, f]));
	const markdownFiles = files.filter((f) => f.extension.toLowerCase() === "md");

	return {
		vault: {
			getFiles: vi.fn().mockReturnValue(files),
			getMarkdownFiles: vi.fn().mockReturnValue(markdownFiles),
			getAbstractFileByPath: vi.fn((path: string) => byPath.get(path) ?? null),
		},
		metadataCache: {
			getFirstLinkpathDest: vi.fn().mockReturnValue(null),
		},
	} as unknown as App;
}

describe("pathResolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("extracts path and subpath from wiki links", () => {
		expect(extractReferenceInfo("[[Projects/Plan#Section|Roadmap]]")).toEqual({
			path: "Projects/Plan",
			subpath: "#Section",
		});
		expect(normalizeReferencePath("![[docs/spec.pdf#page=2-3]]")).toBe("docs/spec.pdf");
	});

	it("resolves exact and ambiguous generic file references", () => {
		const app = createMockApp([
			makeFile("Projects/Plan.md"),
			makeFile("Archive/Plan.md"),
			makeFile("assets/diagram.png"),
		]);

		expect(resolveVaultFileDetailed(app, "assets/diagram.png").status).toBe("found");
		expect(resolveVaultFileDetailed(app, "Plan.md").status).toBe("ambiguous");
		expect(resolveVaultFileDetailed(app, "missing.md").status).toBe("not_found");
	});

	it("resolves markdown references with markdown-only ambiguity", () => {
		const app = createMockApp([
			makeFile("Projects/Meeting.md"),
			makeFile("Archive/Meeting.md"),
			makeFile("assets/Meeting.png"),
		]);

		const resolved = resolveMarkdownFileDetailed(app, "[[Meeting]]");
		expect(resolved.status).toBe("ambiguous");
		if (resolved.status === "ambiguous") {
			expect(resolved.candidates).toEqual(["Projects/Meeting.md", "Archive/Meeting.md"]);
		}
	});

	it("uses markdown-first behavior for extensionless references", () => {
		const app = createMockApp([makeFile("Projects/Overview.md"), makeFile("assets/Overview.png")]);
		const resolved = resolveFileReferenceDetailed(app, "[[Overview]]");
		expect(resolved.status).toBe("found");
		if (resolved.status === "found") {
			expect(resolved.file.path).toBe("Projects/Overview.md");
		}
	});
});
