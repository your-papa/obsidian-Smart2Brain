import type { App } from "obsidian";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { SearchFilter, SearchResult } from "../../vectorstore";
import type { SearchAlgorithm } from "../../types/plugin";
import type { SkillsService } from "../../skills/SkillsService";
import { performSearch } from "../tools/searchNotes";
import { stageNoteOperations } from "../tools/manageNotes";
import { readNoteContent } from "../tools/readContent";
import { createGetAllTagsTool } from "../tools/getAllTags";
import { createGetPropertiesTool } from "../tools/getProperties";
import { createListDirectoryTool } from "../tools/listDirectory";

/** A single note operation accepted by {@link S2bApi.manageNotes}. */
export type NoteOperation =
	| { type: "create"; path: string; content: string }
	| { type: "update"; path: string; edits: { oldText: string; newText: string }[] }
	| { type: "delete"; path: string }
	| { type: "move"; path: string; newPath: string };

export interface SearchNotesApiOptions {
	/** Search term. Omit (with a filter) to browse by filter only. */
	query?: string;
	/** "lexical" (default) or "hybrid". Hybrid requires an embedding model. */
	algorithm?: SearchAlgorithm;
	/** Optional metadata/path filter. */
	filter?: SearchFilter;
	/** Trim the returned results (applied after ranking). */
	maxResults?: number;
}

/**
 * Smart Second Brain's public JavaScript API.
 *
 * Exposed as the plugin's `api` object so it can be scripted the same way any
 * other Obsidian plugin's `api` is — including by the agent via the
 * `exec_smart-second-brain` code-exec integration, by `dataviewjs` blocks, and
 * by other plugins. Every method delegates to the *same* core logic the built-in
 * agent tools use, so the two paths never diverge.
 *
 * Writes stage for user review: {@link S2bApi.manageNotes} returns a summary and
 * queues the change in the pending-changes store — it does not apply anything.
 */
export interface S2bApi {
	/** Search the vault. Returns ranked results (raw objects). */
	searchNotes(options: SearchNotesApiOptions): Promise<SearchResult[]>;
	/**
	 * Validate and STAGE a batch of note operations for user review. Returns the
	 * human-readable summary; nothing is written until the user approves.
	 */
	manageNotes(operations: NoteOperation[]): Promise<string>;
	/** Read a note/PDF/text/Excalidraw file (supports `[[Note#Section]]` fragments). */
	readContent(path: string): Promise<string>;
	/** List all tags in the vault. */
	getAllTags(): Promise<string>;
	/** Get a note's frontmatter, or (no arg) all property keys in the vault. */
	getProperties(noteName?: string): Promise<string>;
	/** List the vault's directory tree. */
	listDirectory(options?: { path?: string; recursive?: boolean; maxDepth?: number }): Promise<unknown>;
	/** Load a skill's full instructions by name (returns null if unknown). */
	loadSkill(name: string): Promise<string | null>;
}

export interface CreateS2bApiOptions {
	imageProcessor?: BaseChatModel;
	pdfProcessor?: BaseChatModel;
	skillsService?: SkillsService;
}

/**
 * Build the public {@link S2bApi} object. Reuses the extracted core functions
 * (`performSearch`, `stageNoteOperations`, `readNoteContent`) for the hot-path
 * capabilities and the bound tool instances for the simpler ones so behavior
 * matches the agent tools exactly.
 */
export function createS2bApi(app: App, options: CreateS2bApiOptions = {}): S2bApi {
	const { imageProcessor, pdfProcessor, skillsService } = options;

	// Simple tools wrap self-contained logic in their factory closures; invoke the
	// bound instances so we don't duplicate that logic here.
	const getAllTagsTool = createGetAllTagsTool(app);
	const getPropertiesTool = createGetPropertiesTool(app);
	const listDirectoryTool = createListDirectoryTool(app);

	return {
		async searchNotes({ query = "", algorithm = "lexical", filter, maxResults }) {
			const results = await performSearch(app, query, algorithm, filter);
			return typeof maxResults === "number" && maxResults >= 0 ? results.slice(0, maxResults) : results;
		},

		manageNotes(operations) {
			return stageNoteOperations(app, operations);
		},

		readContent(path) {
			return readNoteContent(app, path, { imageProcessor, pdfProcessor });
		},

		getAllTags() {
			return getAllTagsTool.invoke({});
		},

		getProperties(noteName) {
			return getPropertiesTool.invoke({ note_name: noteName });
		},

		listDirectory(opts = {}) {
			return listDirectoryTool.invoke(opts);
		},

		async loadSkill(name) {
			if (!skillsService) return null;
			const skill = await skillsService.loadSkill(name);
			return skill?.content ?? null;
		},
	};
}
