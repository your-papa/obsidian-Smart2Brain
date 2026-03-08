import { type App, normalizePath } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { getCurrentThreadId } from "./runContext";

export function createCreateNoteTool(app: App) {
	return tool(
		async ({ path, content }: { path: string; content: string }, runManager) => {
			const store = getPendingChangesStore();
			const normalized = normalizePath(path);

			if (!normalized.endsWith(".md")) {
				return `Error: Only markdown files (.md) can be created. Got: "${normalized}"`;
			}

			if (!store.isPathAllowed(normalized)) {
				return `Error: The path "${normalized}" is excluded by your vault filter settings.`;
			}

			const existing = app.vault.getAbstractFileByPath(normalized);
			if (existing) {
				return `Error: A file already exists at "${normalized}". Use the edit_note tool to modify existing files.`;
			}

			const toolCallId = runManager?.runId ?? "unknown";
			const threadId = getCurrentThreadId();

			store.addChange(
				{ type: "create", path: normalized, content },
				toolCallId,
				threadId,
			);

			return `Proposed creation of "${normalized}" \u2014 the user will review and approve or reject this change.`;
		},
		{
			name: "create_note",
			description:
				"Create a new markdown note in the vault. The change is staged for user approval \u2014 it will NOT be applied until the user accepts it. Use this for creating new notes, templates, or summaries.",
			schema: z.object({
				path: z.string().describe("Vault-relative path for the new file (must end in .md). Example: Notes/my-new-note.md"),
				content: z.string().describe("Full markdown content for the new note"),
			}),
		},
	);
}
