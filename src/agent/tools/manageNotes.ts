import { type App, normalizePath, type TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import type { PendingChange } from "../../types/shared";
import { resolveVaultFileDetailed } from "../../utils/attachments";
import { memoriesDir } from "../../utils/agentPaths";
import { getIndexableVaultFiles, isTextIndexableFile, shouldProcessVaultPath } from "../../utils/fileFiltering";
import { normalizeVaultPath } from "../../utils/pathUtils";
import { normalizeReferencePath } from "../../utils/pathResolution";
import { genUUIDv7 } from "../../utils/uuid7Validator";
import { buildGrepMatcher } from "./grepMatcher";

const editSchema = z.object({
	oldText: z
		.string()
		.describe(
			"The text to find. Without replace_all, must match exactly once — include enough surrounding context to make it unique. With replace_all, every occurrence is replaced.",
		),
	newText: z
		.string()
		.describe("The text to replace oldText with. Supports $1/$2 back-references when is_regex is true."),
	is_regex: z.boolean().optional().describe("Treat oldText as a regular expression. Default false."),
	replace_all: z
		.boolean()
		.optional()
		.describe("Replace all occurrences instead of requiring a single unique match. Default false."),
});

const createOperationSchema = z.object({
	type: z.literal("create"),
	path: z
		.string()
		.describe("Vault-relative path for the new markdown note. Must end in .md. Example: Notes/my-note.md"),
	content: z.string().describe("Full markdown content for the new note"),
});

const updateOperationSchema = z.object({
	type: z.literal("update"),
	path: z.string().describe("File path or wiki link reference, e.g. 'Notes/todo.md' or '[[todo]]'"),
	edits: z.array(editSchema).min(1).describe("Sequential search-and-replace edits to apply"),
});

const deleteOperationSchema = z.object({
	type: z.literal("delete"),
	path: z.string().describe("File path or wiki link reference to delete, e.g. 'Notes/old-note.md' or '[[old-note]]'"),
});

const moveOperationSchema = z.object({
	type: z.literal("move"),
	path: z.string().describe("Current file path or wiki link reference to move"),
	newPath: z.string().describe("Destination vault-relative path for the markdown note. Must end in .md."),
});

const replaceOperationSchema = z.object({
	type: z.literal("replace"),
	find: z.string().describe("Exact text substring or regex pattern to find across notes."),
	replace: z.string().describe("Replacement text. Supports $1/$2 back-references when is_regex is true."),
	is_regex: z.boolean().optional().describe("Treat find as a regular expression. Default false."),
	case_sensitive: z.boolean().optional().describe("Case-sensitive matching. Default false."),
	path_prefix: z
		.string()
		.optional()
		.describe("Optional folder to scope the replace (e.g. 'Projects'). Omit to replace across the whole vault."),
});

const manageNotesSchema = z.object({
	operations: z
		.array(
			z.discriminatedUnion("type", [
				createOperationSchema,
				updateOperationSchema,
				deleteOperationSchema,
				moveOperationSchema,
				replaceOperationSchema,
			]),
		)
		.min(1)
		.describe("Batch of note operations to validate and stage together"),
});

type ManageNotesInput = z.infer<typeof manageNotesSchema>;

function getManageNotesSettings(agentId: string): {
	allowCreate: boolean;
	allowUpdate: boolean;
	allowDelete: boolean;
	allowMove: boolean;
} {
	const settings = (getData().getAgent(agentId) ?? getData().getSelectedAgent()).toolsConfig.manage_notes.settings as
		| { allowCreate?: boolean; allowUpdate?: boolean; allowDelete?: boolean; allowMove?: boolean }
		| undefined;

	return {
		allowCreate: settings?.allowCreate ?? true,
		allowUpdate: settings?.allowUpdate ?? true,
		allowDelete: settings?.allowDelete ?? true,
		allowMove: settings?.allowMove ?? true,
	};
}

function getManageNotesToolConfig(agentId: string): { name: string; description: string } {
	const selectedConfig = (getData().getAgent(agentId) ?? getData().getSelectedAgent()).toolsConfig.manage_notes;
	const defaultConfig = DEFAULT_TOOLS_CONFIG.manage_notes;

	return {
		name: selectedConfig?.name ?? defaultConfig.name,
		description: selectedConfig?.description ?? defaultConfig.description,
	};
}

function ensureUniqueTarget(seenPaths: Set<string>, path: string, operationNumber: number): string | null {
	if (seenPaths.has(path)) {
		return `Error in operation ${operationNumber}: "${path}" is targeted more than once in this batch. Combine edits for the same file into a single update operation.`;
	}

	seenPaths.add(path);
	return null;
}

function validateExistingMarkdownFile(
	app: App,
	path: string,
	operationNumber: number,
	action: "update" | "delete" | "move",
	agentId: string,
): { file: TFile } | { error: string } {
	const store = getPendingChangesStore();
	const cleanPath = normalizeReferencePath(path);
	const result = resolveVaultFileDetailed(app, cleanPath);

	if (result.status === "not_found") {
		const hint =
			action === "update"
				? "Use a create operation to add a new file, or search_notes to find the correct path."
				: "Use search_notes to find the correct path.";
		return {
			error: `Error in operation ${operationNumber}: File not found: "${path}". ${hint}`,
		};
	}

	if (result.status === "ambiguous") {
		const candidatesList = result.candidates.map((candidate) => `- ${candidate}`).join("\n");
		return {
			error: `Error in operation ${operationNumber}: Multiple files match "${path}". Please use the full path. Candidates:\n${candidatesList}`,
		};
	}

	const file = result.file;
	if (!file.path.endsWith(".md")) {
		return {
			error: `Error in operation ${operationNumber}: Only markdown files (.md) can be ${action}d. "${file.path}" is not a markdown file.`,
		};
	}

	if (!store.isPathAllowed(file.path)) {
		return {
			error: `Error in operation ${operationNumber}: The file "${file.path}" is excluded by the vault's file filter settings.`,
		};
	}

	// Privacy check — use the agent that owns this run, not the global selection.
	//
	// Only for update/delete: those read the note into the model's context, which
	// is exactly what the privacy filter exists to prevent. A move never reads
	// content — it applies as a bare `fileManager.renameFile` — so blocking one
	// on a private source would apply an exfiltration control to an operation
	// that cannot exfiltrate. (The agent had to name the source path to move it,
	// so the path is already in context before this check would run.) Moves that
	// take a note *out* of a private location are surfaced as a warning at review
	// time instead — that's a vault-state concern, and unlike provider trust it
	// applies whichever provider is selected.
	if (action !== "move") {
		const currentProvider = (getData().getAgent(agentId) ?? getData().getSelectedAgent()).chatModel?.provider;
		if (currentProvider && store.shouldBlockFile(file.path, currentProvider)) {
			return {
				error: `Error in operation ${operationNumber}: The file "${file.path}" is private for the current provider. Switch to a trusted provider or adjust provider access settings.`,
			};
		}
	}

	return { file };
}

function applySequentialEdits(
	originalContent: string,
	edits: { oldText: string; newText: string; is_regex?: boolean; replace_all?: boolean }[],
	path: string,
	operationNumber: number,
): { content: string } | { error: string } {
	let content = originalContent;

	for (let i = 0; i < edits.length; i++) {
		const { oldText, newText, is_regex = false, replace_all = false } = edits[i];
		const sequentialNote =
			i > 0
				? " Note: edits are applied sequentially, so this oldText must match the content after earlier edits were applied."
				: "";

		if (is_regex) {
			const built = buildGrepMatcher(oldText, true, true);
			if (!built.ok) {
				return {
					error: `Error in operation ${operationNumber}, edit ${i + 1}: ${built.error.replace(/^Error: /, "")}`,
				};
			}
			const matcher = built.matcher;
			// A regex over an over-length note can backtrack catastrophically past
			// what the ReDoS screen catches. Refuse rather than freeze the UI. This
			// runs before the zero-width check so we never scan an over-length note.
			if (content.length > matcher.maxInputLength) {
				return {
					error: `Error in operation ${operationNumber}, edit ${i + 1}: "${path}" is ${content.length} characters, too large to search safely with a regex (limit ${matcher.maxInputLength}). Use a literal (non-regex) find, or split the note.`,
				};
			}
			// Reject patterns whose match consumes no characters (`\b`, `(?=x)`, `^`,
			// `$`, `x*`, …). Replacing a zero-width match inserts the replacement at
			// every boundary instead of substituting text — never what the caller
			// intends. Checked against the actual content so anchored patterns that
			// DO consume text (`\bword`) are allowed.
			if (matcher.hasZeroWidthMatch(content)) {
				return {
					error: `Error in operation ${operationNumber}, edit ${i + 1}: The regex matches an empty (zero-width) position in "${path}", so replacing it would insert text at every boundary rather than substitute. Use a pattern that matches concrete text.`,
				};
			}
			const occurrences = matcher.count(content);
			if (occurrences === 0) {
				return {
					error: `Error in operation ${operationNumber}, edit ${i + 1}: Could not find a match for the regex in "${path}".${sequentialNote}`,
				};
			}
			if (!replace_all && occurrences > 1) {
				return {
					error: `Error in operation ${operationNumber}, edit ${i + 1}: The regex matches multiple times in "${path}". Make it more specific, or set replace_all to replace every match.`,
				};
			}
			// Regex replace ($1/$2 back-references honored). Use the matcher's own
			// compiled regex so the replace can never diverge from the count above:
			// global replaces every match, non-global replaces only the first.
			content = content.replace(replace_all ? matcher.globalRegex() : matcher.singleRegex(), newText);
			continue;
		}

		// Literal find-and-replace — plain string ops so `$` in newText is not treated as a back-reference.
		const idx = content.indexOf(oldText);
		if (idx === -1) {
			return {
				error: `Error in operation ${operationNumber}, edit ${i + 1}: Could not find the specified text in "${path}". Make sure oldText matches exactly (including whitespace and newlines).${sequentialNote}`,
			};
		}
		if (replace_all) {
			content = content.split(oldText).join(newText);
			continue;
		}
		if (content.includes(oldText, idx + 1)) {
			return {
				error: `Error in operation ${operationNumber}, edit ${i + 1}: The specified oldText appears multiple times in "${path}". Include more surrounding context to make it unique, or set replace_all to replace every occurrence.`,
			};
		}
		content = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
	}

	return { content };
}

function summarizeOperations(changes: PendingChange[]): string {
	const counts = {
		create: 0,
		update: 0,
		delete: 0,
		move: 0,
	};

	for (const change of changes) {
		counts[change.type]++;
	}

	return [
		counts.create > 0 ? `${counts.create} create${counts.create === 1 ? "" : "s"}` : null,
		counts.update > 0 ? `${counts.update} update${counts.update === 1 ? "" : "s"}` : null,
		counts.delete > 0 ? `${counts.delete} delete${counts.delete === 1 ? "" : "s"}` : null,
		counts.move > 0 ? `${counts.move} move${counts.move === 1 ? "" : "s"}` : null,
	]
		.filter((item): item is string => item !== null)
		.join(", ");
}

/**
 * True when `path` is the folder itself or nested inside it. Both are normalized
 * first so a trailing slash or `.`-segment doesn't cause a false negative. Used to
 * scope memory auto-approval strictly to the agent's memory folder — mirrors the
 * containment guard in ObsidianChatManager so nothing outside the folder is ever
 * auto-applied.
 */
function isInsideFolder(path: string, folder: string): boolean {
	const p = normalizePath(path);
	const f = normalizePath(folder);
	if (f === "" || f === "/") return true;
	return p === f || p.startsWith(`${f}/`);
}

/**
 * Reads the effective memory config for the agent that owns this run. Falls back
 * to the selected agent (api path with no agentId). The memory folder is the global
 * `Agents/Memories/`.
 */
function getMemoryConfig(agentId: string): { enabled: boolean; folder: string } {
	const agent = getData().getAgent(agentId) ?? getData().getSelectedAgent();
	return {
		enabled: agent?.memoryEnabled ?? false,
		folder: normalizePath(memoriesDir()),
	};
}

/**
 * Decides whether a staged change should auto-apply because it targets the memory
 * folder. Create/update/delete key off `path`; a move auto-applies only when it
 * lands INSIDE the folder (reorganizing within/into memory) — a move OUT of the
 * folder stays staged so the user still reviews removing a note from memory.
 */
function isMemoryChange(change: PendingChange, folder: string): boolean {
	if (change.type === "move") return isInsideFolder(change.newPath, folder);
	return isInsideFolder(change.path, folder);
}

/**
 * Validates and stages a batch of note operations into the pending-changes store
 * for user review, returning the human-readable summary string. Shared by the
 * `manage_notes` tool and the public S2B api (`api.manageNotes`) so both write
 * paths stage identically — nothing is applied here; the user approves/rejects
 * staged changes separately.
 *
 * @param toolCallId groups the staged changes; defaults to a fresh UUID when the
 *   caller has no run id (e.g. the api path outside a tool run).
 */
export async function stageNoteOperations(
	app: App,
	operations: ManageNotesInput["operations"],
	threadId: string,
	toolCallId?: string,
	agentId = "",
): Promise<string> {
	const store = getPendingChangesStore();
	const settings = getManageNotesSettings(agentId);
	const seenPaths = new Set<string>();
	const stagedChanges: PendingChange[] = [];
	// Paths this update touches that ANOTHER chat already has a pending update for.
	// Collected during the loop (before this batch is staged) and surfaced in the
	// result so the model knows a concurrent chat is editing the same file — the
	// update-dedup only collapses same-thread duplicates, not cross-thread ones.
	const crossThreadPaths = new Set<string>();
	// Notes skipped by a vault-wide regex replace because they exceed the safe
	// regex input length. Accumulated across ops so a partial-success summary can
	// still surface the skip (the pure-skip case is reported per-op below).
	let tooLargeSkippedTotal = 0;
	// Notes a vault-wide replace skipped because an *earlier* operation in this
	// same batch already staged a change to them. Skipping avoids staging two
	// conflicting diffs for one file (the second would be un-appliable), but the
	// skip must be surfaced — otherwise a multi-op batch silently under-applies.
	const conflictSkippedPaths = new Set<string>();

	for (let i = 0; i < operations.length; i++) {
		const operation = operations[i];
		const operationNumber = i + 1;

		if (operation.type === "create") {
			if (!settings.allowCreate) {
				return `Error in operation ${operationNumber}: Create operations are disabled for this agent.`;
			}

			const normalizedPath = normalizePath(operation.path);
			const duplicateError = ensureUniqueTarget(seenPaths, normalizedPath, operationNumber);
			if (duplicateError) return duplicateError;

			if (!normalizedPath.endsWith(".md")) {
				return `Error in operation ${operationNumber}: Only markdown files (.md) can be created. Got: "${normalizedPath}"`;
			}

			if (!store.isPathAllowed(normalizedPath)) {
				return `Error in operation ${operationNumber}: The path "${normalizedPath}" is excluded by your vault filter settings.`;
			}

			// No privacy check here, deliberately. The privacy filter is an
			// exfiltration control: it stops vault content reaching an untrusted
			// provider. A create flows the other way — the content originates from
			// the model, so nothing private leaves the vault. Write authorization is
			// already covered by `settings.allowCreate` plus the staged-review step
			// in `pendingChangesStore`, where the user sees the path and content
			// before `vault.create` ever runs. Gating creates on `shouldBlockFile`
			// also made behaviour depend on `privacyMode`: under `public-by-default`
			// tag/property rules silently missed (the file doesn't exist yet, so
			// there's no frontmatter to match), while `private-by-default` blocked
			// every create outright. `update`/`delete`/`move` keep their checks —
			// those read existing notes into the model's context.

			const existing = app.vault.getAbstractFileByPath(normalizedPath);
			if (existing) {
				return `Error in operation ${operationNumber}: A file already exists at "${normalizedPath}". Use an update operation to modify existing files.`;
			}

			stagedChanges.push({
				type: "create",
				path: normalizedPath,
				content: operation.content,
			});
			continue;
		}

		if (operation.type === "update") {
			if (!settings.allowUpdate) {
				return `Error in operation ${operationNumber}: Update operations are disabled for this agent.`;
			}

			const result = validateExistingMarkdownFile(app, operation.path, operationNumber, "update", agentId);
			if ("error" in result) return result.error;

			const duplicateError = ensureUniqueTarget(seenPaths, result.file.path, operationNumber);
			if (duplicateError) return duplicateError;

			if (store.countOtherThreadsPendingUpdate(result.file.path, threadId) > 0) {
				crossThreadPaths.add(result.file.path);
			}

			const originalContent = await app.vault.read(result.file);
			const editResult = applySequentialEdits(
				originalContent,
				operation.edits,
				result.file.path,
				operationNumber,
			);
			if ("error" in editResult) return editResult.error;

			stagedChanges.push({
				type: "update",
				path: result.file.path,
				originalContent,
				newContent: editResult.content,
			});
			continue;
		}

		if (!settings.allowDelete) {
			if (operation.type === "delete") {
				return `Error in operation ${operationNumber}: Delete operations are disabled for this agent.`;
			}
		}

		if (operation.type === "delete") {
			const result = validateExistingMarkdownFile(app, operation.path, operationNumber, "delete", agentId);
			if ("error" in result) return result.error;

			const duplicateError = ensureUniqueTarget(seenPaths, result.file.path, operationNumber);
			if (duplicateError) return duplicateError;

			stagedChanges.push({
				type: "delete",
				path: result.file.path,
				originalContent: await app.vault.read(result.file),
			});
			continue;
		}

		if (operation.type === "move") {
			if (!settings.allowMove) {
				return `Error in operation ${operationNumber}: Move operations are disabled for this agent.`;
			}

			const result = validateExistingMarkdownFile(app, operation.path, operationNumber, "move", agentId);
			if ("error" in result) return result.error;

			const sourceDuplicateError = ensureUniqueTarget(seenPaths, result.file.path, operationNumber);
			if (sourceDuplicateError) return sourceDuplicateError;

			const normalizedNewPath = normalizePath(operation.newPath);
			if (!normalizedNewPath.endsWith(".md")) {
				return `Error in operation ${operationNumber}: Only markdown files (.md) can be moved. Got destination "${normalizedNewPath}"`;
			}

			const destinationDuplicateError = ensureUniqueTarget(seenPaths, normalizedNewPath, operationNumber);
			if (destinationDuplicateError) return destinationDuplicateError;

			if (!store.isPathAllowed(normalizedNewPath)) {
				return `Error in operation ${operationNumber}: The destination path "${normalizedNewPath}" is excluded by your vault filter settings.`;
			}

			// No privacy check on the destination, matching `create`: placing a file
			// into a private location writes nothing out to the provider, and the
			// staged-review step is the write-authorization gate. The check here was
			// also inverted relative to the risk — it blocked moves *into* privacy
			// (harmless) while permitting moves *out of* it, which is the case that
			// actually changes how later operations treat the note.

			if (result.file.path === normalizedNewPath) {
				return `Error in operation ${operationNumber}: Source and destination are the same path "${normalizedNewPath}".`;
			}

			const existingDestination = app.vault.getAbstractFileByPath(normalizedNewPath);
			if (existingDestination) {
				return `Error in operation ${operationNumber}: A file already exists at "${normalizedNewPath}".`;
			}

			stagedChanges.push({
				type: "move",
				path: result.file.path,
				newPath: normalizedNewPath,
			});
			continue;
		}

		// operation.type === "replace" — vault-wide (or folder-scoped) find-and-replace.
		if (!settings.allowUpdate) {
			return `Error in operation ${operationNumber}: Replace operations require update permission, which is disabled for this agent.`;
		}

		const built = buildGrepMatcher(operation.find, operation.is_regex ?? false, operation.case_sensitive ?? false);
		if (!built.ok) {
			return `Error in operation ${operationNumber}: ${built.error.replace(/^Error: /, "")}`;
		}
		const matcher = built.matcher;

		// Structurally empty-matchable patterns (`x*`, `^`, `$`, `a?`) match at
		// every position regardless of content, so reject upfront before scanning
		// the vault. Content-dependent zero-width patterns (`\b`, `(?=x)`) can only
		// be detected against real text and are caught in the loop below.
		if (operation.is_regex && matcher.matchesEmpty) {
			return `Error in operation ${operationNumber}: The regex "${operation.find}" matches an empty (zero-width) position, so replacing it would insert text everywhere rather than substitute. Use a pattern that matches concrete text.`;
		}

		let candidateFiles = getIndexableVaultFiles(app.vault).filter(
			(f) => f.extension.toLowerCase() === "md" && isTextIndexableFile(f),
		);
		if (operation.path_prefix) {
			const prefix = normalizeVaultPath(operation.path_prefix);
			candidateFiles = candidateFiles.filter((f) => shouldProcessVaultPath(f.path, prefix));
		}
		candidateFiles.sort((a, b) => a.path.localeCompare(b.path));

		const replaceProvider = (getData().getAgent(agentId) ?? getData().getSelectedAgent()).chatModel?.provider;
		let notesSearched = 0;
		let notesChanged = 0;
		let notesTooLarge = 0;
		let notesConflictSkipped = 0;

		for (const file of candidateFiles) {
			if (!store.isPathAllowed(file.path)) continue;
			if (replaceProvider && store.shouldBlockFile(file.path, replaceProvider)) continue;

			// Guard against conflicting with another op in this same batch: an
			// earlier op already staged a change to this file, so staging a second
			// diff from the same original content would be un-appliable. Record the
			// skip so it is surfaced rather than silently under-applied.
			if (seenPaths.has(file.path)) {
				conflictSkippedPaths.add(file.path);
				notesConflictSkipped++;
				continue;
			}

			notesSearched++;
			const originalContent = await app.vault.read(file);
			// Skip notes too large to regex safely (unbounded backtracking would
			// freeze the UI). Only regex ops are affected — a literal find is a
			// plain string scan with no backtracking. Counted and surfaced below
			// so the skip is visible, not a silent wrong answer.
			if (operation.is_regex && originalContent.length > matcher.maxInputLength) {
				notesTooLarge++;
				tooLargeSkippedTotal++;
				continue;
			}
			// Content-dependent zero-width guard: `\b`, `(?=x)` etc. match without
			// consuming characters, so replacing them scatters the replacement across
			// every boundary. This is a property of the pattern, not the file — the
			// first note that exhibits it proves the pattern is wrong for a replace —
			// so abort the whole operation rather than silently skipping notes.
			if (operation.is_regex && matcher.hasZeroWidthMatch(originalContent)) {
				return `Error in operation ${operationNumber}: The regex "${operation.find}" matches an empty (zero-width) position in "${file.path}", so replacing it would insert text at every boundary rather than substitute. Use a pattern that matches concrete text.`;
			}
			if (!matcher.test(originalContent)) continue;

			const newContent = operation.is_regex
				? originalContent.replace(matcher.globalRegex(), operation.replace)
				: originalContent.split(operation.find).join(operation.replace);

			if (newContent === originalContent) continue;

			seenPaths.add(file.path);
			if (store.countOtherThreadsPendingUpdate(file.path, threadId) > 0) {
				crossThreadPaths.add(file.path);
			}
			stagedChanges.push({
				type: "update",
				path: file.path,
				originalContent,
				newContent,
			});
			notesChanged++;
		}

		if (notesChanged === 0) {
			// If the only reason nothing staged is that every candidate was
			// conflict-skipped (an earlier op in this batch already changed those
			// files), do NOT abort the batch — the earlier op's change is valid and
			// the conflict is surfaced in the final summary. Aborting here would
			// discard that valid change. Only hard-error on a genuine no-match.
			if (notesConflictSkipped > 0) {
				continue;
			}
			const tooLargeNote =
				notesTooLarge > 0
					? ` ${notesTooLarge} note(s) were skipped as too large to search with a regex safely — use a literal find or split them.`
					: "";
			return `Error in operation ${operationNumber}: No occurrences of "${operation.find}" found across ${notesSearched} note(s) searched${operation.path_prefix ? ` under "${operation.path_prefix}"` : ""}. Nothing was staged.${tooLargeNote}`;
		}
	}

	const resolvedToolCallId = toolCallId ?? genUUIDv7();
	const entryIds = store.addChanges(stagedChanges, resolvedToolCallId, threadId);

	// Auto-apply changes that target the agent's memory folder: the agent governs
	// that folder itself, so those writes shouldn't wait in the review queue. We
	// reuse acceptChange (locking, conflict/existence checks, folder creation)
	// rather than a parallel write path. Non-memory changes stay pending.
	const memory = getMemoryConfig(agentId);
	let autoAppliedCount = 0;
	const autoApplyFailures: string[] = [];
	if (memory.enabled) {
		for (let i = 0; i < stagedChanges.length; i++) {
			const change = stagedChanges[i];
			if (!isMemoryChange(change, memory.folder)) continue;
			try {
				// Sequential await respects the store's per-file lock ordering.
				await store.acceptChange(entryIds[i]);
				autoAppliedCount++;
			} catch (e) {
				const path = change.type === "move" ? change.newPath : change.path;
				autoApplyFailures.push(`"${path}": ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	const stagedCount = stagedChanges.length - autoAppliedCount - autoApplyFailures.length;
	let summary: string;
	if (autoAppliedCount > 0 && stagedCount === 0 && autoApplyFailures.length === 0) {
		summary = `Saved ${autoAppliedCount} memory note operation(s) (${summarizeOperations(stagedChanges)}) to \`${memory.folder}/\` — applied automatically, no user review needed.`;
	} else {
		summary = `Proposed ${stagedChanges.length} note operation(s) across ${seenPaths.size} path(s) (${summarizeOperations(stagedChanges)}).`;
		if (autoAppliedCount > 0) {
			summary += ` ${autoAppliedCount} targeting \`${memory.folder}/\` were applied automatically (memory).`;
		}
		if (stagedCount > 0) {
			summary += ` ${stagedCount} will be reviewed by the user, who will approve or reject them.`;
		}
	}
	if (autoApplyFailures.length > 0) {
		summary += ` ${autoApplyFailures.length} memory write(s) could not be applied: ${autoApplyFailures.join("; ")}.`;
	}
	if (crossThreadPaths.size > 0) {
		const paths = [...crossThreadPaths].map((p) => `"${p}"`).join(", ");
		summary += ` Note: another chat already has a pending update to ${paths}. Both proposals target the same file — whichever is accepted first wins, and the other may then be un-appliable (its expected original content will no longer match). Coordinate or avoid duplicating edits across chats.`;
	}
	if (tooLargeSkippedTotal > 0) {
		summary += ` ${tooLargeSkippedTotal} note(s) were skipped as too large to search with a regex safely — use a literal find or split them.`;
	}
	if (conflictSkippedPaths.size > 0) {
		summary += ` ${conflictSkippedPaths.size} note(s) matched a later replace operation but were skipped because an earlier operation in this batch already modified them — run those replacements in a separate manage_notes call to apply them.`;
	}
	return summary;
}

/** Reads the thread id LangGraph threads through the run config's `configurable`
 * (set by Agent.buildRunnableConfig). Resolving per-invocation from config —
 * rather than a module global — is what makes concurrent agent runs stage their
 * note changes under the correct thread. Subagent (`task`) invocations keep this
 * key too: the subagent config filter in Agent.ts strips only `__pregel*` /
 * `checkpoint*`, so `thread_id` survives into the nested run.
 *
 * Note: for a Zod-schema `tool()`, LangChain passes the merged RunnableConfig as
 * the SECOND callback argument (alongside `runId`); the third arg is undefined.
 * So we read both `runId` and `configurable.thread_id` off the same object. */
function resolveThreadIdFromConfig(config: RunnableConfig | undefined): string {
	const threadId = config?.configurable?.thread_id;
	if (typeof threadId !== "string" || threadId.length === 0) {
		throw new Error("No active agent run — cannot determine threadId for note staging");
	}
	return threadId;
}

export function createManageNotesTool(app: App, agentId = "") {
	const toolConfig = getManageNotesToolConfig(agentId);

	return tool(
		async ({ operations }: ManageNotesInput, config: RunnableConfig & { runId?: string }) => {
			const threadId = resolveThreadIdFromConfig(config);
			return stageNoteOperations(app, operations, threadId, config?.runId, agentId);
		},
		{
			name: toolConfig.name,
			description: toolConfig.description,
			schema: manageNotesSchema,
		},
	);
}
