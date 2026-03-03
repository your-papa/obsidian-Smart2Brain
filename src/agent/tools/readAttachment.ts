import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";
import {
    isImageExtension,
    isPdfExtension,
    isTextExtension,
    resolveVaultFile,
} from "../../utils/attachments";
import { extractTextFromPdf } from "../../utils/pdfExtractor";

/**
 * Tool for reading PDFs and text documents from the vault.
 *
 * - PDFs: returns extracted text content (via unpdf) for all providers
 * - Text files (.md, .txt, .csv, .json): returns the raw text content
 * - Images: not supported here — users should attach images directly in chat
 *   for proper multimodal processing via vision-capable models.
 */
export function createReadAttachmentTool(app: App) {
    const pluginData = getData();
    const toolConfig = pluginData.getToolConfig("read_attachment");

    const readAttachmentFn = async ({ path }: { path: string }): Promise<string> => {
        const file = resolveVaultFile(app, path);

        if (!file) {
            return `Error: File not found at path "${path}". Make sure the path is correct (e.g., "attachments/image.png" or just "image.png").`;
        }

        if (!(file instanceof TFile)) {
            return `Error: Path "${path}" is not a file`;
        }

        const ext = file.extension.toLowerCase();

        try {
            if (isImageExtension(ext)) {
                return `Cannot read image "${file.name}" through this tool. Images must be attached directly in the chat input for visual analysis. Ask the user to attach the image in their next message, or describe what you need from the image so the user can help.`;
            }

            if (isPdfExtension(ext)) {
                const buffer = await app.vault.readBinary(file);
                const data = new Uint8Array(buffer);

                // Extract text for all providers
                const { text, totalPages } = await extractTextFromPdf(data);

                if (!text.trim()) {
                    return `PDF "${file.name}" contains ${totalPages} page(s) but no extractable text. The PDF may contain only images/scans.`;
                }

                return `Content of PDF "${file.name}" (${totalPages} pages):\n\n${text}`;
            }

            if (isTextExtension(ext)) {
                const content = await app.vault.read(file);
                return `Content of "${file.name}":\n\n${content}`;
            }

            return `Error: Unsupported file type ".${ext}". This tool supports PDFs and text documents (md, txt, csv, json). For images, ask the user to attach them directly in the chat input.`;
        } catch (error) {
            return `Error reading file "${path}": ${error instanceof Error ? error.message : String(error)}`;
        }
    };

    return tool(readAttachmentFn, {
        name: toolConfig?.name ?? "read_attachment",
        description:
            toolConfig?.description ??
            "Read a PDF or text file from the vault. For PDFs, extracts and returns the text content. For text files (.md, .txt, .csv, .json), returns the raw content. Use this when you encounter media embeds like ![[document.pdf]] or ![[notes.md]] in notes. Does NOT support images — images must be attached directly in the chat input by the user for visual analysis.",
        schema: z.object({
            path: z.string().describe("The file path of the file to read (e.g., 'attachments/photo.png', 'docs/report.pdf', 'notes/readme.md', or just 'data.csv')"),
        }),
    });
}
