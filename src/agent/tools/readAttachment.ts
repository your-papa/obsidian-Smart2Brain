import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";
import {
    isImageExtension,
    isPdfExtension,
    isTextExtension,
    mimeFromExtension,
    resolveVaultFile,
    toBase64DataUri,
} from "../../utils/attachments";
import { extractTextFromPdf } from "../../utils/pdfExtractor";

interface ReadAttachmentContext {
    /** Returns true if the currently selected model supports vision/image input */
    supportsVision: () => boolean;
    /** Returns the current provider ID (e.g., "anthropic", "openai") */
    getProviderId: () => string;
}

/**
 * Tool for reading images, PDFs, and text documents from the vault.
 *
 * - Images: returns a base64 data URI (if model supports vision) or an error message
 * - PDFs: returns extracted text content (via unpdf) for all providers
 * - Text files (.md, .txt, .csv): returns the raw text content
 */
export function createReadAttachmentTool(app: App, context: ReadAttachmentContext) {
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
                if (!context.supportsVision()) {
                    return `Error: The currently selected model does not support vision/image input. Cannot process image "${path}". Please ask the user to switch to a vision-capable model (e.g., GPT-4o, Claude Sonnet, or an Ollama model with vision support).`;
                }

                const buffer = await app.vault.readBinary(file);
                const mime = mimeFromExtension(ext);
                const dataUri = toBase64DataUri(buffer, mime);

                // Return as a structured string the agent can relay
                return `[Image loaded: ${file.name} (${mime}, ${Math.round(buffer.byteLength / 1024)}KB)]\n\nData URI: ${dataUri}`;
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

            return `Error: Unsupported file type ".${ext}". This tool supports images (png, jpg, jpeg, gif, webp), PDFs, and text documents (md, txt, csv, json).`;
        } catch (error) {
            return `Error reading file "${path}": ${error instanceof Error ? error.message : String(error)}`;
        }
    };

    return tool(readAttachmentFn, {
        name: toolConfig?.name ?? "read_attachment",
        description:
            toolConfig?.description ??
            "Read an image, PDF, or text file from the vault. For images, returns the image data (requires a vision-capable model). For PDFs, extracts and returns the text content. For text files (.md, .txt, .csv, .json), returns the raw content. Use this when you encounter media embeds like ![[image.png]], ![[document.pdf]], or ![[notes.md]] in notes and need to analyze their content.",
        schema: z.object({
            path: z.string().describe("The file path of the file to read (e.g., 'attachments/photo.png', 'docs/report.pdf', 'notes/readme.md', or just 'data.csv')"),
        }),
    });
}
