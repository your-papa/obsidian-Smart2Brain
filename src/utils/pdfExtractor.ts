import { extractText, getDocumentProxy } from "unpdf";

export interface PdfExtractResult {
    text: string;
    totalPages: number;
}

/**
 * Extracts all text content from a PDF file using unpdf.
 * Works in browser/Electron environments without any additional setup.
 *
 * @param data - PDF file content as Uint8Array
 * @returns Extracted text and total page count
 */
export async function extractTextFromPdf(data: Uint8Array): Promise<PdfExtractResult> {
    const pdf = await getDocumentProxy(data);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text: text as string, totalPages };
}
