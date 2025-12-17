import { App } from "obsidian";
import { tool } from "papa-ts";
import { z } from "zod";

// Interface for Dataview API
interface DataviewAPI {
  tryQueryMarkdown(source: string, originFile?: string): Promise<string>;
}

/**
 * Tool for executing Obsidian Dataview queries
 */
export function createExecuteDataviewTool(app: App) {
  const executeDataviewFn = async ({
    query,
  }: {
    query: string;
  }): Promise<string> => {
    // @ts-ignore - Dynamic access to plugins
    const dataviewApi = app.plugins.plugins["dataview"]?.api as
      | DataviewAPI
      | undefined;

    if (!dataviewApi) {
      return "Error: Obsidian Dataview plugin is not enabled or installed. Please install/enable it to use this tool.";
    }

    try {
      // Attempt to run the query and get markdown output
      const markdown = await dataviewApi.tryQueryMarkdown(query);

      if (!markdown || markdown.trim() === "") {
        return "Query executed successfully but returned no results.";
      }

      return markdown;
    } catch (error) {
      return `Error executing Dataview query: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  return tool(executeDataviewFn, {
    name: "execute_dataview_query",
    description:
      "Execute an Obsidian Dataview query (DQL) and return the results in Markdown format. Use this to query notes, metadata, tags, and more using the Dataview Query Language. Example: 'LIST FROM \"Daily Notes\"'",
    schema: z.object({
      query: z
        .string()
        .describe("The Dataview Query Language (DQL) query string"),
    }),
  });
}
