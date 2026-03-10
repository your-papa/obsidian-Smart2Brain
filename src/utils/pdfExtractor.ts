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
