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
import type { SearchFilter, SearchResult } from "../vectorstore/types";

const RECENT_RANK_BOOST = 4.5;
const RECENT_RANK_DECAY = 0.75;
const MIN_RECENT_RANK_BOOST = 0.5;
const RECENT_SCORE_WEIGHT = 0.6;

export interface RecentBoostInfo {
	boost: number;
	recentRank: number;
}

function getRecentStrength(recentBoost: number): number {
	return recentBoost / RECENT_RANK_BOOST;
}

export function getRecentRerankScore(baseScore: number, recentBoost: number): number {
	const recentStrength = recentBoost > 0 ? getRecentStrength(recentBoost) : 0;
	return baseScore * (1 + recentStrength * RECENT_SCORE_WEIGHT);
}

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

function getRecentNoteBoost(recentIndex: number): number {
	return Math.max(RECENT_RANK_BOOST - recentIndex * RECENT_RANK_DECAY, MIN_RECENT_RANK_BOOST);
}

export function getRecentlyOpenedNotes(app: App, filter?: SearchFilter): SearchResult[] {
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
		const recentBoost = getRecentNoteBoost(index);

		results.push({
			path: file.path,
			name: file.basename,
			frontmatter: cache?.frontmatter,
			tags: docTags,
			matchBadges: ["recent"],
			score: recentBoost,
			rankingDebug: {
				recentRank: index + 1,
				recentBoost,
				baseScore: recentBoost,
			},
		});
	}
	return results;
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
				score: Math.max(existing.score ?? 0, result.score ?? 0),
			});
		}
	}
	return Array.from(merged.values()).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

/** Get deduplicated recent notes from the user's recently opened history, optionally filtered. */
export function getRecentNotes(app: App, filter?: SearchFilter): SearchResult[] {
	return mergeRecentNotes(getRecentlyOpenedNotes(app, filter));
}

/** Build a path→boost map from recent results. */
export function buildRecentBoostMap(results: SearchResult[]): Map<string, RecentBoostInfo> {
	const map = new Map<string, RecentBoostInfo>();
	for (const [index, result] of results.entries()) {
		const nextBoost = result.score ?? 0;
		const existing = map.get(result.path);
		if (!existing || nextBoost > existing.boost) {
			map.set(result.path, { boost: nextBoost, recentRank: index + 1 });
		}
	}
	return map;
}
