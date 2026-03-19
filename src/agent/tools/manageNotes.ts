import { type App, normalizePath, type TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import type { PendingChange } from "../../types/shared";
import { resolveVaultFileDetailed } from "../../utils/attachments";
import { normalizeReferencePath } from "../../utils/pathResolution";
import { genUUIDv7 } from "../../utils/uuid7Validator";
import { getCurrentThreadId } from "./runContext";

const editSchema = z.object({
	oldText: z
		.string()
		.describe(
			"The exact text to find in the file. Must match exactly once. Include enough surrounding context to make the match unique.",
		),
	newText: z.string().describe("The text to replace oldText with"),
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

const manageNotesSchema = z.object({
	operations: z
		.array(
			z.discriminatedUnion("type", [
				createOperationSchema,
				updateOperationSchema,
				deleteOperationSchema,
				moveOperationSchema,
			]),
		)
		.min(1)
		.describe("Batch of note operations to validate and stage together"),
});

type ManageNotesInput = z.infer<typeof manageNotesSchema>;

function getManageNotesSettings(): {
	allowCreate: boolean;
	allowUpdate: boolean;
	allowDelete: boolean;
	allowMove: boolean;
} {
	const settings = getData().getSelectedAgent().toolsConfig.manage_notes.settings as
		| { allowCreate?: boolean; allowUpdate?: boolean; allowDelete?: boolean; allowMove?: boolean }
		| undefined;

	return {
		allowCreate: settings?.allowCreate ?? true,
		allowUpdate: settings?.allowUpdate ?? true,
		allowDelete: settings?.allowDelete ?? true,
		allowMove: settings?.allowMove ?? true,
	};
}

function getManageNotesToolConfig(): { name: string; description: string } {
	const selectedConfig = getData().getSelectedAgent().toolsConfig.manage_notes;
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

	// Privacy check
	const currentProvider = getData().getSelectedAgent().chatModel?.provider;
	if (currentProvider && store.shouldBlockFile(file.path, currentProvider)) {
		return {
			error: `Error in operation ${operationNumber}: The file "${file.path}" is marked as private and cannot be processed by the current provider. Switch to a trusted provider or remove the file from the privacy list.`,
		};
	}

	return { file };
}

function applySequentialEdits(
	originalContent: string,
	edits: { oldText: string; newText: string }[],
	path: string,
	operationNumber: number,
): { content: string } | { error: string } {
	let content = originalContent;

	for (let i = 0; i < edits.length; i++) {
		const { oldText, newText } = edits[i];
		const idx = content.indexOf(oldText);
		if (idx === -1) {
			return {
				error: `Error in operation ${operationNumber}, edit ${i + 1}: Could not find the specified text in "${path}". Make sure oldText matches exactly (including whitespace and newlines).${i > 0 ? " Note: edits are applied sequentially, so this oldText must match the content after earlier edits were applied." : ""}`,
			};
		}
		if (content.includes(oldText, idx + 1)) {
			return {
				error: `Error in operation ${operationNumber}, edit ${i + 1}: The specified oldText appears multiple times in "${path}". Include more surrounding context to make it unique.`,
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

export function createManageNotesTool(app: App) {
	const toolConfig = getManageNotesToolConfig();

	return tool(
		async ({ operations }: ManageNotesInput, runManager) => {
			const store = getPendingChangesStore();
			const settings = getManageNotesSettings();
			const seenPaths = new Set<string>();
			const stagedChanges: PendingChange[] = [];

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

					// Privacy check for create target
					const currentProvider = getData().getSelectedAgent().chatModel?.provider;
					if (currentProvider && store.shouldBlockFile(normalizedPath, currentProvider)) {
						return `Error in operation ${operationNumber}: The path "${normalizedPath}" is in a private area and cannot be processed by the current provider. Switch to a trusted provider or remove the path from the privacy list.`;
					}

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

					const result = validateExistingMarkdownFile(app, operation.path, operationNumber, "update");
					if ("error" in result) return result.error;

					const duplicateError = ensureUniqueTarget(seenPaths, result.file.path, operationNumber);
					if (duplicateError) return duplicateError;

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
					const result = validateExistingMarkdownFile(app, operation.path, operationNumber, "delete");
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

				if (!settings.allowMove) {
					return `Error in operation ${operationNumber}: Move operations are disabled for this agent.`;
				}

				const result = validateExistingMarkdownFile(app, operation.path, operationNumber, "move");
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

				// Privacy check for move destination
				const moveProvider = getData().getSelectedAgent().chatModel?.provider;
				if (moveProvider && store.shouldBlockFile(normalizedNewPath, moveProvider)) {
					return `Error in operation ${operationNumber}: The destination path "${normalizedNewPath}" is in a private area and cannot be processed by the current provider. Switch to a trusted provider or remove the path from the privacy list.`;
				}

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
			}

			const threadId = getCurrentThreadId();
			const toolCallId = runManager?.runId ?? genUUIDv7();
			store.addChanges(stagedChanges, toolCallId, threadId);

			return `Proposed ${stagedChanges.length} note operation(s) across ${seenPaths.size} path(s) (${summarizeOperations(stagedChanges)}) — the user will review and approve or reject these changes.`;
		},
		{
			name: toolConfig.name,
			description: toolConfig.description,
			schema: manageNotesSchema,
		},
	);
}
