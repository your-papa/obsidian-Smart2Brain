import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { isImageExtension, isPdfExtension, isTextExtension, resolveVaultFileDetailed } from "../../utils/attachments";
import { extractTextFromPdf } from "../../utils/pdfExtractor";

const MAX_PDF_CHARS = 180_000;

// Minimal interface for the Excalidraw plugin API
interface ExcalidrawAutomate {
    getSceneFromFile(file: TFile): Promise<{
        elements: ExcalidrawElement[];
        appState: unknown;
    }>;
}

interface ExcalidrawElement {
    id?: string;
    type: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    angle?: number;
    text?: string;
    rawText?: string;
    isDeleted?: boolean;
    strokeColor?: string;
    backgroundColor?: string;
    groupIds?: string[];
    boundElements?: Array<{ id: string; type: string }>;
    containerId?: string | null;
    startBinding?: { elementId: string } | null;
    endBinding?: { elementId: string } | null;
    frameId?: string | null;
    link?: string | null;
    label?: { text?: string } | null;
    points?: Array<[number, number]>;
}

interface ExcalidrawPlugin {
    ea?: ExcalidrawAutomate;
}

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

    const normalizedPath = linkPath.toLowerCase();
    const isExcalidrawLink = normalizedPath.endsWith(".excalidraw");
    const isMarkdownLike = !linkPath.includes(".") || normalizedPath.endsWith(".md") || isExcalidrawLink;
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

function isExcalidrawFile(file: TFile): boolean {
    return file.path.endsWith(".excalidraw.md") || file.extension.toLowerCase() === "excalidraw";
}

/**
 * Format a single Excalidraw element into a human-readable description.
 */
function formatElement(el: ExcalidrawElement): string {
    const parts: string[] = [];

    // Type and id
    const label = el.type.charAt(0).toUpperCase() + el.type.slice(1);
    parts.push(`- **${label}**${el.id ? ` (${el.id})` : ""}`);

    // Position and dimensions
    if (el.x != null && el.y != null) {
        parts.push(`  Position: (${Math.round(el.x)}, ${Math.round(el.y)})`);
    }
    if (el.width != null && el.height != null) {
        parts.push(`  Size: ${Math.round(el.width)}×${Math.round(el.height)}`);
    }
    if (el.angle != null && el.angle !== 0) {
        parts.push(`  Rotation: ${Math.round((el.angle * 180) / Math.PI)}°`);
    }

    // Text content
    const text = (el.rawText ?? el.text ?? "").trim();
    if (text) {
        parts.push(`  Text: "${text}"`);
    }

    // Link
    if (el.link) {
        parts.push(`  Link: ${el.link}`);
    }

    // Connections (arrows/lines)
    if (el.startBinding?.elementId || el.endBinding?.elementId) {
        const from = el.startBinding?.elementId ?? "none";
        const to = el.endBinding?.elementId ?? "none";
        parts.push(`  Connects: ${from} → ${to}`);
    }

    // Container reference (text inside a shape)
    if (el.containerId) {
        parts.push(`  Inside container: ${el.containerId}`);
    }

    // Bound elements (shapes that contain text or have arrows)
    if (el.boundElements?.length) {
        const refs = el.boundElements.map((b) => `${b.id} (${b.type})`).join(", ");
        parts.push(`  Bound elements: ${refs}`);
    }

    // Frame membership
    if (el.frameId) {
        parts.push(`  In frame: ${el.frameId}`);
    }

    // Group membership
    if (el.groupIds?.length) {
        parts.push(`  Groups: ${el.groupIds.join(", ")}`);
    }

    // Colors (only if non-default)
    if (el.strokeColor && el.strokeColor !== "#1e1e1e" && el.strokeColor !== "#000000") {
        parts.push(`  Stroke: ${el.strokeColor}`);
    }
    if (el.backgroundColor && el.backgroundColor !== "transparent") {
        parts.push(`  Fill: ${el.backgroundColor}`);
    }

    return parts.join("\n");
}

/**
 * Build a scene summary from an array of Excalidraw elements.
 * Includes element types, positions, dimensions, text, and connections.
 */
function formatSceneDescription(elements: ExcalidrawElement[]): string {
    const activeElements = elements.filter((el) => !el.isDeleted);
    if (activeElements.length === 0) return "";

    // Count by type
    const typeCounts = new Map<string, number>();
    for (const el of activeElements) {
        typeCounts.set(el.type, (typeCounts.get(el.type) ?? 0) + 1);
    }
    const summary = [...typeCounts.entries()]
        .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
        .join(", ");

    const lines: string[] = [];
    lines.push(`Scene summary: ${activeElements.length} elements (${summary})\n`);
    lines.push("## Elements\n");

    for (const el of activeElements) {
        lines.push(formatElement(el));
    }

    return lines.join("\n");
}

/**
 * Parse Excalidraw JSON from file content (from %% comment block or ```json code block).
 * Returns the full elements array, or an empty array if parsing fails.
 */
function parseExcalidrawElements(content: string): ExcalidrawElement[] {
    // Try %% comment block first (canonical data source)
    const commentMatch = content.match(/%%\n([\s\S]*?)\n%%/);
    let jsonStr = commentMatch?.[1];

    // Fall back to ```json code block
    if (!jsonStr) {
        const codeBlockMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
        jsonStr = codeBlockMatch?.[1];
    }

    if (!jsonStr) return [];

    try {
        const parsed = JSON.parse(jsonStr);
        const elements = parsed?.elements ?? parsed;
        if (!Array.isArray(elements)) return [];
        return elements as ExcalidrawElement[];
    } catch {
        return [];
    }
}

/**
 * Try using the Excalidraw plugin API to get scene elements.
 * Returns null if the plugin is not available or the API call fails.
 */
async function getElementsViaPluginApi(app: App, file: TFile): Promise<ExcalidrawElement[] | null> {
    try {
        // @ts-ignore - Dynamic access to plugins
        const excalidrawPlugin = app.plugins?.plugins?.["obsidian-excalidraw-plugin"] as ExcalidrawPlugin | undefined;
        const ea = excalidrawPlugin?.ea;
        if (!ea?.getSceneFromFile) return null;

        const scene = await ea.getSceneFromFile(file);
        if (!scene?.elements?.length) return null;

        return scene.elements;
    } catch {
        return null;
    }
}

/**
 * Read and describe the full content of an Excalidraw drawing file.
 * Includes all element types, positions, dimensions, text, and connections.
 * Strategy: try plugin API first, then parse JSON from file content.
 */
async function readExcalidrawContent(app: App, file: TFile, maxLength: number): Promise<string> {
    // Tier 1: Try the Excalidraw plugin API
    const apiElements = await getElementsViaPluginApi(app, file);
    if (apiElements?.length) {
        const description = formatSceneDescription(apiElements);
        if (description) {
            const result = maxLength > 0 ? truncateContent(description, maxLength) : description;
            return `Content of Excalidraw drawing "${file.path}" (extracted via plugin API):\n\n${result}`;
        }
    }

    // Tier 2: Parse the file content directly
    const content = await app.vault.read(file);
    const elements = parseExcalidrawElements(content);

    if (elements.length > 0) {
        const description = formatSceneDescription(elements);
        if (description) {
            const result = maxLength > 0 ? truncateContent(description, maxLength) : description;
            return `Content of Excalidraw drawing "${file.path}":\n\n${result}`;
        }
    }

    return `Excalidraw drawing "${file.path}" contains no elements. The drawing appears to be empty.`;
}

export function createReadContentTool(app: App) {
    const pluginData = getData();
    const defaultToolConfig = DEFAULT_TOOLS_CONFIG.read_content;
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

            if (isExcalidrawFile(file)) {
                const currentConfig = getToolConfig();
                const settings = currentConfig?.settings as { maxContentLength?: number } | undefined;
                const maxLength = settings?.maxContentLength ?? 0;
                return await readExcalidrawContent(app, file, maxLength);
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
        name: toolConfig?.name ?? defaultToolConfig.name,
        description: toolConfig?.description ?? defaultToolConfig.description,
        schema: z.object({
            path: z
                .string()
                .describe("File reference as full path or wiki link (e.g., 'folder/note.md', '[[Note Name]]', or '![[docs/report.pdf]]')."),
        }),
    });
}
