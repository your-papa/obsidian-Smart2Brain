import { App } from "obsidian";
import { tool } from "papa-ts";
import { z } from "zod";

/**
 * Tool for searching through Obsidian notes
 * Performs case-insensitive keyword search on file names and content
 */
export function createSearchNotesTool(app: App) {
	const searchFn = async ({ query }: { query: string }): Promise<string> => {
		const queryLower = query.toLowerCase();
		const markdownFiles = app.vault.getMarkdownFiles();
		const results: Array<{
			path: string;
			name: string;
			frontmatter?: Record<string, unknown>;
		}> = [];

		// Search through files
		for (const file of markdownFiles) {
			const name = file.basename;
			const path = file.path;
			const nameMatch = name.toLowerCase().includes(queryLower);

			try {
				const content = await app.vault.read(file);
				const contentLower = content.toLowerCase();
				const contentMatch = contentLower.includes(queryLower);

				if (nameMatch || contentMatch) {
					// Get file metadata
					const cache = app.metadataCache.getFileCache(file);
					const frontmatter = cache?.frontmatter;

					results.push({
						path,
						name,
						frontmatter,
					});

					// Limit results to top 10
					if (results.length >= 10) {
						break;
					}
				}
			} catch (error) {
				console.error(`Error reading file ${path}:`, error);
			}
		}

		if (results.length === 0) {
			return `No notes found matching "${query}". Try a different search term.`;
		}

		// Format results
		const formattedResults = results
			.map((result, index) => {
				const metadataStr = result.frontmatter
					? `\nProperties: ${JSON.stringify(result.frontmatter)}`
					: "";
				return `${index + 1}. **${result.name}** (${result.path})${metadataStr}`;
			})
			.join("\n\n");

		return `Found ${results.length} note(s) matching "${query}". Use the execute_dataview_query tool to retrieve content or perform analysis if needed.\n\n${formattedResults}`;
	};

	// @ts-expect-error - Type instantiation depth issue with langchain tool types
	return tool(searchFn, {
		name: "search_notes",
		description:
			"Search through your Obsidian notes by keyword. Returns matching file names and metadata (properties/frontmatter) but NO content. Use this to identify relevant notes before using other tools like execute_dataview_query.",
		schema: z.object({
			query: z
				.string()
				.describe("The search query to find in note names and content"),
		}),
	});
}

