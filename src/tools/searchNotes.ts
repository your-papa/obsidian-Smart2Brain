import { App } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getData } from "../stores/dataStore.svelte";
import type { SearchAlgorithm } from "../main";

interface SearchResult {
  path: string;
  name: string;
  frontmatter?: Record<string, unknown>;
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
      console.error(`Error reading file ${path}:`, error);
    }
  }

  return results;
}

/**
 * Omnisearch plugin API interface
 */
interface OmnisearchApi {
  search: (query: string) => Promise<Array<{
    path: string;
    basename: string;
    score: number;
  }>>;
}

/**
 * Gets the Omnisearch plugin API if available
 */
function getOmnisearchApi(app: App): OmnisearchApi | null {
  // @ts-ignore - Obsidian plugin API
  const omnisearchPlugin = app.plugins?.getPlugin?.("omnisearch");
  if (!omnisearchPlugin) {
    return null;
  }
  // @ts-ignore - Omnisearch exposes its API
  return omnisearchPlugin.api ?? null;
}

/**
 * Performs search using Omnisearch plugin
 */
async function omnisearchSearch(app: App, query: string): Promise<SearchResult[]> {
  const api = getOmnisearchApi(app);
  if (!api) {
    console.warn("Omnisearch plugin not available, falling back to grep search");
    return grepSearch(app, query);
  }

  try {
    const searchResults = await api.search(query);
    const results: SearchResult[] = [];

    for (const result of searchResults.slice(0, 10)) {
      const file = app.vault.getAbstractFileByPath(result.path);
      if (!file) continue;

      const cache = app.metadataCache.getFileCache(file as any);
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
    console.error("Omnisearch search failed, falling back to grep:", error);
    return grepSearch(app, query);
  }
}

/**
 * Placeholder for future embeddings-based search
 */
async function embeddingsSearch(app: App, query: string): Promise<SearchResult[]> {
  console.warn("Embeddings search not yet implemented, falling back to grep search");
  return grepSearch(app, query);
}

/**
 * Performs search using the configured algorithm
 */
async function performSearch(
  app: App,
  query: string,
  algorithm: SearchAlgorithm
): Promise<SearchResult[]> {
  switch (algorithm) {
    case "omnisearch":
      return omnisearchSearch(app, query);
    case "embeddings":
      return embeddingsSearch(app, query);
    case "grep":
    default:
      return grepSearch(app, query);
  }
}

/**
 * Tool for searching through Obsidian notes
 * Uses the search algorithm configured in plugin settings
 */
export function createSearchNotesTool(app: App) {
  const searchFn = async ({ query }: { query: string }): Promise<string> => {
    const pluginData = getData();
    const algorithm = pluginData.searchAlgorithm;

    const results = await performSearch(app, query, algorithm);

    if (results.length === 0) {
      return `No notes found matching "${query}". Try a different search term.`;
    }

    // Format results
    const formattedResults = results
      .map((result, index) => {
        const metadataStr = result.frontmatter
          ? `\nProperties: ${JSON.stringify(result.frontmatter)}`
          : "";
        const scoreStr = result.score !== undefined ? ` [score: ${result.score.toFixed(2)}]` : "";
        return `${index + 1}. **${result.name}** (${result.path})${scoreStr}${metadataStr}`;
      })
      .join("\n\n");

    const algorithmLabel = algorithm === "omnisearch" ? "Omnisearch" : algorithm === "embeddings" ? "Embeddings" : "Grep";
    return `Found ${results.length} note(s) matching "${query}" using ${algorithmLabel}. Use the execute_dataview_query tool to retrieve content or perform analysis if needed.\n\n${formattedResults}`;
  };

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
