import { tool } from "@langchain/core/tools";
import type { App, TFile } from "obsidian";
import { z } from "zod";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import type { GrepNotesSettings } from "../../types/plugin";
import { getIndexableVaultFiles, isTextIndexableFile, shouldProcessVaultPath } from "../../utils/fileFiltering";
import { Logger } from "../../utils/logging";
import { normalizeVaultPath } from "../../utils/pathUtils";
import { resolveFileReferenceDetailed } from "../../utils/pathResolution";
import { buildGrepMatcher, MAX_SCANNED_LINE_LENGTH } from "./grepMatcher";

const DEFAULT_LIMIT = 50;

interface FlatMatch {
	path: string;
	line_number: number;
	context: string;
}

interface GrepNotesResultItem {
	path: string;
	matches: Array<{ line_number: number; context: string }>;
}

interface GrepNotesPayload {
	pattern: string;
	is_regex: boolean;
	case_sensitive: boolean;
	scope: "note" | "vault";
	files_searched: number;
	total_matches: number;
	offset: number;
	returned: number;
	has_more: boolean;
	next_offset?: number;
	/** Number of lines skipped because they exceeded the scan-length limit. */
	lines_skipped?: number;
	results: GrepNotesResultItem[];
	message?: string;
}

/**
 * Build a context block for a single matched line: `contextLines` lines before
 * and after, with the hit line marked by `>` and context lines by two spaces.
 */
function buildContextBlock(lines: string[], hitIndex: number, contextLines: number): string {
	const start = Math.max(0, hitIndex - contextLines);
	const end = Math.min(lines.length - 1, hitIndex + contextLines);
	const out: string[] = [];
	for (let i = start; i <= end; i++) {
		const marker = i === hitIndex ? ">" : " ";
		out.push(`${marker} ${i + 1} | ${lines[i]}`);
	}
	return out.join("\n");
}

/**
 * Grep-style search across notes. Unlike `search_notes` (tokenized BM25 ranking),
 * this does exact substring or regex matching at the line level and returns line
 * numbers with surrounding context. Cross-file by default; pass `path` to scope
 * to a single note. Results are paged via `offset`/`limit` over a flat, stable
 * (path-sorted) match list so nothing is silently dropped.
 */
export function createGrepNotesTool(app: App) {
	const pluginData = getData();
	const getConfig = () => pluginData.getSelectedAgent().toolsConfig.grep_notes;
	const toolConfig = getConfig();

	const grepFn = async ({
		pattern,
		path,
		is_regex = false,
		case_sensitive = false,
		path_prefix,
		offset = 0,
		limit = DEFAULT_LIMIT,
	}: {
		pattern: string;
		path?: string;
		is_regex?: boolean;
		case_sensitive?: boolean;
		path_prefix?: string;
		offset?: number;
		limit?: number;
	}): Promise<string> => {
		if (!pattern) {
			return "Error: pattern is empty. Provide a substring or regex to search for.";
		}

		const built = buildGrepMatcher(pattern, is_regex, case_sensitive);
		if (!built.ok) {
			return built.error;
		}
		const matcher = built.matcher;

		// Fresh settings each call to pick up any changes.
		const settings = getConfig()?.settings as GrepNotesSettings | undefined;
		const contextLines = settings?.contextLines ?? 2;

		// Resolve the file set.
		let files: TFile[];
		let scope: "note" | "vault";
		if (path) {
			const resolved = resolveFileReferenceDetailed(app, path);
			if (resolved.status === "not_found") {
				return `Error: File not found for "${path}"`;
			}
			if (resolved.status === "ambiguous") {
				const candidates = resolved.candidates.slice(0, 5).join(", ");
				const suffix = resolved.candidates.length > 5 ? `, and ${resolved.candidates.length - 5} more` : "";
				return `Error: Multiple files match "${path}". Please use a more specific path. Matches: ${candidates}${suffix}.`;
			}
			if (!isTextIndexableFile(resolved.file) || resolved.file.extension.toLowerCase() === "chat") {
				return `Error: "${resolved.file.path}" is not a searchable text note. For PDFs or images, use read_content instead.`;
			}
			files = [resolved.file];
			scope = "note";
		} else {
			files = getIndexableVaultFiles(app.vault)
				.filter((f) => isTextIndexableFile(f) && f.extension.toLowerCase() !== "chat")
				.sort((a, b) => a.path.localeCompare(b.path));
			if (path_prefix) {
				const prefix = normalizeVaultPath(path_prefix);
				files = files.filter((f) => shouldProcessVaultPath(f.path, prefix));
			}
			scope = "vault";
		}

		// Scan every file into a flat match list (stable order for paging).
		const currentProvider = pluginData.getSelectedAgent().chatModel?.provider;
		const store = getPendingChangesStore();
		const flat: FlatMatch[] = [];
		let filesSearched = 0;
		let linesSkipped = 0;

		for (const file of files) {
			if (currentProvider && store.shouldBlockFile(file.path, currentProvider)) {
				continue;
			}
			filesSearched++;
			let content: string;
			try {
				content = await app.vault.cachedRead(file);
			} catch (error) {
				Logger.debug("[grep_notes] Failed to read file", file.path, error);
				continue;
			}
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				// Skip pathologically long lines (minified blobs, data URIs) rather
				// than run the regex against them on the UI thread. Counted and
				// reported so this is a visible limit, not a silent wrong answer.
				if (lines[i].length > MAX_SCANNED_LINE_LENGTH) {
					linesSkipped++;
					continue;
				}
				if (matcher.test(lines[i])) {
					flat.push({
						path: file.path,
						line_number: i + 1,
						context: buildContextBlock(lines, i, contextLines),
					});
				}
			}
		}

		const totalMatches = flat.length;
		const safeOffset = Math.min(offset, totalMatches);
		const page = flat.slice(safeOffset, safeOffset + limit);
		const returned = page.length;
		const hasMore = safeOffset + returned < totalMatches;

		// Group the page back into per-file results, preserving order.
		const results: GrepNotesResultItem[] = [];
		for (const m of page) {
			let last = results[results.length - 1];
			if (!last || last.path !== m.path) {
				last = { path: m.path, matches: [] };
				results.push(last);
			}
			last.matches.push({ line_number: m.line_number, context: m.context });
		}

		const payload: GrepNotesPayload = {
			pattern,
			is_regex,
			case_sensitive,
			scope,
			files_searched: filesSearched,
			total_matches: totalMatches,
			offset: safeOffset,
			returned,
			has_more: hasMore,
			next_offset: hasMore ? safeOffset + returned : undefined,
			lines_skipped: linesSkipped || undefined,
			results,
		};

		const skippedNote =
			linesSkipped > 0
				? ` (${linesSkipped} line${linesSkipped === 1 ? "" : "s"} longer than ${MAX_SCANNED_LINE_LENGTH} chars were skipped)`
				: "";

		if (totalMatches === 0) {
			payload.message = `No matches for "${pattern}" across ${filesSearched} note(s) searched.${skippedNote}`;
		} else if (hasMore) {
			payload.message = `Showing matches ${safeOffset + 1}-${safeOffset + returned} of ${totalMatches}. Call again with offset=${safeOffset + returned} for more.${skippedNote}`;
		} else if (skippedNote) {
			payload.message = `${totalMatches} match${totalMatches === 1 ? "" : "es"} found.${skippedNote}`;
		}

		return JSON.stringify(payload);
	};

	return tool(grepFn, {
		name: toolConfig?.name ?? DEFAULT_TOOLS_CONFIG.grep_notes.name,
		description: toolConfig?.description ?? DEFAULT_TOOLS_CONFIG.grep_notes.description,
		schema: z.object({
			pattern: z.string().describe("Exact text substring or regex pattern to find."),
			path: z
				.string()
				.optional()
				.describe(
					"Optional note path or wiki link to restrict the search to a single note. Omit to search the whole vault.",
				),
			is_regex: z
				.boolean()
				.optional()
				.describe("Treat pattern as a regular expression. Default false (literal substring)."),
			case_sensitive: z.boolean().optional().describe("Case-sensitive matching. Default false."),
			path_prefix: z
				.string()
				.optional()
				.describe(
					"Optional folder to restrict a vault-wide search (e.g. 'Projects'). Ignored when `path` is set.",
				),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"0-based index into the flat match list to start from. Use next_offset from a prior call to page. Default 0.",
				),
			limit: z.number().int().positive().optional().describe("Max matches to return this page. Default 50."),
		}),
	});
}
