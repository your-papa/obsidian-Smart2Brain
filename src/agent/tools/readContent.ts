import { type App, TFile, resolveSubpath } from "obsidian";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import {
	DEFAULT_TOOLS_CONFIG,
	READ_CONTENT_DESC_DEFAULTS,
	getData,
	getReadContentDescription,
} from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import {
	isImageExtension,
	isPdfExtension,
	isTextExtension,
	mimeFromExtension,
	toBase64,
	toBase64DataUri,
} from "../../utils/attachments";
import { extractPdfPages, extractTextFromPdf, extractTextFromPdfPages } from "../../utils/pdfExtractor";
import { Logger } from "../../utils/logging";
import { extractReferenceInfo, resolveFileReferenceDetailed } from "../../utils/pathResolution";

const MAX_PDF_CHARS = 180_000;

/** Extract text from a LangChain chat model response (handles both string and structured content). */
function extractTextContent(response: { content: string | Array<Record<string, unknown>> }): string {
	if (typeof response.content === "string") return response.content;
	return (response.content as Array<Record<string, unknown>>)
		.filter((c): c is { type: "text"; text: string } => typeof c === "object" && "text" in c)
		.map((c) => c.text)
		.join("\n");
}

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

/**
 * Parses a PDF page fragment into an array of 1-indexed page numbers.
 * Supports: #page=3, #page=3-5, #page=1,3,5, #page=1-3,7,9-11
 */
function parsePdfPageFragment(subpath: string): number[] | null {
	if (!subpath) return null;
	const match = subpath.match(/^#page=([\d,\-]+)$/);
	if (!match) return null;

	const pages: number[] = [];
	for (const part of match[1].split(",")) {
		const range = part.match(/^(\d+)-(\d+)$/);
		if (range) {
			const start = Number.parseInt(range[1], 10);
			const end = Number.parseInt(range[2], 10);
			if (Number.isNaN(start) || Number.isNaN(end)) continue;
			for (let i = start; i <= end; i++) pages.push(i);
		} else {
			const n = Number.parseInt(part, 10);
			if (!Number.isNaN(n)) pages.push(n);
		}
	}
	// Deduplicate and sort
	return [...new Set(pages)].sort((a, b) => a - b);
}

function extractSubpathContent(
	app: App,
	file: TFile,
	content: string,
	subpath: string,
): { text: string; label: string; error?: undefined } | { error: string; text?: undefined; label?: undefined } {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) {
		return { error: `Error: No cached metadata available for "${file.path}". The file may not be indexed yet.` };
	}

	const result = resolveSubpath(cache, subpath);
	if (!result) {
		const available: string[] = [];
		if (cache.headings?.length) {
			available.push(
				"Headings:\n" + cache.headings.map((h) => `  ${"#".repeat(h.level)} ${h.heading}`).join("\n"),
			);
		}
		if (cache.blocks && Object.keys(cache.blocks).length > 0) {
			available.push(
				"Block IDs:\n" +
					Object.keys(cache.blocks)
						.map((id) => `  ^${id}`)
						.join("\n"),
			);
		}
		const availableStr = available.length > 0 ? `\nAvailable targets:\n${available.join("\n")}` : "";
		return {
			error: `Error: Could not resolve "${subpath}" in "${file.path}".${availableStr}`,
		};
	}

	const startOffset = result.start.offset;
	const endOffset = result.end?.offset ?? content.length;
	const text = content.slice(startOffset, endOffset).trim();

	const label = result.type === "heading" ? `section "${subpath.slice(1)}"` : `block ${subpath}`;
	return { text, label };
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
	const text = (el.rawText || el.text || el.label?.text || "").trim();
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
	const commentMatch = content.match(/%%\r?\n([\s\S]*?)\r?\n%%/);
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

export function createReadContentTool(app: App, imageProcessor?: BaseChatModel, pdfProcessor?: BaseChatModel) {
	const pluginData = getData();
	const defaultToolConfig = DEFAULT_TOOLS_CONFIG.read_content;
	const getToolConfig = () => pluginData.getSelectedAgent().toolsConfig.read_content;

	const readContentFn = async ({ path }: { path: string }): Promise<string> => {
		const { subpath, path: normalizedPath } = extractReferenceInfo(path);
		if (!normalizedPath) {
			return "Error: Path is empty. Provide a file path or wiki link.";
		}

		const resolved = resolveFileReferenceDetailed(app, path);
		if (resolved.status === "not_found") {
			return `Error: File not found for "${path}"`;
		}
		if (resolved.status === "ambiguous") {
			const candidates = resolved.candidates.slice(0, 5).join(", ");
			const suffix = resolved.candidates.length > 5 ? `, and ${resolved.candidates.length - 5} more` : "";
			return `Error: Multiple files match "${path}". Please use a more specific path. Matches: ${candidates}${suffix}.`;
		}

		const file = resolved.file;
		const ext = file.extension.toLowerCase();

		// Privacy check
		const currentProvider = pluginData.getSelectedAgent().chatModel?.provider;
		if (currentProvider) {
			const store = getPendingChangesStore();
			if (store.shouldBlockFile(file.path, currentProvider)) {
				return `Error: The file "${file.path}" is marked as private and cannot be processed by the current provider. Switch to a trusted provider or remove the file from the privacy list.`;
			}
		}

		try {
			if (isImageExtension(ext)) {
				if (!imageProcessor) {
					return `Cannot read image "${file.name}" through this tool. Images must be attached directly in the chat input for visual analysis. Ask the user to attach the image in their next message, or describe what you need from the image so the user can help.`;
				}

				// Privacy check against the image processor's provider
				const processorSettings = pluginData.getSelectedAgent().toolsConfig.read_content?.settings as
					| { imageProcessor?: { provider?: string } }
					| undefined;
				const processorProvider = processorSettings?.imageProcessor?.provider;
				if (processorProvider) {
					const store = getPendingChangesStore();
					if (store.shouldBlockFile(file.path, processorProvider)) {
						return `Error: The file "${file.path}" is marked as private and cannot be processed by the image processor's provider. Switch to a trusted provider or remove the file from the privacy list.`;
					}
				}

				try {
					const buffer = await app.vault.readBinary(file);
					const mime = mimeFromExtension(ext);
					const dataUri = toBase64DataUri(buffer, mime);
					Logger.log(`[read_content] Analyzing image "${file.name}" via vision model`);
					const response = await imageProcessor.invoke([
						new HumanMessage({
							content: [
								{
									type: "image_url",
									image_url: { url: dataUri },
								},
								{
									type: "text",
									text: "Describe this image in detail, including all visible text, data, labels, and visual elements.",
								},
							],
						}),
					]);
					return `[Analyzed via vision model] Image description of "${file.name}":\n\n${extractTextContent(response)}`;
				} catch (error) {
					Logger.error(`[read_content] Image processor failed for "${file.name}"`, error);
					return `Error: Failed to analyze image "${file.name}" via vision model: ${error instanceof Error ? error.message : String(error)}. Ask the user to attach the image directly in the chat input instead.`;
				}
			}

			if (isPdfExtension(ext)) {
				const buffer = await app.vault.readBinary(file);
				const pageNums = parsePdfPageFragment(subpath);

				if (pdfProcessor) {
					// Privacy check against the PDF processor's provider
					const processorSettings = pluginData.getSelectedAgent().toolsConfig.read_content?.settings as
						| { pdfProcessor?: { provider?: string } }
						| undefined;
					const processorProvider = processorSettings?.pdfProcessor?.provider;
					if (processorProvider) {
						const store = getPendingChangesStore();
						if (store.shouldBlockFile(file.path, processorProvider)) {
							return `Error: The file "${file.path}" is marked as private and cannot be processed by the PDF processor's provider. Switch to a trusted provider or remove the file from the privacy list.`;
						}
					}

					// Page reference: extract requested pages into a sub-PDF and send to processor
					if (pageNums != null) {
						try {
							const result = await extractPdfPages(new Uint8Array(buffer), pageNums);
							if (result.includedPages.length === 0) {
								return `Error: None of the requested pages exist. PDF "${file.name}" has ${result.totalPages} page(s) (valid range: 1\u2013${result.totalPages}).`;
							}
							const pageLabel = result.includedPages.join(", ");
							Logger.log(
								`[read_content] Analyzing PDF "${file.name}" page(s) ${pageLabel} via processor`,
							);
							const pdfBase64 = toBase64(result.pdf.buffer as ArrayBuffer);
							const response = await pdfProcessor.invoke([
								new HumanMessage({
									content: [
										{
											type: "file",
											source_type: "base64",
											data: pdfBase64,
											mime_type: "application/pdf",
											metadata: { filename: file.name },
										},
										{
											type: "text",
											text: `Extract and describe all content from this PDF excerpt (page(s) ${pageLabel} of ${result.totalPages} from "${file.name}"). Include text, charts, tables, diagrams, and visual elements.`,
										},
									] as unknown as string,
								}),
							]);
							return `[Analyzed via processor] Content of PDF "${file.name}" (page(s) ${pageLabel} of ${result.totalPages}):\n\n${extractTextContent(response)}`;
						} catch (error) {
							Logger.error(
								`[read_content] PDF page processor failed for "${file.name}" pages ${pageNums.join(", ")}, falling back to text extraction`,
								error,
							);
							// Fall through to text extraction below
						}
					} else {
						// No page fragment: send entire PDF to vision model
						try {
							Logger.log(`[read_content] Analyzing PDF "${file.name}" via vision model`);
							const pdfContent = [
								{
									type: "file",
									source_type: "base64",
									data: toBase64(buffer),
									mime_type: "application/pdf",
									metadata: { filename: file.name },
								},
								{
									type: "text" as const,
									text: "Extract and describe all content from this PDF including text, charts, tables, diagrams, and visual elements.",
								},
							];
							const response = await pdfProcessor.invoke([
								new HumanMessage({
									content: pdfContent as unknown as string,
								}),
							]);
							return `[Analyzed via vision model] Content of PDF "${file.name}":\n\n${extractTextContent(response)}`;
						} catch (error) {
							Logger.error(
								`[read_content] PDF processor failed for "${file.name}", falling back to text extraction`,
								error,
							);
							// Fall through to text extraction below
						}
					}
				}

				const data = new Uint8Array(buffer);

				if (pageNums != null) {
					const result = await extractTextFromPdfPages(data, pageNums);
					const validPages = pageNums.filter((p) => p >= 1 && p <= result.totalPages);
					if (validPages.length === 0) {
						return `Error: None of the requested pages exist. PDF "${file.name}" has ${result.totalPages} page(s) (valid range: 1\u2013${result.totalPages}).`;
					}
					if (!result.text.trim()) {
						return `PDF "${file.name}" page(s) ${validPages.join(", ")} contain no extractable text. The pages may contain only images/scans.`;
					}
					const pageLabel = validPages.join(", ");
					return `Content of PDF "${file.name}" (page(s) ${pageLabel} of ${result.totalPages}):\n\n${result.text}`;
				}

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

				if (subpath) {
					const sectionResult = extractSubpathContent(app, file, content, subpath);
					if (sectionResult.error) return sectionResult.error;
					return `Content of "${file.path}" (${sectionResult.label}):\n\n${sectionResult.text}`;
				}

				const currentConfig = getToolConfig();
				const settings = currentConfig?.settings as { maxContentLength?: number } | undefined;
				const maxLength = settings?.maxContentLength ?? 0;

				if (maxLength > 0 && content.length > maxLength) {
					return `Content of "${file.path}":\n\n${content.slice(0, maxLength)}\n\n... [Content truncated at ${maxLength} characters]`;
				}

				return `Content of "${file.path}":\n\n${content}`;
			}

			return `Error: Unsupported file type ".${ext}". This tool supports notes, PDFs, and text documents (md, txt, csv, json).${imageProcessor ? " Images are also supported via vision analysis." : " For images, ask the user to attach them directly in the chat input."}`;
		} catch (error) {
			return `Error reading file "${path}": ${error instanceof Error ? error.message : String(error)}`;
		}
	};

	const toolConfig = getToolConfig();

	// Select the appropriate description based on configured processors.
	// Only override if the stored description matches one of the 4 defaults (user hasn't customized it).
	let description = toolConfig?.description ?? defaultToolConfig.description;
	if (READ_CONTENT_DESC_DEFAULTS.has(description)) {
		description = getReadContentDescription(!!imageProcessor, !!pdfProcessor);
	}

	return tool(readContentFn, {
		name: toolConfig?.name ?? defaultToolConfig.name,
		description,
		schema: z.object({
			path: z
				.string()
				.describe(
					"Full path or wiki link. Supports fragments: [[Note#Section]], [[Note#^block-id]], [[doc.pdf#page=3]], [[doc.pdf#page=1-3,5]].",
				),
		}),
	});
}
