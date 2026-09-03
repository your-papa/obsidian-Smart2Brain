import { type App, getAllTags } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { isAgentFilePath } from "../../utils/fileFiltering";
import { resolveToolAgent, resolveToolProvider } from "./toolAgentContext";

/**
 * Tool for retrieving all tags from the Obsidian vault
 */
export function createGetAllTagsTool(app: App, agentId = "") {
	const getToolConfig = () => resolveToolAgent(agentId).toolsConfig.get_all_tags;
	const toolConfig = getToolConfig();

	const getTagsFn = async (): Promise<string> => {
		// Tags are content: a tag that exists only in a private note names something
		// about that note (`#therapy`, `#client/acme`). Filter the same way every
		// other read tool does, so the vault's tag vocabulary can't reach an
		// untrusted provider through a tool that happens to return no note bodies.
		// Resolved per invocation — the agent's model can change between calls.
		const currentProvider = resolveToolProvider(agentId);
		const store = getPendingChangesStore();

		const files = app.vault.getMarkdownFiles().filter((file) => !isAgentFilePath(file.path));
		const tags = new Set<string>();
		let skippedPrivateFiles = 0;

		for (const file of files) {
			if (currentProvider && store.shouldBlockFile(file.path, currentProvider)) {
				skippedPrivateFiles++;
				continue;
			}
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
		// Surface the skip rather than silently returning a partial vocabulary —
		// otherwise the model reads an empty/short list as "this vault has no tags"
		// and reasons from it. Mirrors search_notes' skippedPrivateFiles notice.
		const privacyNote =
			skippedPrivateFiles > 0
				? `\n\n(${skippedPrivateFiles} note(s) were skipped because they are private for the current provider.)`
				: "";

		if (sortedTags.length === 0) {
			return `No tags found in the vault.${privacyNote}`;
		}

		return `Found ${sortedTags.length} tags:\n${sortedTags.join("\n")}${privacyNote}`;
	};

	return tool(getTagsFn, {
		name: toolConfig?.name ?? "get_all_tags",
		description:
			toolConfig?.description ??
			"Retrieve a list of all tags used in the Obsidian vault. Returns a sorted list of unique tags.",
		schema: z.object({}),
	});
}
