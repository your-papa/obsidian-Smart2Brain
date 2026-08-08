---
name: tasks
description: Query, create, and complete checkbox tasks managed by the Tasks plugin. Use when the user asks about their tasks, todos, due dates, scheduled/start dates, recurring tasks, or task queries written in Tasks query syntax.
license: MIT
compatibility: Requires the Tasks plugin (obsidian-tasks-plugin) to be installed and enabled in Obsidian
allowed-tools: search_notes read_content manage_notes
metadata:
  author: "S2B"
  version: "1.0"
  linkedPlugin: "obsidian-tasks-plugin"
---

# Tasks Skill

This skill works with checkbox tasks managed by the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin. Unlike TaskNotes (one file per task), Tasks are individual `- [ ]` checkbox lines *inside* regular notes, annotated with inline emoji fields.

**How this plugin's API works — read this first.** The Tasks plugin's public API (`apiV1`, exposed in scope as `api` when the `exec_obsidian_tasks_plugin` tool is enabled) is small and deliberately does NOT read, write, or query your vault. It has exactly three helpers that take/return Markdown strings:

- `api.createTaskLineModal(): Promise<string>` — opens the Tasks creation UI and resolves with the task's Markdown line (empty string if cancelled). Interactive; does not write anywhere.
- `api.editTaskLineModal(taskLine: string): Promise<string>` — opens the UI pre-filled with `taskLine`, resolves with the edited line (empty if cancelled). Does not write.
- `api.executeToggleTaskDoneCommand(line: string, path: string): string` — toggles done on a task line (handling the ✅ done date and recurrence roll-over correctly) and RETURNS the updated line(s). Synchronous; does not persist.

Because the API neither queries nor persists, the working flow is:
- **Query/display** → write a ` ```tasks ` query fence (rendered by the plugin). See below.
- **Create / edit / complete** → use the API helper to get a correctly-formatted line, then write it into a note yourself with `manage_notes`.

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

The Tasks API has **no query method** — querying is only available through the plugin's query language, rendered in ` ```tasks ` code blocks. To SHOW the user a task view, output a query block in your reply and the chat interface renders it:

```tasks
not done
due before tomorrow
sort by priority
limit 20
```

Common filters: `not done`, `done`, `due before <date>`, `due after <date>`, `scheduled before <date>`, `starts before <date>`, `path includes <folder>`, `tags include #project`, `priority is high`. Combine with newlines (implicit AND). Sort with `sort by due|priority|scheduled`. Cap with `limit N`.

To ANALYZE tasks (compute over them rather than display), find the relevant notes with `search_notes`, read them with `read_content`, and parse the `- [ ]` lines yourself.

---

## Creating a Task

Tasks are lines inside existing notes — decide (or ask) which note and where. Build the line, then insert it with `manage_notes` (`type: "update"`):

```
- [ ] Draft the proposal 📅 2025-01-20 🔼 #project/acme
```

If the `exec_obsidian_tasks_plugin` tool is enabled and the user wants to fill fields interactively, call `api.createTaskLineModal()` to get a correctly-formatted line, then write the returned string into the note with `manage_notes`. The modal returns the line — it does not save it.

**Rules:**
- Always `YYYY-MM-DD` for dates.
- Only include fields the user specified; omit the rest (do not leave empty placeholders — Tasks parses positionally by emoji, not by empty slots).
- Preserve the note's existing content; append under the right heading/list.

---

## Completing a Task

Read the exact task line first with `read_content`. If the `exec_obsidian_tasks_plugin` tool is enabled, prefer `api.executeToggleTaskDoneCommand(line, path)` — it sets the ✅ done date and rolls over recurring tasks correctly — then write the returned line(s) back with a `manage_notes` exact-match edit:

```json
{
  "type": "update",
  "path": "Notes/Work.md",
  "edits": [
    { "oldText": "- [ ] Draft the proposal 📅 2025-01-20", "newText": "<the string returned by executeToggleTaskDoneCommand>" }
  ]
}
```

Without the exec tool, toggle manually: change `- [ ]` → `- [x]` and append `✅ <today>` via the same `manage_notes` edit.

---

## Recurring Tasks

Recurrence uses natural-language syntax after `🔁`: `every day`, `every week`, `every month on the 1st`, `every weekday`, `every 2 weeks`. When a recurring task is completed, the next occurrence is generated automatically — do NOT hand-roll the next line. Toggle via `executeToggleTaskDoneCommand` (which returns both the completed line and the new occurrence), or instruct the user to check it off in the UI.

---

## Tips & Constraints

- Read the exact task line before editing — `manage_notes` does literal text replacement, so `oldText` must match including emojis and spacing.
- The API helpers return strings and never touch disk; persistence is always your `manage_notes` write.
- `createTaskLineModal` / `editTaskLineModal` open interactive UI — only use them when the user is present to fill the dialog; for headless creation, build the line from the emoji table above.
- Tasks vs TaskNotes: if the user's tasks are checkbox lines inside notes, this is the right skill; if each task is its own file with YAML frontmatter, use the **tasknotes** skill instead. When unsure, search for `- [ ]` lines vs. files with a `status` frontmatter field.
- Do not invent inline fields the user didn't ask for.
