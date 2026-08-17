import { loadPdfJs } from "obsidian";
import { PDFDocument } from "pdf-lib";

export interface PdfExtractResult {
	text: string;
	totalPages: number;
}

/** A pdfjs text item. `hasEOL` marks the last item on a visual line. */
interface PdfTextItem {
	str: string;
	hasEOL?: boolean;
}

/**
 * Joins pdfjs text items into a line-structured string.
 *
 * pdfjs emits one item per styled run, so items must be separated or words fuse
 * across run boundaries ("Scene" + "Leonard" -> "SceneLeonard"). Items ending a
 * visual line are followed by a newline; the rest are separated by a space
 * unless one side already supplies the whitespace.
 */
export function joinPdfTextItems(items: PdfTextItem[]): string {
	let text = "";
	for (const item of items) {
		if (item.hasEOL) {
			text += `${item.str}\n`;
			continue;
		}
		if (item.str.length === 0) continue;
		const needsSpace = text.length > 0 && !/\s$/.test(text) && !/^\s/.test(item.str);
		text += needsSpace ? ` ${item.str}` : item.str;
	}
	return text.replace(/[ \t]+$/gm, "").trim();
}

/**
 * Extracts all text content from a PDF file using Obsidian's built-in pdfjs.
 *
 * Pages are separated by a blank line so downstream chunking has a paragraph
 * boundary to split on — PDFs have no headings for the chunker to use.
 *
 * @param data - PDF file content as Uint8Array
 * @returns Extracted text and total page count
 */
export async function extractTextFromPdf(data: Uint8Array): Promise<PdfExtractResult> {
	const pdfjsLib = await loadPdfJs();
	const pdf = await pdfjsLib.getDocument({ data }).promise;
	const totalPages = pdf.numPages;
	const textParts: string[] = [];
	for (let i = 1; i <= totalPages; i++) {
		const page = await pdf.getPage(i);
		const content = await page.getTextContent();
		textParts.push(joinPdfTextItems(content.items));
	}
	return { text: textParts.filter((part) => part.length > 0).join("\n\n"), totalPages };
}

export interface PdfPageExtractResult {
	text: string;
	totalPages: number;
}

/**
 * Extracts text from specific pages of a PDF file.
 *
 * @param data - PDF file content as Uint8Array
 * @param pages - Array of 1-indexed page numbers to extract
 * @returns Extracted text from the specified pages and total page count
 */
export async function extractTextFromPdfPages(data: Uint8Array, pages: number[]): Promise<PdfPageExtractResult> {
	const pdfjsLib = await loadPdfJs();
	const pdf = await pdfjsLib.getDocument({ data }).promise;
	const totalPages = pdf.numPages;
	const textParts: string[] = [];
	for (const pageNum of pages) {
		if (pageNum < 1 || pageNum > totalPages) continue;
		const page = await pdf.getPage(pageNum);
		const content = await page.getTextContent();
		textParts.push(joinPdfTextItems(content.items));
	}
	return { text: textParts.filter((part) => part.length > 0).join("\n\n"), totalPages };
}

/**
 * Extracts specific pages from a PDF into a new standalone PDF binary using pdf-lib.
 *
 * @param data - PDF file content as Uint8Array
 * @param pages - Array of 1-indexed page numbers to extract
 * @returns New PDF as Uint8Array containing only the requested pages, total page count,
 *          and which pages were actually included (out-of-range pages are skipped)
 */
export async function extractPdfPages(
	data: Uint8Array,
	pages: number[],
): Promise<{ pdf: Uint8Array; totalPages: number; includedPages: number[] }> {
	const srcDoc = await PDFDocument.load(data);
	const totalPages = srcDoc.getPageCount();

	const validPages = pages.filter((p) => p >= 1 && p <= totalPages);
	if (validPages.length === 0) {
		return { pdf: new Uint8Array(0), totalPages, includedPages: [] };
	}

	const newDoc = await PDFDocument.create();
	// pdf-lib uses 0-indexed page numbers
	const copiedPages = await newDoc.copyPages(
		srcDoc,
		validPages.map((p) => p - 1),
	);
	for (const page of copiedPages) {
		newDoc.addPage(page);
	}

	const pdfBytes = await newDoc.save();
	return { pdf: new Uint8Array(pdfBytes), totalPages, includedPages: validPages };
}
