import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";

function extractLinkPath(input: string): string {
	const trimmed = input.trim();
	const inner = trimmed.startsWith("[[") && trimmed.endsWith("]]") ? trimmed.slice(2, -2).trim() : trimmed;
	const withoutAlias = inner.split("|")[0]?.trim() ?? "";
	const withoutHeading = withoutAlias.split("#")[0]?.trim() ?? "";
	return withoutHeading;
}

function tryExactFilePath(app: App, path: string): TFile | null {
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

function resolveNoteFile(app: App, pathOrWikiLink: string): { file: TFile | null; error?: string } {
	const linkPath = extractLinkPath(pathOrWikiLink);
	if (!linkPath) {
		return { file: null, error: "Error: Path is empty. Provide a note path or wiki link like [[Note Name]]." };
	}

	const exact = tryExactFilePath(app, linkPath);
	if (exact) {
		return { file: exact };
	}

	const linkResolved =
		app.metadataCache.getFirstLinkpathDest(linkPath, "") ??
		(linkPath.endsWith(".md")
			? app.metadataCache.getFirstLinkpathDest(linkPath.slice(0, -3), "")
			: app.metadataCache.getFirstLinkpathDest(`${linkPath}.md`, ""));

	if (linkResolved instanceof TFile) {
		return { file: linkResolved };
	}

	const normalizedTarget = linkPath.toLowerCase();
	const markdownFiles = app.vault.getMarkdownFiles();
	const basenameMatches = markdownFiles.filter((file) => file.basename.toLowerCase() === normalizedTarget);

	if (basenameMatches.length === 1) {
		return { file: basenameMatches[0] };
	}

	if (basenameMatches.length > 1) {
		const matchList = basenameMatches
			.slice(0, 5)
			.map((file) => `- ${file.path}`)
			.join("\n");
		const suffix = basenameMatches.length > 5 ? "\n- ..." : "";
		return {
			file: null,
			error: `Error: Wiki link "${linkPath}" is ambiguous. Use a full path.\nPossible matches:\n${matchList}${suffix}`,
		};
	}

	return { file: null, error: `Error: File not found for "${pathOrWikiLink}"` };
}

/**
 * Tool for reading the content of a specific note
 */
export function createReadNoteTool(app: App) {
	const pluginData = getData();
	const toolConfig = pluginData.getSelectedAgent().toolsConfig.read_content;
	const settings = toolConfig?.settings as { maxContentLength?: number } | undefined;

	const readNoteFn = async ({ path }: { path: string }): Promise<string> => {
		const resolved = resolveNoteFile(app, path);
		if (!resolved.file) {
			return resolved.error ?? `Error: File not found for "${path}"`;
		}

		const file = resolved.file;

		try {
			let content = await app.vault.read(file);

			// Apply max content length if configured
			const currentConfig = pluginData.getSelectedAgent().toolsConfig.read_content;
			const currentSettings = currentConfig?.settings as { maxContentLength?: number } | undefined;
			const maxLength = currentSettings?.maxContentLength ?? settings?.maxContentLength ?? 0;

			if (maxLength > 0 && content.length > maxLength) {
				content = `${content.slice(0, maxLength)}\n\n... [Content truncated at ${maxLength} characters]`;
			}

			return `Content of "${path}":\n\n${content}`;
		} catch (error) {
			return `Error reading file "${path}": ${error instanceof Error ? error.message : String(error)}`;
		}
	};

	return tool(readNoteFn, {
		name: toolConfig?.name ?? "read_content",
		description:
			toolConfig?.description ??
			"Read the full content of a specific note by file path or Obsidian wiki link (e.g., [[Daily Note]] or [[folder/note]]).",
		schema: z.object({
			path: z
				.string()
				.describe("Note reference as full path (e.g., 'folder/note.md') or wiki link (e.g., '[[Note Name]]')."),
		}),
	});
}
