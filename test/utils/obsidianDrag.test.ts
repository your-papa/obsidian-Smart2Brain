import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { extractObsidianDraggedPaths, hasObsidianFileDrag } from "../../src/utils/obsidianDrag";

function createDataTransferMock(data: Record<string, string>, types?: string[]) {
	return {
		types: types ?? Object.keys(data),
		getData(type: string) {
			return data[type] ?? "";
		},
	} as Pick<DataTransfer, "getData" | "types">;
}

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

/** Minimal App stub exposing just the bits obsidianDrag reads. */
function createAppMock(options: {
	draggable?: { type?: string; file?: unknown; files?: unknown } | null;
	resolve?: Record<string, TFile>;
}) {
	return {
		dragManager: { draggable: options.draggable ?? null },
		metadataCache: {
			getFirstLinkpathDest(linkpath: string) {
				return options.resolve?.[linkpath] ?? null;
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: test stub for the Obsidian App
	} as any;
}

describe("obsidianDrag", () => {
	it("detects Obsidian file drag types", () => {
		const transfer = createDataTransferMock({}, ["text/plain", "obsidian/files"]);

		expect(hasObsidianFileDrag(transfer)).toBe(true);
	});

	it("extracts multi-file payloads and preserves order", () => {
		const transfer = createDataTransferMock({
			"obsidian/files": JSON.stringify(["Notes/One.md", "Notes/Two.md"]),
		});

		expect(extractObsidianDraggedPaths(transfer)).toEqual(["Notes/One.md", "Notes/Two.md"]);
	});

	it("merges single and multi payloads without duplicates", () => {
		const transfer = createDataTransferMock({
			"obsidian/files": JSON.stringify(["Notes/One.md", "Notes/Two.md"]),
			"obsidian/file": "Notes/One.md",
		});

		expect(extractObsidianDraggedPaths(transfer)).toEqual(["Notes/One.md", "Notes/Two.md"]);
	});

	it("ignores malformed payloads", () => {
		const transfer = createDataTransferMock({
			"obsidian/files": "{bad json}",
			"obsidian/file": "",
		});

		expect(extractObsidianDraggedPaths(transfer)).toEqual([]);
	});

	it("detects an internal drag via app.dragManager.draggable (no MIME types)", () => {
		// Recent Obsidian omits obsidian/file MIME types; detection must use dragManager.
		const transfer = createDataTransferMock({}, ["text/plain", "text/uri-list"]);
		const app = createAppMock({ draggable: { type: "file", file: makeFile("Notes/One.md") } });

		expect(hasObsidianFileDrag(transfer, app)).toBe(true);
	});

	it("extracts the path from a single-file draggable", () => {
		const app = createAppMock({ draggable: { type: "file", file: makeFile("Notes/One.md") } });

		expect(extractObsidianDraggedPaths(null, app)).toEqual(["Notes/One.md"]);
	});

	it("extracts paths from a multi-file draggable", () => {
		const app = createAppMock({
			draggable: { type: "files", files: [makeFile("Notes/One.md"), makeFile("Notes/Two.md")] },
		});

		expect(extractObsidianDraggedPaths(null, app)).toEqual(["Notes/One.md", "Notes/Two.md"]);
	});

	it("excludes folders from a draggable (only TFiles yield paths)", () => {
		const folder = new TFolder();
		folder.path = "Notes";
		const app = createAppMock({ draggable: { type: "folder", file: folder } });

		expect(extractObsidianDraggedPaths(null, app)).toEqual([]);
	});

	it("falls back to the obsidian:// URI in text data when no draggable/MIME exists", () => {
		const resolved = makeFile("Notes/One.md");
		const transfer = createDataTransferMock({ "text/plain": "obsidian://open?vault=Test&file=One" }, [
			"text/plain",
		]);
		const app = createAppMock({ draggable: null, resolve: { One: resolved } });

		expect(extractObsidianDraggedPaths(transfer, app)).toEqual(["Notes/One.md"]);
	});

	it("prefers the draggable over the URI fallback", () => {
		const transfer = createDataTransferMock({ "text/plain": "obsidian://open?vault=Test&file=Two" }, [
			"text/plain",
		]);
		const app = createAppMock({
			draggable: { type: "file", file: makeFile("Notes/One.md") },
			resolve: { Two: makeFile("Notes/Two.md") },
		});

		expect(extractObsidianDraggedPaths(transfer, app)).toEqual(["Notes/One.md"]);
	});
});
