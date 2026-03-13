import { loadPdfJs } from "obsidian";

export interface PdfExtractResult {
	text: string;
	totalPages: number;
}

/**
 * Extracts all text content from a PDF file using Obsidian's built-in pdfjs.
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
		textParts.push(content.items.map((item: { str: string }) => item.str).join(""));
	}
	return { text: textParts.join("\n"), totalPages };
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
		textParts.push(content.items.map((item: { str: string }) => item.str).join(""));
	}
	return { text: textParts.join("\n"), totalPages };
}
