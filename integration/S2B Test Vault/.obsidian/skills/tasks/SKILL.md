---
name: tasks
description: Query, create, and complete checkbox tasks managed by the Tasks plugin. Use when the user asks about their tasks, todos, due dates, scheduled/start dates, recurring tasks, or task queries written in Tasks query syntax.
license: MIT
compatibility: Requires the Tasks plugin (obsidian-tasks-plugin) to be installed and enabled in Obsidian
metadata:
  author: "Smart2Brain"
  version: "1.0"
  linkedPlugin: "obsidian-tasks-plugin"
---

# Tasks Skill

This skill enables you to work with checkbox tasks managed by the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin. Unlike TaskNotes (one file per task), Tasks are individual `- [ ]` checkbox lines *inside* regular notes, annotated with inline emoji fields.

Use the `search_notes`, `read_content`, and `manage_notes` tools to read and write task lines.

## Scripting the Tasks API (advanced)

Because this skill is enabled and the Tasks plugin exposes a public API, you likely also have
an `exec_obsidian_tasks_plugin` tool (check your available tools) that runs JavaScript against
the Tasks plugin's `api` object on the main thread. The Tasks API is small and focused on
constructing task lines and toggling status.

- `api` is the Tasks plugin API; `app` is the Obsidian app.
- Discover what's available before assuming methods exist — `return Object.keys(api)` — since the surface varies by plugin version. Commonly present: `executeToggleTaskDoneCommand(line, path)` and helpers to build a task line from fields.
- Prefer the API for toggling completion and for generating a correctly-formatted task line; use `manage_notes` to actually insert/replace the line in a note.
- Keep snippets read-only unless the user asked to modify data. Awaited work times out; this is not sandboxed.

```javascript
// Inspect the available API before calling it
return Object.keys(api);
```

---

## Task Line Format

A task is a Markdown checkbox with optional inline fields (emoji-tagged):

```markdown
- [ ] Write the report 📅 2025-01-20 ⏳ 2025-01-15 🛫 2025-01-14 🔺 #project/work
- [x] Buy groceries ✅ 2025-01-12
```

### Status markers

| Marker | Meaning |
|--------|---------|
| `- [ ]` | Todo (incomplete) |
| `- [x]` | Done |
| `- [/]` | In progress (if configured) |
| `- [-]` | Cancelled (if configured) |

### Inline field emojis

| Emoji | Field | Format |
|-------|-------|--------|
| 📅 | Due date | `YYYY-MM-DD` |
| ⏳ | Scheduled date | `YYYY-MM-DD` |
| 🛫 | Start date | `YYYY-MM-DD` |
| ✅ | Done date | `YYYY-MM-DD` (set on completion) |
| ➕ | Created date | `YYYY-MM-DD` |
| 🔁 | Recurrence | e.g. `every week`, `every day`, `every month on the 1st` |
| 🔺🔼🔽 | Priority | highest / medium / low (⏫ high, 🔽 low) |
| 🆔 / ⛔ | Id / Depends-on | task dependencies |

Priorities: `🔺` highest, `⏫` high, `🔼` medium, `🔽` low, none = normal.

---

## Querying Tasks

Tasks queries live in ` ```tasks ` code blocks and are rendered by the plugin. To SHOW the user a task view, output a query block — the chat interface renders it:

```tasks
not done
due before tomorrow
sort by priority
limit 20
```

Common query filters: `not done`, `done`, `due before <date>`, `due after <date>`, `scheduled before <date>`, `starts before <date>`, `path includes <folder>`, `tags include #project`, `priority is high`. Combine with newlines (implicit AND). Sort with `sort by due|priority|scheduled`. Cap with `limit N`.

To ANALYZE tasks (not just display), read the relevant notes with `search_notes` + `read_content` and parse the checkbox lines, or use the `exec_obsidian_tasks_plugin` API if enabled.

---

## Creating a Task

Tasks are lines inside existing notes — decide (or ask) which note and where. Use `manage_notes` with `type: "update"` to append or insert the checkbox line. Build the line with the inline fields above:

```
- [ ] Draft the proposal 📅 2025-01-20 🔼 #project/acme
```

**Rules:**
- Always `YYYY-MM-DD` for dates.
- Only include fields the user specified; omit the rest (do not leave empty placeholders — Tasks parses positionally by emoji, not by empty slots).
- Preserve the note's existing content; append under the right heading/list.

---

## Completing a Task

To mark a task done, change its marker `- [ ]` → `- [x]` and (optionally) append `✅ <today>`. Read the exact line first with `read_content`, then `manage_notes` update with an exact-match edit:

```json
{
  "type": "update",
  "path": "Notes/Work.md",
  "edits": [
    { "oldText": "- [ ] Draft the proposal 📅 2025-01-20", "newText": "- [x] Draft the proposal 📅 2025-01-20 ✅ 2025-01-15" }
  ]
}
```

If the `exec_obsidian_tasks_plugin` integration is enabled, prefer `api.executeToggleTaskDoneCommand(line, path)` — it handles the done date and recurrence roll-over correctly.

---

## Recurring Tasks

Recurrence uses natural-language syntax after `🔁`: `every day`, `every week`, `every month on the 1st`, `every weekday`, `every 2 weeks`. When a recurring task is completed via the plugin, the next occurrence is generated automatically — do NOT hand-roll the next line; toggle via the API or instruct the user to check it off in the UI.

---

## Tips & Constraints

- Read the exact task line before editing — `manage_notes` does literal text replacement, so `oldText` must match including emojis and spacing.
- Tasks vs TaskNotes: if the user's tasks are checkbox lines inside notes, this is the right skill; if each task is its own file with YAML frontmatter, use the **tasknotes** skill instead. When unsure, search for `- [ ]` lines vs. files with a `status` frontmatter field.
- Do not invent inline fields the user didn't ask for.
