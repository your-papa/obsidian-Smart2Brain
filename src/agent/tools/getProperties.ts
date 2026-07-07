import type { App } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";

function getNoteProperties(app: App, noteName: string): string {
	const file = app.vault
		.getMarkdownFiles()
		.find((candidate) => candidate.path === noteName || candidate.basename === noteName);

	if (!file) {
		return `Note "${noteName}" not found.`;
	}

	const pluginData = getData();
	const currentProvider = pluginData.getSelectedAgent().chatModel?.provider;
	if (currentProvider) {
		const store = getPendingChangesStore();
		if (store.shouldBlockFile(file.path, currentProvider)) {
			return `Error: The file "${file.path}" is private for the current provider. Switch to a trusted provider or adjust provider access settings.`;
		}
	}

	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) {
		return `No properties found for note "${noteName}".`;
	}

	const { position, ...properties } = frontmatter;
	return JSON.stringify(properties);
}

function getAllPropertyKeys(app: App): string {
	const allKeys = new Set<string>();

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.frontmatter) {
			for (const key of Object.keys(cache.frontmatter)) {
				if (key !== "position") {
					allKeys.add(key);
				}
			}
		}
	}

	const sortedKeys = Array.from(allKeys).sort((left, right) => left.localeCompare(right));
	if (sortedKeys.length === 0) {
		return "No properties found in the vault.";
	}

	return `Found ${sortedKeys.length} unique properties:\n${sortedKeys.join("\n")}`;
}

/**
 * Tool for retrieving properties (frontmatter) from Obsidian.
 * Can retrieve all unique property keys across the vault, or properties for a specific note.
 */
export function createGetPropertiesTool(app: App) {
	const pluginData = getData();
	const toolConfig = pluginData.getSelectedAgent().toolsConfig.get_properties;

	const getPropertiesFn = async ({ note_name }: { note_name?: string }) => {
		return note_name ? getNoteProperties(app, note_name) : getAllPropertyKeys(app);
	};

	return tool(getPropertiesFn, {
		name: toolConfig?.name ?? "get_properties",
		description:
			toolConfig?.description ??
			"Retrieve properties (frontmatter) from Obsidian. Omit 'note_name' to list all available property keys in the vault.",
		schema: z.object({
			note_name: z
				.string()
				.optional()
				.describe(
					"The name or path of the note to retrieve properties for. If omitted, lists all available property keys in the vault.",
				),
		}),
	});
}
