import { describe, expect, it, vi } from "vitest";
import { extractTextFromPdf, joinPdfTextItems } from "../../src/utils/pdfExtractor";

const loadPdfJs = vi.fn();
vi.mock("obsidian", () => ({ loadPdfJs: () => loadPdfJs() }));

/** Builds a fake pdfjs module whose getDocument yields the given page strings. */
function fakePdfjs(pageStrings: string[], workerSrc = "/lib/pdfjs/pdf.worker.min.mjs") {
	const destroy = vi.fn().mockResolvedValue(undefined);
	let getDocumentParams: Record<string, unknown> | undefined;
	const getDocument = vi.fn((params: Record<string, unknown>) => {
		getDocumentParams = params;
		return {
			promise: Promise.resolve({
				numPages: pageStrings.length,
				getPage: (i: number) =>
					Promise.resolve({
						getTextContent: () => Promise.resolve({ items: [{ str: pageStrings[i - 1], hasEOL: true }] }),
					}),
				destroy,
			}),
		};
	});
	return {
		lib: { getDocument, GlobalWorkerOptions: { workerSrc } },
		destroy,
		getParams: () => getDocumentParams,
	};
}

describe("extractTextFromPdf", () => {
	it("destroys the document after extraction to release worker memory", async () => {
		const { lib, destroy } = fakePdfjs(["page one", "page two"]);
		loadPdfJs.mockResolvedValue(lib);

		const { text, totalPages } = await extractTextFromPdf(new Uint8Array());

		expect(totalPages).toBe(2);
		expect(text).toBe("page one\n\npage two");
		expect(destroy).toHaveBeenCalledOnce();
	});

	it("destroys the document even when a page throws", async () => {
		const destroy = vi.fn().mockResolvedValue(undefined);
		const lib = {
			GlobalWorkerOptions: { workerSrc: "/lib/pdfjs/pdf.worker.min.mjs" },
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 1,
					getPage: () => Promise.reject(new Error("corrupt page")),
					destroy,
				}),
			}),
		};
		loadPdfJs.mockResolvedValue(lib);

		await expect(extractTextFromPdf(new Uint8Array())).rejects.toThrow("corrupt page");
		expect(destroy).toHaveBeenCalledOnce();
	});

	it("passes standard-font and cmap URLs derived from the worker path", async () => {
		const { lib, getParams } = fakePdfjs(["x"]);
		loadPdfJs.mockResolvedValue(lib);

		await extractTextFromPdf(new Uint8Array());

		expect(getParams()).toMatchObject({
			standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
			cMapUrl: "/lib/pdfjs/cmaps/",
			cMapPacked: true,
		});
	});

	it("omits asset URLs when the worker source is unknown", async () => {
		const { lib, getParams } = fakePdfjs(["x"], "");
		loadPdfJs.mockResolvedValue(lib);

		await extractTextFromPdf(new Uint8Array());

		const params = getParams() ?? {};
		expect(params).not.toHaveProperty("standardFontDataUrl");
		expect(params).not.toHaveProperty("cMapUrl");
	});
});

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
