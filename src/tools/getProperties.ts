import { App } from "obsidian";
import { tool } from "papa-ts";
import { z } from "zod";

/**
 * Tool for retrieving properties (frontmatter) from Obsidian.
 * Can retrieve all unique property keys across the vault, or properties for a specific note.
 */
export function createGetPropertiesTool(app: App) {
  const getPropertiesFn = async ({ note_name }: { note_name?: string }) => {
    if (note_name) {
      // Search for the file
      const file = app.vault
        .getMarkdownFiles()
        .find((f) => f.path === note_name || f.basename === note_name);

      if (!file) {
        return `Note "${note_name}" not found.`;
      }

      const cache = app.metadataCache.getFileCache(file);

      if (!cache || !cache.frontmatter) {
        return `No properties found for note "${note_name}".`;
      }

      // Filter out the position property from the result
      const { position, ...properties } = cache.frontmatter;

      return JSON.stringify(properties, null, 2);
    } else {
      // Get all unique property keys
      const files = app.vault.getMarkdownFiles();
      const allKeys = new Set<string>();

      for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        if (cache && cache.frontmatter) {
          Object.keys(cache.frontmatter).forEach((key) => {
            // "position" is internal Obsidian metadata
            if (key !== "position") {
              allKeys.add(key);
            }
          });
        }
      }

      const sortedKeys = Array.from(allKeys).sort();

      if (sortedKeys.length === 0) {
        return "No properties found in the vault.";
      }

      return `Found ${sortedKeys.length} unique properties:\n${sortedKeys.join("\n")}`;
    }
  };

  return tool(getPropertiesFn, {
    name: "get_properties",
    description:
      "Retrieve properties (frontmatter) from Obsidian. If 'note_name' is provided, returns the properties (key-value pairs) of that specific note. If 'note_name' is omitted, returns a list of all unique property keys used across the entire vault.",
    schema: z.object({
      note_name: z
        .string()
        .optional()
        .describe(
          "The name or path of the note to retrieve properties for. If omitted, lists all available property keys in the vault.",
        ),
    }),
  });
}
