import { tool } from "@langchain/core/tools";
import { type App, TFile } from "obsidian";
import { z } from "zod";
import type { SearchAlgorithm } from "../../main";
import { getData } from "../../stores/dataStore.svelte";
import { getVectorStoreService, isVectorStoreInitialized, type SearchFilter } from "../../vectorstore";
import { Logger } from "../../utils/logging";

export interface SearchResult {
	path: string;
	name: string;
	frontmatter?: Record<string, unknown>;
	tags?: string[];
	score?: number;
}

/**
 * Performs a simple grep-like search through all markdown files
 */
async function grepSearch(app: App, query: string): Promise<SearchResult[]> {
	const queryLower = query.toLowerCase();
	const markdownFiles = app.vault.getMarkdownFiles();
	const results: SearchResult[] = [];

	for (const file of markdownFiles) {
		const name = file.basename;
		const path = file.path;
		const nameMatch = name.toLowerCase().includes(queryLower);

		try {
			const content = await app.vault.read(file);
			const contentLower = content.toLowerCase();
			const contentMatch = contentLower.includes(queryLower);

			if (nameMatch || contentMatch) {
				const cache = app.metadataCache.getFileCache(file);
				const frontmatter = cache?.frontmatter;

				results.push({
					path,
					name,
					frontmatter,
				});

				if (results.length >= 10) {
					break;
				}
			}
		} catch (error) {
			Logger.error(`Error reading file ${path}:`, error);
		}
	}

	return results;
}

/**
 * Omnisearch plugin API interface
 */
interface OmnisearchApi {
	search: (query: string) => Promise<
		Array<{
			path: string;
			basename: string;
			score: number;
		}>
	>;
}

/**
 * Gets the Omnisearch plugin API if available
 */
function getOmnisearchApi(app: App): OmnisearchApi | null {
	// @ts-ignore - Obsidian plugin API
	const omnisearchPlugin = app.plugins?.getPlugin?.("omnisearch");
	if (!omnisearchPlugin) {
		Logger.debug("[search_notes] Omnisearch plugin not available.");
		return null;
	}
	// @ts-ignore - Omnisearch exposes its API
	Logger.debug("[search_notes] Omnisearch plugin detected.");
	return omnisearchPlugin.api ?? null;
}

/**
 * Performs search using Omnisearch plugin
 */
async function omnisearchSearch(app: App, query: string): Promise<SearchResult[]> {
	const api = getOmnisearchApi(app);
	if (!api) {
		Logger.warn("Omnisearch plugin not available, falling back to grep search");
		return grepSearch(app, query);
	}

	try {
		Logger.debug("[search_notes] Using Omnisearch for query:", query);
		const searchResults = await api.search(query);
		const results: SearchResult[] = [];

		for (const result of searchResults.slice(0, 10)) {
			const file = app.vault.getAbstractFileByPath(result.path);
			if (!file || !(file instanceof TFile)) continue;

			const cache = app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;

			results.push({
				path: result.path,
				name: result.basename,
				frontmatter,
				score: result.score,
			});
		}

		return results;
	} catch (error) {
		Logger.error("Omnisearch search failed, falling back to grep:", error);
		return grepSearch(app, query);
	}
}

/**
 * Calculate title boost based on how well query matches the note title.
 * Returns a boost factor between 0 and titleBoostMax.
 */
function calculateTitleBoost(query: string, noteName: string, titleBoostMax: number): number {
	const queryTerms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 2);
	const titleLower = noteName.toLowerCase();

	if (queryTerms.length === 0) return 0;

	// Check for exact match (highest boost)
	if (titleLower === query.toLowerCase()) {
		return titleBoostMax;
	}

	// Check for title containing full query
	if (titleLower.includes(query.toLowerCase())) {
		return titleBoostMax * 0.8;
	}

	// Count how many query terms appear in title
	const matchingTerms = queryTerms.filter((term) => titleLower.includes(term));
	const matchRatio = matchingTerms.length / queryTerms.length;

	return titleBoostMax * matchRatio * 0.6;
}

/**
 * Hybrid search combining semantic and lexical search using Reciprocal Rank Fusion.
 * Runs both searches in parallel and merges results.
 */
async function hybridSearch(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	const k = 60; // RRF constant (standard value)
	const titleBoostMax = 0.03; // Max title boost (roughly equivalent to being in top 3 in both searches)

	// Run semantic and lexical search in parallel
	const [semanticResults, lexicalResults] = await Promise.all([
		embeddingsSearch(app, query, filter),
		getLexicalResults(app, query, filter),
	]);

	// Build RRF score map
	const scoreMap = new Map<string, { result: SearchResult; score: number }>();

	// Add semantic results with RRF scores
	semanticResults.forEach((result, rank) => {
		const rrfScore = 1 / (k + rank + 1);
		const existing = scoreMap.get(result.path);
		if (existing) {
			existing.score += rrfScore;
		} else {
			scoreMap.set(result.path, { result, score: rrfScore });
		}
	});

	// Add lexical results with RRF scores
	lexicalResults.forEach((result, rank) => {
		const rrfScore = 1 / (k + rank + 1);
		const existing = scoreMap.get(result.path);
		if (existing) {
			existing.score += rrfScore;
		} else {
			scoreMap.set(result.path, { result, score: rrfScore });
		}
	});

	// Apply title boost to all results
	for (const entry of scoreMap.values()) {
		const titleBoost = calculateTitleBoost(query, entry.result.name, titleBoostMax);
		entry.score += titleBoost;
	}

	// Sort by combined RRF score and return
	return Array.from(scoreMap.values())
		.sort((a, b) => b.score - a.score)
		.map(({ result, score }) => ({ ...result, score }));
}

/**
 * Get lexical search results - uses Omnisearch if available, otherwise grep.
 * Applies path/tag filters when not using embeddings search.
 */
async function getLexicalResults(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	const api = getOmnisearchApi(app);
	let results: SearchResult[];
	if (api) {
		results = await omnisearchSearch(app, query);
	} else {
		results = await grepSearch(app, query);
	}

	// Apply filters to lexical results (since they don't support native filtering)
	if (filter?.pathPrefixes?.length || filter?.tags?.length) {
		results = results.filter((result) => {
			// Path filter
			if (filter.pathPrefixes?.length) {
				const matchesPath = filter.pathPrefixes.some((prefix) => result.path.startsWith(prefix));
				if (!matchesPath) return false;
			}

			// Tag filter (using frontmatter tags)
			if (filter.tags?.length && result.frontmatter?.tags) {
				const docTags = Array.isArray(result.frontmatter.tags)
					? result.frontmatter.tags.map((t: string) => (t.startsWith("#") ? t : `#${t}`))
					: [`#${result.frontmatter.tags}`];
				const normalizedFilterTags = filter.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));

				if (filter.requireAllTags) {
					const hasAllTags = normalizedFilterTags.every((tag) => docTags.includes(tag));
					if (!hasAllTags) return false;
				} else {
					const hasAnyTag = normalizedFilterTags.some((tag) => docTags.includes(tag));
					if (!hasAnyTag) return false;
				}
			} else if (filter.tags?.length) {
				// Document has no tags but filter requires tags
				return false;
			}

			return true;
		});
	}

	return results;
}

/**
 * Embeddings-based semantic search using the VectorStoreService
 */
async function embeddingsSearch(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	if (!isVectorStoreInitialized()) {
		Logger.warn("VectorStore not initialized, falling back to grep search");
		return grepSearch(app, query);
	}

	try {
		const vectorStore = getVectorStoreService();
		const pluginData = getData();

		// Get similarity threshold from the configured embed model
		const defaultModel = pluginData.defaultEmbedModel;
		let threshold = 0;
		if (defaultModel) {
			const embedModels = pluginData.getEmbedModels(defaultModel.provider);
			const modelConfig = embedModels[defaultModel.model];
			threshold = modelConfig?.similarityThreshold ?? 0;
		}

		const results = await vectorStore.search(query, pluginData.retrieveTopK, threshold, filter);

		// Convert to SearchResult format (already compatible)
		return results.map((r) => ({
			path: r.path,
			name: r.name,
			frontmatter: r.frontmatter,
			tags: r.tags,
			score: r.score,
		}));
	} catch (error) {
		Logger.error("Embeddings search failed, falling back to grep:", error);
		return grepSearch(app, query);
	}
}

/**
 * Performs search using the configured algorithm with optional filtering.
 */
export async function performSearch(
	app: App,
	query: string,
	algorithm: SearchAlgorithm,
	filter?: SearchFilter,
): Promise<SearchResult[]> {
	Logger.debug("[search_notes] Algorithm selected:", algorithm, "Filter:", filter);
	switch (algorithm) {
		case "omnisearch":
			return getLexicalResults(app, query, filter);
		case "embeddings":
			return embeddingsSearch(app, query, filter);
		case "hybrid":
			return hybridSearch(app, query, filter);
		default:
			return getLexicalResults(app, query, filter);
	}
}

/**
 * Tool for searching through Obsidian notes
 * Uses the search algorithm configured in plugin settings
 */
export function createSearchNotesTool(app: App) {
	const pluginData = getData();
	const getSearchNotesConfig = (): ReturnType<typeof pluginData.getToolConfig> => {
		const selectedAgent = pluginData.getSelectedAgent();
		return selectedAgent?.toolsConfig?.search_notes ?? pluginData.getToolConfig("search_notes");
	};
	const toolConfig = getSearchNotesConfig();

	const searchFn = async ({
		query,
		pathPrefix,
		tags,
	}: {
		query: string;
		pathPrefix?: string;
		tags?: string[];
	}): Promise<string> => {
		// Always use global search settings
		const algorithm = pluginData.searchAlgorithm;
		const limit = pluginData.retrieveTopK;

		// Build filter from parameters
		const filter: SearchFilter | undefined =
			pathPrefix || tags?.length
				? {
					pathPrefixes: pathPrefix ? [pathPrefix] : undefined,
					tags: tags,
				}
				: undefined;

		Logger.debug("[search_notes] Configured settings:", {
			algorithm,
			maxResults: limit,
			filter,
		});

		const results = await performSearch(app, query, algorithm, filter);
		const limitedResults = results.slice(0, limit);

		if (limitedResults.length === 0) {
			return `No notes found matching "${query}". Try a different search term.`;
		}

		// Format results
		const formattedResults = limitedResults
			.map((result, index) => {
				const metadataStr = result.frontmatter ? `\nProperties: ${JSON.stringify(result.frontmatter)}` : "";
				const scoreStr = result.score !== undefined ? ` [score: ${result.score.toFixed(2)}]` : "";
				return `${index + 1}. **${result.name}** (${result.path})${scoreStr}${metadataStr}`;
			})
			.join("\n\n");

		const algorithmLabel =
			algorithm === "omnisearch"
				? "Omnisearch"
				: algorithm === "embeddings"
					? "Embeddings"
					: algorithm === "hybrid"
						? "Hybrid"
						: "Grep";
		return `Found ${limitedResults.length} note(s) matching "${query}" using ${algorithmLabel}.\n\n${formattedResults}`;
	};

	return tool(searchFn, {
		name: toolConfig?.name ?? "search_notes",
		description:
			toolConfig?.description ??
			"Search through your Obsidian notes by keyword. Returns matching file names and metadata (properties/frontmatter) but NO content. Use this to identify relevant notes before using other tools.",
		schema: z.object({
			query: z.string().describe("The search query to find in note names and content"),
			pathPrefix: z
				.string()
				.optional()
				.describe("Optional folder path prefix to restrict search (e.g., 'projects/' or 'work/notes/')"),
			tags: z
				.array(z.string())
				.optional()
				.describe(
					"Optional tags to filter by (e.g., ['#project', '#active']). Documents must have at least one of these tags.",
				),
		}),
	});
}
