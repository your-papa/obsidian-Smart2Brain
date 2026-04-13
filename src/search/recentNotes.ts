/**
 * Recent-note retrieval helpers.
 *
 * Extracted from the agent search-tool so the logic is reusable by
 * SearchModal and any other consumer without importing the agent layer.
 */

import { getAllTags } from "obsidian";
import type { App, TFile } from "obsidian";
import { compileFilter, matchesSearchFilter } from "./searchFilters";
import { getData } from "../stores/dataStore.svelte";
import { getIndexableVaultFiles } from "../utils/fileFiltering";
import type { SearchFilter, SearchMatchBadge, SearchResult } from "../vectorstore/types";

const RECENT_RANK_BOOST = 2.5;
const RECENT_RANK_DECAY = 1.25;

function getCachedTags(cache: Parameters<typeof getAllTags>[0] | null | undefined): string[] {
	if (!cache) return [];
	return Array.from(new Set((getAllTags(cache) ?? []).filter((tag) => tag.length > 0)));
}

function isRecentNoteFile(file: unknown): file is Pick<TFile, "path" | "extension" | "basename"> {
	return (
		typeof file === "object" &&
		file !== null &&
		"path" in file &&
		typeof file.path === "string" &&
		"extension" in file &&
		typeof file.extension === "string" &&
		"basename" in file &&
		typeof file.basename === "string"
	);
}

function mergeBadges(...badgeSets: Array<SearchMatchBadge[] | undefined>): SearchMatchBadge[] | undefined {
	const merged = Array.from(new Set(badgeSets.flatMap((badges) => badges ?? [])));
	return merged.length > 0 ? merged : undefined;
}

function getRecentNoteBoost(recentIndex: number): number {
	return Math.max(RECENT_RANK_BOOST - recentIndex * RECENT_RANK_DECAY, 0.25);
}

function addRecentBadge(result: SearchResult): SearchResult {
	return { ...result, matchBadges: mergeBadges(result.matchBadges, ["recent"]) };
}

function getRecentlyOpenedNotes(app: App, filter?: SearchFilter): SearchResult[] {
	const pluginData = getData();
	const getAbstractFileByPath = app.vault?.getAbstractFileByPath;
	if (typeof getAbstractFileByPath !== "function") return [];

	const compiled = filter ? compileFilter(filter) : undefined;
	const results: SearchResult[] = [];
	for (const [index, entry] of pluginData.recentNotes.entries()) {
		const file = getAbstractFileByPath.call(app.vault, entry.path);
		if (!isRecentNoteFile(file)) continue;

		const cache = app.metadataCache.getFileCache(file as TFile);
		const docTags = getCachedTags(cache);
		if (!matchesSearchFilter(file.path, docTags, compiled ?? filter)) continue;

		results.push({
			path: file.path,
			name: file.basename,
			frontmatter: cache?.frontmatter,
			tags: docTags,
			matchBadges: ["recent"],
			score: getRecentNoteBoost(index),
		});
	}
	return results;
}

function getRecentlyCreatedNotes(app: App, filter?: SearchFilter): SearchResult[] {
	if (typeof app.vault?.getFiles !== "function") return [];
	const files = getIndexableVaultFiles(app.vault);

	const compiled = filter ? compileFilter(filter) : undefined;
	return files
		.filter((file) => {
			const cache = app.metadataCache.getFileCache(file);
			const docTags = getCachedTags(cache);
			return matchesSearchFilter(file.path, docTags, compiled ?? filter);
		})
		.sort((left, right) => right.stat.ctime - left.stat.ctime)
		.slice(0, 20)
		.map((file, index) => {
			const cache = app.metadataCache.getFileCache(file);
			return {
				path: file.path,
				name: file.basename,
				frontmatter: cache?.frontmatter,
				tags: getCachedTags(cache),
				matchBadges: ["recent"] as SearchMatchBadge[],
				score: getRecentNoteBoost(index),
			};
		});
}

function mergeRecentNotes(...collections: SearchResult[][]): SearchResult[] {
	const merged = new Map<string, SearchResult>();
	for (const collection of collections) {
		for (const result of collection) {
			const existing = merged.get(result.path);
			if (!existing) {
				merged.set(result.path, result);
				continue;
			}
			merged.set(result.path, {
				...existing,
				frontmatter: existing.frontmatter ?? result.frontmatter,
				tags: existing.tags ?? result.tags,
				matchBadges: mergeBadges(existing.matchBadges, result.matchBadges),
				score: Math.max(existing.score ?? 0, result.score ?? 0),
			});
		}
	}
	return Array.from(merged.values()).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

/** Get deduplicated recent notes (opened + recently created), optionally filtered. */
export function getRecentNotes(app: App, filter?: SearchFilter): SearchResult[] {
	return mergeRecentNotes(getRecentlyOpenedNotes(app, filter), getRecentlyCreatedNotes(app, filter));
}

/** Annotate search results that appear in recents with a "recent" badge. */
export function annotateRecentResults(results: SearchResult[], recentPaths: Set<string>): SearchResult[] {
	if (results.length === 0 || recentPaths.size === 0) return results;
	return results.map((result) => (recentPaths.has(result.path) ? addRecentBadge(result) : result));
}

/** Re-rank results by boosting recently-opened paths toward the top. */
export function applyRecentBoost(results: SearchResult[], recentBoostByPath: Map<string, number>): SearchResult[] {
	if (results.length === 0 || recentBoostByPath.size === 0) return results;
	return results
		.map((result, index) => {
			const recentBoost = recentBoostByPath.get(result.path) ?? 0;
			return { rank: index - recentBoost, result: recentBoost > 0 ? addRecentBadge(result) : result };
		})
		.sort((left, right) => left.rank - right.rank)
		.map(({ result }) => result);
}

/** Build a path→boost map from recent results. */
export function buildRecentBoostMap(results: SearchResult[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const result of results) {
		map.set(result.path, Math.max(map.get(result.path) ?? 0, result.score ?? 0));
	}
	return map;
}

/** Build a set of all recent-note paths (opened + created). */
export function getRecentPathSet(app: App, filter?: SearchFilter): Set<string> {
	const recentPaths = new Set(getData().recentNotes.map((entry) => entry.path));
	for (const result of getRecentNotes(app, filter)) {
		recentPaths.add(result.path);
	}
	return recentPaths;
}
