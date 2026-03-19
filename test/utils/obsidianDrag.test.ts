import { describe, expect, it } from "vitest";
import { extractObsidianDraggedPaths, hasObsidianFileDrag } from "../../src/utils/obsidianDrag";

function createDataTransferMock(data: Record<string, string>, types?: string[]) {
	return {
		types: types ?? Object.keys(data),
		getData(type: string) {
			return data[type] ?? "";
		},
	} as Pick<DataTransfer, "getData" | "types">;
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
});
