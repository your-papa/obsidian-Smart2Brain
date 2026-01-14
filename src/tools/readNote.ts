import { type App, TFile } from "obsidian";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Tool for reading the content of a specific note
 */
export function createReadNoteTool(app: App) {
  const readNoteFn = async ({ path }: { path: string }): Promise<string> => {
    const file = app.vault.getAbstractFileByPath(path);

    if (!file) {
      return `Error: File not found at path "${path}"`;
    }

    if (!(file instanceof TFile)) {
      return `Error: Path "${path}" is not a file`;
    }

    try {
      const content = await app.vault.read(file);
      return `Content of "${path}":\n\n${content}`;
    } catch (error) {
      return `Error reading file "${path}": ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  return tool(readNoteFn, {
    name: "read_note",
    description:
      "Read the full content of a specific note by its file path. Use this after finding a relevant note with search_notes.",
    schema: z.object({
      path: z
        .string()
        .describe(
          "The full file path of the note to read (e.g., 'folder/note.md')",
        ),
    }),
  });
}
