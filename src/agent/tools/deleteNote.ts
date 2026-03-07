import type { App } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { resolveVaultFileDetailed } from "../../utils/attachments";
import { getCurrentThreadId } from "./runContext";

export function createDeleteNoteTool(app: App) {
	return tool(
		async ({ path }: { path: string }, runManager) => {
			const store = getPendingChangesStore();

			// Strip wiki-link syntax if present
			let cleanPath = path.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
			cleanPath = cleanPath.split("|")[0].split("#")[0].trim();

			const result = resolveVaultFileDetailed(app, cleanPath);

			if (result.status === "not_found") {
				return `Error: File not found: "${path}". Use search_notes to find the correct path.`;
			}

			if (result.status === "ambiguous") {
				const candidatesList = result.candidates.map((c) => `- ${c}`).join("\n");
				return `Error: Multiple files match "${path}". Please use the full path. Candidates:\n${candidatesList}`;
			}

			const file = result.file;

			if (!file.path.endsWith(".md")) {
				return `Error: Only markdown files (.md) can be deleted. "${file.path}" is not a markdown file.`;
			}

			if (!store.isPathAllowed(file.path)) {
				return `Error: The file "${file.path}" is excluded by the vault's file filter settings.`;
			}

			const originalContent = await app.vault.read(file);
			const threadId = getCurrentThreadId();
			const toolCallId = runManager?.runId ?? "unknown";

			store.addChange(
				{ type: "delete", path: file.path, originalContent },
				toolCallId,
				threadId,
			);

			return `Proposed deletion of "${file.path}" — the user will review and approve or reject this change.`;
		},
		{
			name: "delete_note",
			description:
				"Delete an existing markdown note from the vault. The change is staged for user approval — it will NOT be applied until the user accepts it. The user will see the file content before confirming deletion.",
			schema: z.object({
				path: z
					.string()
					.describe("File path or wiki link reference to delete, e.g. 'Notes/old-note.md' or '[[old-note]]'"),
			}),
		},
	);
}
