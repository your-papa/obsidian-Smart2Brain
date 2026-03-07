import { type App } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { resolveVaultFileDetailed } from "../../utils/attachments";
import { getCurrentThreadId } from "./runContext";

export function createUpdateNoteTool(app: App) {
	return tool(
		async ({ path, content }: { path: string; content: string }, runManager) => {
			const store = getPendingChangesStore();

			// Strip wiki-link syntax if present
			let cleanPath = path.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
			// Split off any heading/alias part
			cleanPath = cleanPath.split("|")[0].split("#")[0].trim();

			const result = resolveVaultFileDetailed(app, cleanPath);

			if (result.status === "not_found") {
				return `Error: File not found: "${path}". Use create_note to create a new file, or search_notes to find the correct path.`;
			}

			if (result.status === "ambiguous") {
				const candidatesList = result.candidates.map((c) => `- ${c}`).join("\n");
				return `Error: Multiple files match "${path}". Please use the full path. Candidates:\n${candidatesList}`;
			}

			const file = result.file;

			if (!file.path.endsWith(".md")) {
				return `Error: Only markdown files (.md) can be updated. "${file.path}" is not a markdown file.`;
			}

			if (!store.isPathAllowed(file.path)) {
				return `Error: The file "${file.path}" is excluded by the vault's file filter settings.`;
			}

			const originalContent = await app.vault.read(file);
			const threadId = getCurrentThreadId();
			const toolCallId = runManager?.runId ?? "unknown";

			store.addChange(
				{ type: "update", path: file.path, originalContent, newContent: content },
				toolCallId,
				threadId,
			);

			return `Proposed update to "${file.path}" — the user will review the diff and approve or reject this change.`;
		},
		{
			name: "update_note",
			description:
				"Update the content of an existing markdown note. The change is staged for user approval with a diff view — it will NOT be applied until the user accepts it. Provide the COMPLETE new content for the file.",
			schema: z.object({
				path: z
					.string()
					.describe("File path or wiki link reference, e.g. 'Notes/todo.md' or '[[todo]]'"),
				content: z
					.string()
					.describe("The complete new content for the note (replaces the entire file)"),
			}),
		},
	);
}
