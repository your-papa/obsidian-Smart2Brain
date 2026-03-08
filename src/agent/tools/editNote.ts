import { type App } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { resolveVaultFileDetailed } from "../../utils/attachments";
import { genUUIDv7 } from "../../utils/uuid7Validator";
import { getCurrentThreadId } from "./runContext";

export function createEditNoteTool(app: App) {
    return tool(
        async ({ path, edits }: { path: string; edits: { oldText: string; newText: string }[] }, runManager) => {
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
                return `Error: Only markdown files (.md) can be edited. "${file.path}" is not a markdown file.`;
            }

            if (!store.isPathAllowed(file.path)) {
                return `Error: The file "${file.path}" is excluded by the vault's file filter settings.`;
            }

            const originalContent = await app.vault.read(file);
            let content = originalContent;

            for (let i = 0; i < edits.length; i++) {
                const { oldText, newText } = edits[i];
                const idx = content.indexOf(oldText);
                if (idx === -1) {
                    return `Error in edit ${i + 1}: Could not find the specified text in "${file.path}". Make sure oldText matches exactly (including whitespace and newlines).${i > 0 ? " Note: edits are applied sequentially — previous edits may have changed the file content, so this oldText must match the content AFTER earlier edits were applied." : ""}`;
                }
                // Ensure unique match
                if (content.includes(oldText, idx + 1)) {
                    return `Error in edit ${i + 1}: The specified oldText appears multiple times in "${file.path}". Include more surrounding context to make it unique.`;
                }
                content = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
            }

            const threadId = getCurrentThreadId();
            const toolCallId = runManager?.runId ?? genUUIDv7();

            store.addChange(
                { type: "update", path: file.path, originalContent, newContent: content },
                toolCallId,
                threadId,
            );

            return `Proposed ${edits.length} edit(s) to "${file.path}" — the user will review the diff and approve or reject this change.`;
        },
        {
            name: "edit_note",
            description:
                "Make targeted edits to an existing markdown note using search-and-replace. Each edit specifies the exact text to find (oldText) and its replacement (newText). You only provide the specific parts to change, not the entire file. The change is staged for user approval with a diff view.",
            schema: z.object({
                path: z
                    .string()
                    .describe("File path or wiki link reference, e.g. 'Notes/todo.md' or '[[todo]]'"),
                edits: z
                    .array(
                        z.object({
                            oldText: z
                                .string()
                                .describe(
                                    "The exact text to find in the file. Must match exactly once. Include enough surrounding context (a few lines) to ensure a unique match.",
                                ),
                            newText: z.string().describe("The text to replace oldText with"),
                        }),
                    )
                    .min(1)
                    .describe("Array of search-and-replace edits to apply sequentially"),
            }),
        },
    );
}
