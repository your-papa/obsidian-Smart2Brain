import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";
import { isImageExtension, isPdfExtension, isTextExtension, resolveVaultFileDetailed } from "../../utils/attachments";
import { extractTextFromPdf } from "../../utils/pdfExtractor";

const MAX_PDF_CHARS = 180_000;

function truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) return content;
    return `${content.slice(0, maxChars)}\n\n[...truncated ${content.length - maxChars} characters to fit context limits...]`;
}

function extractLinkPath(input: string): string {
    const trimmed = input.trim();
    let inner = trimmed;

    if (trimmed.startsWith("![[") && trimmed.endsWith("]]")) {
        inner = trimmed.slice(3, -2).trim();
    } else if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
        inner = trimmed.slice(2, -2).trim();
    }

    const withoutAlias = inner.split("|")[0]?.trim() ?? "";
    const withoutHeading = withoutAlias.split("#")[0]?.trim() ?? "";
    return withoutHeading;
}

function tryExactMarkdownPath(app: App, path: string): TFile | null {
    const exact = app.vault.getAbstractFileByPath(path);
    if (exact instanceof TFile) {
        return exact;
    }

    if (!path.endsWith(".md")) {
        const withMd = app.vault.getAbstractFileByPath(`${path}.md`);
        if (withMd instanceof TFile) {
            return withMd;
        }
    }

    return null;
}

function resolveMarkdownNote(app: App, pathOrWikiLink: string): { file: TFile | null; error?: string } {
    const linkPath = extractLinkPath(pathOrWikiLink);
    if (!linkPath) {
        return { file: null, error: "Error: Path is empty. Provide a file path or wiki link like [[Note Name]]." };
    }

    const exact = tryExactMarkdownPath(app, linkPath);
    if (exact?.extension.toLowerCase() === "md") {
        return { file: exact };
    }

    const linkResolved =
        app.metadataCache.getFirstLinkpathDest(linkPath, "") ??
        (linkPath.endsWith(".md")
            ? app.metadataCache.getFirstLinkpathDest(linkPath.slice(0, -3), "")
            : app.metadataCache.getFirstLinkpathDest(`${linkPath}.md`, ""));

    if (linkResolved instanceof TFile && linkResolved.extension.toLowerCase() === "md") {
        return { file: linkResolved };
    }

    const normalizedTarget = linkPath.toLowerCase();
    const markdownFiles = app.vault.getMarkdownFiles();
    const basenameMatches = markdownFiles.filter((file) => file.basename.toLowerCase() === normalizedTarget);

    if (basenameMatches.length === 1) {
        return { file: basenameMatches[0] };
    }

    if (basenameMatches.length > 1) {
        const matchList = basenameMatches.slice(0, 5).map((file) => `- ${file.path}`).join("\n");
        const suffix = basenameMatches.length > 5 ? "\n- ..." : "";
        return {
            file: null,
            error: `Error: Wiki link "${linkPath}" is ambiguous. Use a full path.\nPossible matches:\n${matchList}${suffix}`,
        };
    }

    return { file: null };
}

function resolveAnyFile(app: App, rawPath: string): { file: TFile | null; error?: string } {
    const linkPath = extractLinkPath(rawPath);
    if (!linkPath) {
        return { file: null, error: "Error: Path is empty. Provide a file path or wiki link." };
    }

    const isMarkdownLike = !linkPath.includes(".") || linkPath.toLowerCase().endsWith(".md");
    if (isMarkdownLike) {
        const resolvedMarkdown = resolveMarkdownNote(app, linkPath);
        if (resolvedMarkdown.file) {
            return resolvedMarkdown;
        }
        if (resolvedMarkdown.error) {
            return resolvedMarkdown;
        }
    }

    const resolved = resolveVaultFileDetailed(app, linkPath);
    if (resolved.status === "ambiguous") {
        const candidates = resolved.candidates.slice(0, 5).join(", ");
        const suffix = resolved.candidates.length > 5 ? `, and ${resolved.candidates.length - 5} more` : "";
        return {
            file: null,
            error: `Error: Multiple files match "${rawPath}". Please use a more specific path. Matches: ${candidates}${suffix}.`,
        };
    }

    if (resolved.status === "not_found") {
        return {
            file: null,
            error: `Error: File not found for "${rawPath}"`,
        };
    }

    return { file: resolved.file };
}

export function createReadContentTool(app: App) {
    const pluginData = getData();
    const getToolConfig = () => pluginData.getSelectedAgent().toolsConfig.read_content;

    const readContentFn = async ({ path }: { path: string }): Promise<string> => {
        const resolved = resolveAnyFile(app, path);
        if (!resolved.file) {
            return resolved.error ?? `Error: File not found for "${path}"`;
        }

        const file = resolved.file;
        const ext = file.extension.toLowerCase();

        try {
            if (isImageExtension(ext)) {
                return `Cannot read image "${file.name}" through this tool. Images must be attached directly in the chat input for visual analysis. Ask the user to attach the image in their next message, or describe what you need from the image so the user can help.`;
            }

            if (isPdfExtension(ext)) {
                const buffer = await app.vault.readBinary(file);
                const data = new Uint8Array(buffer);
                const { text, totalPages } = await extractTextFromPdf(data);

                if (!text.trim()) {
                    return `PDF "${file.name}" contains ${totalPages} page(s) but no extractable text. The PDF may contain only images/scans.`;
                }

                const truncated = truncateContent(text, MAX_PDF_CHARS);
                return `Content of PDF "${file.name}" (${totalPages} pages):\n\n${truncated}`;
            }

            if (isTextExtension(ext)) {
                const content = await app.vault.read(file);
                const currentConfig = getToolConfig();
                const settings = currentConfig?.settings as { maxContentLength?: number } | undefined;
                const maxLength = settings?.maxContentLength ?? 0;

                if (maxLength > 0 && content.length > maxLength) {
                    return `Content of "${file.path}":\n\n${content.slice(0, maxLength)}\n\n... [Content truncated at ${maxLength} characters]`;
                }

                return `Content of "${file.path}":\n\n${content}`;
            }

            return `Error: Unsupported file type ".${ext}". This tool supports notes, PDFs, and text documents (md, txt, csv, json). For images, ask the user to attach them directly in the chat input.`;
        } catch (error) {
            return `Error reading file "${path}": ${error instanceof Error ? error.message : String(error)}`;
        }
    };

    const toolConfig = getToolConfig();

    return tool(readContentFn, {
        name: toolConfig?.name ?? "read_content",
        description:
            toolConfig?.description ??
            "Read the full content of notes and vault files by path or wiki link (e.g., [[Daily Note]] or ![[report.pdf]]). Supports markdown and text files (.md, .txt, .csv, .json), and extracts text from PDFs. Images are not supported and must be attached directly in chat.",
        schema: z.object({
            path: z
                .string()
                .describe("File reference as full path or wiki link (e.g., 'folder/note.md', '[[Note Name]]', or '![[docs/report.pdf]]')."),
        }),
    });
}
