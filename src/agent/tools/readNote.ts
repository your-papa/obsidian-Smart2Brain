import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";

/**
 * Tool for reading the content of a specific note
 */
export function createReadNoteTool(app: App) {
	const pluginData = getData();
	const toolConfig = pluginData.getToolConfig("read_note");
	const settings = toolConfig?.settings as { maxContentLength?: number } | undefined;

	const readNoteFn = async ({ path }: { path: string }): Promise<string> => {
		const file = app.vault.getAbstractFileByPath(path);

		if (!file) {
			return `Error: File not found at path "${path}"`;
		}

		if (!(file instanceof TFile)) {
			return `Error: Path "${path}" is not a file`;
		}

		try {
			let content = await app.vault.read(file);

			// Apply max content length if configured
			const currentConfig = pluginData.getToolConfig("read_note");
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
		name: toolConfig?.name ?? "read_note",
		description:
			toolConfig?.description ??
			"Read the full content of a specific note by its file path. Use this after finding a relevant note with search_notes.",
		schema: z.object({
			path: z.string().describe("The full file path of the note to read (e.g., 'folder/note.md')"),
		}),
	});
}
