---
name: dataview
description: Query and analyze notes using Dataview DQL language. Use when user needs tables, lists, or data analysis from vault metadata and frontmatter properties. Requires Dataview plugin.
license: MIT
compatibility: Requires Dataview plugin to be installed and enabled in Obsidian
metadata:
  author: "Smart2Brain"
  version: "1.0"
  linkedPlugin: "dataview"
  displayName: "dataview"
---

# Dataview Integration

You have access to the `execute_dataview_query` tool for running Dataview DQL queries.

## Default Result Size

Always include `LIMIT 10` in Dataview DQL (queries you show or run) unless the user asks for more or specifies a different limit.
If you need pagination or offsets, use a `dataviewjs` code block and slice the pages array (e.g., `.slice(offset, offset + limit)`).

## Dataview DQL Cheat Sheet

- Query types: `LIST` or `TABLE field1, field2`
- FROM sources: `#tag`, `"Folder"`, `"path/to/file"`
- Exclusions: `AND !#tag`, `AND !"Folder"`
- Note: Tag/folder exclusions belong in `FROM`, not `WHERE`. For `WHERE`, use expressions like `!contains(file.tags, "#Template")`.
- Combine: `A AND B`, `A OR B`
- WHERE: `WHERE prop` (exists), `WHERE prop = "value"`, `WHERE numProp > 3`
- SORT: `SORT field asc|desc`
- GROUP BY: `GROUP BY prop` then use `rows` (e.g., `rows.file.name`)
- FLATTEN: `FLATTEN multiProp`
- LIMIT: `LIMIT 10` (default) or user-specified
- Display helper: `choice(boolProp, "Yes", "No") as "Label"`

## Minimal Example

```dataview
TABLE Title, Author
FROM #library AND !"Templates"
WHERE Rating > 3
SORT file.mtime desc
LIMIT 10
```

## Data Analysis

If you need to SEE the results to answer a question or perform analysis, use the `execute_dataview_query` tool (supports DQL only).

## Scripting the Dataview API (advanced)

Because this skill is enabled and the Dataview plugin exposes a public API, you likely also
have an `exec_dataview` tool (check your available tools) that runs JavaScript against
Dataview's `api` object (the same API `dataviewjs` blocks use) on the main thread. Use it for
anything DQL can't express — aggregation, custom filtering, computing statistics across pages.

- `api` is the Dataview API; `app` is the Obsidian app.
- Prefer `execute_dataview_query` (DQL) for simple tables/lists; reach for `exec_dataview` only when you need programmatic logic.
- Keep snippets read-only unless the user asked to modify data. Awaited work times out; this is not sandboxed.

```javascript
// Count pages per tag under a folder
const pages = api.pages('"Projects"');
const byStatus = {};
for (const p of pages) byStatus[p.status ?? "none"] = (byStatus[p.status ?? "none"] ?? 0) + 1;
return byStatus;
```

## Displaying Lists/Tables

If you want to SHOW the user a list or table (e.g. 'List all my books'), simply output the Dataview DQL query in a markdown code block. The chat interface will render the result automatically.

- Do NOT repeat the rendered results in plain text.
- Do NOT tell the user to run the query in a note; it has already been run and rendered here.
- When generating a view, introduce it as "Here is the list:" or "I have generated the view below:".