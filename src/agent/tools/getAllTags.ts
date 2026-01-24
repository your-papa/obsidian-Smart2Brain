import { type App, getAllTags } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";

/**
 * Tool for retrieving all tags from the Obsidian vault
 */
export function createGetAllTagsTool(app: App) {
	const pluginData = getData();
	const toolConfig = pluginData.getToolConfig("get_all_tags");

	const getTagsFn = async (): Promise<string> => {
		const files = app.vault.getMarkdownFiles();
		const tags = new Set<string>();

		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			if (cache) {
				const fileTags = getAllTags(cache);
				if (fileTags) {
					for (const tag of fileTags) {
						tags.add(tag);
					}
				}
			}
		}

		const sortedTags = Array.from(tags).sort();

		if (sortedTags.length === 0) {
			return "No tags found in the vault.";
		}

		return `Found ${sortedTags.length} tags:\n${sortedTags.join("\n")}`;
	};

	return tool(getTagsFn, {
		name: toolConfig?.name ?? "get_all_tags",
		description:
			toolConfig?.description ??
			"Retrieve a list of all tags used in the Obsidian vault. Returns a sorted list of unique tags.",
		schema: z.object({}),
	});
}
