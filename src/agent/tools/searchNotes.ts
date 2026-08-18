import { tool } from "@langchain/core/tools";
import type { App } from "obsidian";
import { z } from "zod";
import type { SearchAlgorithm, SearchNotesSettings } from "../../types/plugin";
import { getLexicalSearchService, waitForLexicalSearch } from "../../search/LexicalSearchService";
import { rankSearchResults } from "../../search/finalSearchRanking";
import { buildRecentBoostMap, getRecentNotes } from "../../search/recentNotes";
import { getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { normalizeVaultPath } from "../../utils/pathUtils";
import { getVectorStoreService, type SearchFilter, type SearchResult, waitForVectorStore } from "../../vectorstore";
import type { SearchMatchBadge, SearchMatchExplanation } from "../../vectorstore/types";
import { Logger } from "../../utils/logging";

export type { SearchResult } from "../../vectorstore/types";

interface SearchToolResultItem {
	rank: number;
	name: string;
	path?: string;
	score?: number;
	frontmatter?: Record<string, unknown>;
	tags?: string[];
	matchExplanation?: SearchMatchExplanation;
	matchBadges?: SearchMatchBadge[];
}

interface SearchToolResultPayload {
	query: string;
	recentOnly: boolean;
	algorithm: SearchAlgorithm;
	maxResults: number;
	filter?: SearchFilter;
	totalResults: number;
	returnedResults: number;
	skippedPrivateFiles: number;
	results: SearchToolResultItem[];
	message?: string;
}

interface ResolvedSearchToolSettings {
	maxResults: number;
	algorithm: SearchAlgorithm;
	showPath: boolean;
	showTags: boolean;
	showMatchBadges: boolean;
	showMatchContext: boolean;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
	if (!tags?.length) {
		return undefined;
	}

	return Array.from(new Set(tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))));
}

/**
 * Hybrid search combining semantic and lexical search using Reciprocal Rank Fusion.
 * Runs both searches in parallel and merges results.
 */
async function hybridSearch(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	// Run semantic and lexical search in parallel
	const [semanticResults, lexical] = await Promise.all([
		embeddingsSearch(app, query, filter),
		getLexicalResultsWithAvailability(app, query, filter),
	]);

	// Precision floor: semantic search has no concept of "no answer". Every query
	// embeds to some vector and returns its nearest neighbours, so a meaningless
	// query yields a full page of confident-looking results — measured at cosine
	// 0.515-0.597 against 0.665-0.700 for genuine matches. The bands *overlap*,
	// so no absolute threshold separates them (`similarityThreshold` defaults to
	// 0.7 in code, which would discard real answers).
	//
	// The semantic score *distribution* looked promising — nonsense returns a flat
	// field (spread 0.038-0.071) where real queries have a clear winner
	// (0.184-0.242) — but two graded benchmark queries sit inside the nonsense
	// band (`how does heavy rainfall runoff…` at 0.048), so gating on spread would
	// suppress real answers.
	//
	// Lexical agreement separates the two cleanly, with no overlap: every real
	// query above returns 25 lexical hits, every nonsense query returns 0. If no
	// indexed note contains *any* query term, the nearest neighbours are noise.
	//
	// Only applies when the lexical index was actually consulted — an unavailable
	// service also returns nothing, and that is not evidence about the query.
	if (lexical.available && lexical.results.length === 0) {
		return [];
	}

	// Both legs are kept deliberately. Dropping lexical when semantic is available
	// was measured (semantic alone ranks the right answer #1 on most core queries)
	// but collapses the `long-context` axis 0.9254 → 0.2372: those answers sit in
	// an unbroken prose run whose embedding is diluted, so the literal query terms
	// are the only thing that retrieves them. See SEMANTIC_SOURCE_WEIGHT in
	// `finalSearchRanking.ts` for the weighting that fixes the size-bias defect
	// without giving up that recall.
	return rankSearchResults({
		query,
		lexicalResults: lexical.results,
		semanticResults,
		recentBoostByPath: buildRecentBoostMap(getRecentNotes(app, filter)),
	});
}

async function getReadyLexicalSearchService() {
	if (!(await waitForLexicalSearch())) {
		Logger.warn("Lexical search is unavailable because the lexical search service is not ready");
		return null;
	}

	return getLexicalSearchService();
}

/**
 * Get lexical search results using MiniSearch (BM25 based).
 */
async function getLexicalResults(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	return (await getLexicalResultsWithAvailability(app, query, filter)).results;
}

/**
 * As {@link getLexicalResults}, but reports whether the lexical index was
 * actually consulted.
 *
 * An empty result means two very different things: "no indexed note contains
 * any query term" (a real signal) versus "the service was not ready" (no signal
 * at all). The no-match gate in `hybridSearch` acts on the former and must never
 * act on the latter, so the distinction cannot be collapsed into `[]`.
 */
async function getLexicalResultsWithAvailability(
	app: App,
	query: string,
	filter?: SearchFilter,
): Promise<{ results: SearchResult[]; available: boolean }> {
	const vectorStore = await getReadyLexicalSearchService();
	if (!vectorStore) {
		return { results: [], available: false };
	}

	return { results: await vectorStore.search(query, 100, filter), available: true };
}

/**
 * Embeddings-based semantic search using the VectorStoreService
 */
async function embeddingsSearch(app: App, query: string, filter?: SearchFilter): Promise<SearchResult[]> {
	if (!(await waitForVectorStore())) {
		Logger.warn("Semantic search is unavailable because the vector store is not ready");
		return [];
	}

	const vectorStore = getVectorStoreService();
	const pluginData = getData();

	// Get similarity threshold from the configured embed model
	const defaultModel = pluginData.getSearchEmbedModel();
	let threshold = 0;
	if (defaultModel) {
		const embedModels = pluginData.getEmbedModels(defaultModel.provider);
		const modelConfig = embedModels[defaultModel.model];
		threshold = modelConfig?.similarityThreshold ?? 0;
	}

	return vectorStore.semanticSearch(query, 100, threshold, filter);
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
		const results = await browseWithFilter(filter);
		return rankSearchResults({
			lexicalResults: results,
			recentBoostByPath: buildRecentBoostMap(getRecentNotes(app, filter)),
		});
	}

	// Require a search term if no filter
	if (!query.trim()) {
		return [];
	}

	let results: SearchResult[];
	switch (algorithm) {
		case "lexical":
			results = await getLexicalResults(app, query, filter);
			break;
		case "hybrid":
			results = await hybridSearch(app, query, filter);
			break;
		default:
			results = await getLexicalResults(app, query, filter);
			break;
	}

	if (algorithm === "hybrid") {
		return results;
	}

	return rankSearchResults({
		query,
		lexicalResults: results,
		recentBoostByPath: buildRecentBoostMap(getRecentNotes(app, filter)),
	});
}

/**
 * Browse documents with filter only (no search query).
 * Returns documents matching the filter criteria.
 */
async function browseWithFilter(filter: SearchFilter): Promise<SearchResult[]> {
	const vectorStore = await getReadyLexicalSearchService();
	if (!vectorStore) {
		return [];
	}

	return vectorStore.browse(100, filter);
}

/**
 * Tool for searching through Obsidian notes
 * Uses the search algorithm configured in plugin settings
 */
export function createSearchNotesTool(app: App) {
	const pluginData = getData();
	const getSearchNotesConfig = () => pluginData.getSelectedAgent().toolsConfig.search_notes;
	const toolConfig = getSearchNotesConfig();
	const resolveSettings = (settings?: SearchNotesSettings): ResolvedSearchToolSettings => ({
		maxResults: settings?.maxResults ?? 10,
		algorithm: settings?.algorithm ?? pluginData.searchAlgorithm,
		showPath: settings?.showPath ?? pluginData.searchShowPath,
		showTags: settings?.showTags ?? pluginData.searchShowTags,
		showMatchBadges: settings?.showMatchBadges ?? pluginData.searchShowMatchBadges,
		showMatchContext: settings?.showMatchContext ?? pluginData.searchShowMatchContext,
	});

	const searchFn = async ({
		query = "",
		pathPrefix,
		tags,
		recentOnly = false,
	}: {
		query?: string;
		pathPrefix?: string;
		tags?: string[];
		recentOnly?: boolean;
	}): Promise<string> => {
		// Get fresh config each call to pick up any changes
		const currentConfig = getSearchNotesConfig();
		const settings = resolveSettings(currentConfig?.settings as SearchNotesSettings | undefined);
		const { algorithm, maxResults: limit, showMatchBadges, showMatchContext, showPath, showTags } = settings;

		// Build filter from parameters
		const filterPathPrefixes: string[] | undefined = pathPrefix ? [normalizeVaultPath(pathPrefix)] : undefined;
		const filterTags: string[] | undefined = tags?.length ? tags : undefined;

		const filter: SearchFilter | undefined =
			filterPathPrefixes || filterTags
				? {
						pathPrefixes: filterPathPrefixes,
						tags: filterTags,
					}
				: undefined;

		Logger.debug("[search_notes] Configured settings:", {
			algorithm,
			maxResults: limit,
			filter,
			recentOnly,
		});

		const results = recentOnly ? getRecentNotes(app, filter) : await performSearch(app, query, algorithm, filter);
		const currentProvider = pluginData.getSelectedAgent().chatModel?.provider;
		const store = getPendingChangesStore();

		let skippedPrivateFiles = 0;
		const visibleResults: SearchResult[] = [];
		for (const result of results) {
			if (currentProvider && store.shouldBlockFile(result.path, currentProvider)) {
				skippedPrivateFiles++;
				continue;
			}
			visibleResults.push(result);
		}

		const limitedResults = visibleResults.slice(0, limit);
		const items: SearchToolResultItem[] = limitedResults.map((result, index) => ({
			rank: index + 1,
			name: result.name,
			path: showPath ? result.path : undefined,
			score: result.score,
			frontmatter: result.frontmatter,
			tags: showTags ? normalizeTags(result.tags) : undefined,
			matchExplanation: showMatchContext ? result.matchExplanation : undefined,
			matchBadges: showMatchBadges ? result.matchBadges : undefined,
		}));

		const payload: SearchToolResultPayload = {
			query,
			recentOnly,
			algorithm,
			maxResults: limit,
			filter,
			totalResults: visibleResults.length,
			returnedResults: items.length,
			skippedPrivateFiles,
			results: items,
		};

		if (limitedResults.length === 0) {
			payload.message = `No notes found matching "${query}". Try a different search term.`;
			return JSON.stringify(payload);
		}

		return JSON.stringify(payload);
	};

	return tool(searchFn, {
		name: toolConfig?.name ?? "search_notes",
		description:
			toolConfig?.description ??
			"Search through your Obsidian notes by keyword or return recently opened notes. Returns structured JSON with matching file names, paths, tags, match reasons, limited match snippets or headings, privacy flags, and metadata (properties/frontmatter). Use this to identify relevant notes before using other tools.",
		schema: z.object({
			query: z
				.string()
				.optional()
				.describe("The search query to find in note names and content. Optional when recentOnly is true."),
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
			recentOnly: z
				.boolean()
				.optional()
				.describe(
					"When true, ignore query text and return recently opened notes, optionally filtered by pathPrefix and tags.",
				),
		}),
	});
}
