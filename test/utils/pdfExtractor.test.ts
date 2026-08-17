import { describe, expect, it } from "vitest";
import { joinPdfTextItems } from "../../src/utils/pdfExtractor";

describe("joinPdfTextItems", () => {
	it("separates adjacent items so words do not fuse", () => {
		expect(joinPdfTextItems([{ str: "Scene" }, { str: "Leonard" }])).toBe("Scene Leonard");
	});

	it("breaks the line on hasEOL", () => {
		const items = [{ str: "Title:", hasEOL: true }, { str: "Subtitle" }];
		expect(joinPdfTextItems(items)).toBe("Title:\nSubtitle");
	});

	it("does not double up whitespace already supplied by an item", () => {
		expect(joinPdfTextItems([{ str: "one " }, { str: "two" }])).toBe("one two");
		expect(joinPdfTextItems([{ str: "one" }, { str: " two" }])).toBe("one two");
	});

	it("keeps a hyphenated run intact rather than inserting a space", () => {
		expect(joinPdfTextItems([{ str: "state-" }, { str: "of-the-art" }])).toBe("state- of-the-art");
	});

	it("skips empty items without emitting stray separators", () => {
		expect(joinPdfTextItems([{ str: "a" }, { str: "" }, { str: "b" }])).toBe("a b");
	});

	it("emits a line break for an empty item that ends a line", () => {
		const items = [{ str: "a" }, { str: "", hasEOL: true }, { str: "b" }];
		expect(joinPdfTextItems(items)).toBe("a\nb");
	});

	it("trims trailing whitespace per line but keeps leading indentation", () => {
		const items = [{ str: "heading   ", hasEOL: true }, { str: "  body  " }];
		expect(joinPdfTextItems(items)).toBe("heading\n  body");
	});

	it("returns an empty string for no items", () => {
		expect(joinPdfTextItems([])).toBe("");
	});
});
