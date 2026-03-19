import { tool } from "@langchain/core/tools";
import type { App } from "obsidian";
import { z } from "zod";
import type { SearchAlgorithm } from "../../types/plugin";
import { getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { normalizeVaultPath } from "../../utils/pathUtils";
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
 * Get lexical search results using MiniSearch (BM25 based).
 */
async function getLexicalResults(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	if (!isVectorStoreInitialized()) {
		Logger.warn("VectorStore not initialized for lexical search");
		return [];
	}

	const vectorStore = getVectorStoreService();
	const results = await vectorStore.lexicalSearch(query, 100, filter);

	return results.map((r) => ({
		path: r.path,
		name: r.name,
		frontmatter: r.frontmatter,
		tags: r.tags,
		score: r.score,
	}));
}

/**
 * Embeddings-based semantic search using the VectorStoreService
 */
async function embeddingsSearch(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	if (!isVectorStoreInitialized()) {
		Logger.warn("VectorStore not initialized for embeddings search");
		return [];
	}

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

	const results = await vectorStore.semanticSearch(query, 100, threshold, filter);

	return results.map((r) => ({
		path: r.path,
		name: r.name,
		frontmatter: r.frontmatter,
		tags: r.tags,
		score: r.score,
	}));
}

/**
 * Performs search using the configured algorithm with optional filtering.
 * If query is empty but filter is provided, returns filtered documents without search.
 */
export async function performSearch(
	app: App,
	query: string,
	algorithm: SearchAlgorithm,
	filter?: SearchFilter,
): Promise<SearchResult[]> {
	Logger.debug("[search_notes] Algorithm selected:", algorithm, "Filter:", filter);

	// Handle filter-only queries (no search term)
	if (!query.trim() && filter) {
		return browseWithFilter(filter);
	}

	// Require a search term if no filter
	if (!query.trim()) {
		return [];
	}

	switch (algorithm) {
		case "lexical":
			return getLexicalResults(app, query, filter);
		case "hybrid":
			return hybridSearch(app, query, filter);
		default:
			return getLexicalResults(app, query, filter);
	}
}

/**
 * Browse documents with filter only (no search query).
 * Returns documents matching the filter criteria.
 */
async function browseWithFilter(filter: SearchFilter): Promise<SearchResult[]> {
	if (!isVectorStoreInitialized()) {
		Logger.warn("VectorStore not initialized for browse");
		return [];
	}

	const vectorStore = getVectorStoreService();
	const results = await vectorStore.browseDocuments(100, filter);

	return results.map((r) => ({
		path: r.path,
		name: r.name,
		frontmatter: r.frontmatter,
		tags: r.tags,
		score: r.score,
	}));
}

/**
 * Tool for searching through Obsidian notes
 * Uses the search algorithm configured in plugin settings
 */
export function createSearchNotesTool(app: App) {
	const pluginData = getData();
	const getSearchNotesConfig = () => pluginData.getSelectedAgent().toolsConfig.search_notes;
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
		// Get fresh config each call to pick up any changes
		const currentConfig = getSearchNotesConfig();
		const settings = currentConfig?.settings as { maxResults?: number; algorithm?: SearchAlgorithm } | undefined;
		const algorithm: SearchAlgorithm = settings?.algorithm ?? pluginData.searchAlgorithm;
		const limit = settings?.maxResults ?? 10;

		// Build filter from parameters
		const filter: SearchFilter | undefined =
			pathPrefix || tags?.length
				? {
						pathPrefixes: pathPrefix ? [normalizeVaultPath(pathPrefix)] : undefined,
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

				// Privacy check: mark private files that the current provider cannot access
				const currentProvider = pluginData.getSelectedAgent().chatModel?.provider;
				let privacyStr = "";
				if (currentProvider) {
					const store = getPendingChangesStore();
					if (store.shouldBlockFile(result.path, currentProvider)) {
						privacyStr = " [PRIVATE - content restricted for current provider]";
					}
				}

				return `${index + 1}. **${result.name}** (${result.path})${scoreStr}${privacyStr}${metadataStr}`;
			})
			.join("\n\n");

		const algorithmLabel = algorithm === "lexical" ? "Lexical (BM25)" : "Hybrid";
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
				.describe(
					"Optional vault folder to restrict search (e.g., 'Projects' or 'Projects/2026'). Matching is folder-boundary safe.",
				),
			tags: z
				.array(z.string())
				.optional()
				.describe(
					"Optional tags to filter by (e.g., ['#project', '#active']). Documents must have at least one of these tags.",
				),
		}),
	});
}
