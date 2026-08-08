---
name: tasknotes
description: Create, read, update, and query tasks managed by the TaskNotes plugin. Use when the user asks about their tasks, todos, due dates, priorities, projects, scheduling, time tracking, or recurring tasks.
license: MIT
compatibility: Requires TaskNotes plugin to be installed and enabled in Obsidian
metadata:
  author: "S2B"
  version: "1.0"
  linkedPlugin: "tasknotes"
---

# TaskNotes Skill

This skill works with tasks managed by the [TaskNotes](https://github.com/callumalpass/tasknotes) plugin. Each task is a Markdown file with YAML frontmatter stored in a configurable folder (default: `TaskNotes/Tasks/`).

**Operate on tasks through the plugin's API, not by editing files.** When this skill is enabled and the integration is approved you have an `exec_tasknotes` tool that runs JavaScript against the TaskNotes `api` object (in scope as `api`) on the main thread. The API is the correct interface: it manages ids, dates, recurrence, and completion for you, and validates input. Prefer it over hand-editing frontmatter for every read, query, create, update, and complete.

- `api` is the TaskNotes plugin API (`apiVersion === 1`); `app` is the Obsidian app.
- Tasks are addressed by their file `path`.
- Init happens at layout-ready. If a call fails early, guard with `if (!api.lifecycle.isReady()) await api.lifecycle.ready()` first.
- Not sandboxed; awaited work times out. Keep snippets read-only unless the user asked to modify data.
- If unsure of the surface at runtime, introspect: `return Object.keys(api)` or `return api.capabilities`.

## Reading & Querying

```javascript
// One task by path
return await api.getTask("TaskNotes/Tasks/Buy groceries.md");

// Flat list (optionally filtered) — returns TaskInfo[]
return await api.listTasks();
```

For structured queries with predicates, sorting, grouping, and pagination use `api.query.tasks(query)`:

```javascript
// Open tasks due within a week, soonest first
return await api.query.tasks({
  where: { all: [
    { field: "status", op: "ne", value: "done" },
    { field: "due", op: "exists" },
  ]},
  sort: [{ field: "due", direction: "asc" }],
  limit: 20,
});
```

Predicate nodes are `{ all: [...] }` / `{ any: [...] }` / `{ not: ... }` or a leaf `{ field, op, value }`. Operators: `eq, ne, contains, notContains, in, notIn, exists, missing, lt, lte, gt, gte, isTrue, isFalse`. `api.query.validate(query)` checks a query before running it; `api.stats.tasks(query)` returns aggregate counts. Use `api.catalog.statuses()` / `api.catalog.priorities()` to discover the user's actual configured values before filtering on them.

To *display* a live, auto-updating view to the user instead of computing, write a ` ```dataview ` fence in your reply (renders natively when Dataview is installed):

```dataview
TABLE title, status, due, priority
FROM "TaskNotes/Tasks"
WHERE status != "done"
SORT due ASC
LIMIT 20
```

## Creating a Task

```javascript
return await api.tasks.create({
  title: "Buy groceries",   // required
  status: "open",
  priority: "normal",
  scheduled: "2025-01-15",  // YYYY-MM-DD (or ...THH:MM:SS)
  contexts: ["@errands"],
  projects: ["[[Website Redesign]]"],
  tags: ["shopping"],
  timeEstimate: 30,          // minutes
  details: "Optional body markdown",
});
```

Only pass fields the user specified. The plugin sets `id`, `date_created`, `date_modified`, and the file path/name — do not supply them. You can also parse natural language first: `api.parseNaturalLanguage("buy milk tomorrow high priority")` returns structured task data you can hand to `create`.

## Updating & Rescheduling

```javascript
// General patch
return await api.tasks.update(path, { priority: "high", due: "2025-01-20" });

// Field helpers (clearer intent, same effect)
await api.tasks.setPriority(path, "high");
await api.tasks.setDue(path, "2025-01-20");      // api.tasks.clearDue(path) to remove
await api.tasks.setScheduled(path, "2025-01-17"); // reschedule the planned start
await api.tasks.reschedule(path, "2025-01-17");
await api.tasks.addProject(path, "[[Q1 Launch]]");
await api.tasks.addTag(path, "urgent");
```

## Completing a Task

```javascript
return await api.completeTask(path);        // or api.tasks.complete(path)
// api.tasks.uncomplete(path) to reopen; api.tasks.setStatus(path, "in-progress") for other states.
```

The plugin sets the completed date and handles recurrence roll-over automatically — never set a completed date yourself.

## Recurring Tasks

Recurrence is RFC 5545 RRULE in the task's `recurrence` field; `scheduled` holds the next concrete occurrence (the plugin advances it — don't). Set it at creation/update via the `recurrence` field:

| Pattern | RRULE |
|---------|-------|
| Daily | `FREQ=DAILY` |
| Every weekday | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| Every Monday | `FREQ=WEEKLY;BYDAY=MO` |
| Every Mon/Wed/Fri | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| Bi-weekly | `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO` |
| Monthly on the 1st | `FREQ=MONTHLY;BYMONTHDAY=1` |

To toggle a single occurrence complete/skipped, use `api.recurring.toggleCompleteInstance(path, date)` / `api.recurring.toggleSkippedInstance(path, date)` rather than editing `complete_instances` by hand.

## Time Tracking

- `api.time.start(path)` / `api.time.stop(path)` — start/stop a work session.
- `api.time.active()` — currently running entries; `api.time.summary(path)` — tracked-time summary.
- `timeEstimate` is minutes (integer). Read a task's `timeEntries` (`{startTime, endTime, description}`, ISO 8601 UTC) to report tracked time.

## Dependencies

Use `api.relationships` to read task relationships (`parents`, `subtasks`, `dependencies`, `blocking`, `all`, each taking a `path`) and `api.tasks.addDependency(path, ...)` / `removeDependency(path, ...)` to change them. Relationship types: `FINISHTOSTART` (most common), `FINISHTOFINISH`, `STARTTOSTART`, `STARTTOFINISH`.

---

## Reference: Task Frontmatter

The `api` reads/writes these; this is for understanding a task file's shape, not for hand-editing.

| Field | Meaning |
|-------|---------|
| `title` | Task title (required) |
| `status` | See Statuses below |
| `priority` | See Priorities below |
| `due` | Hard deadline — "due by", "deadline" (`YYYY-MM-DD`[`THH:MM:SS`]) |
| `scheduled` | Planned start — "work on it on", "plan for"; holds the next occurrence for recurring tasks |
| `contexts` | List of `@context` strings |
| `projects` | List of `[[wikilinks]]` or plain strings |
| `tags` | Native Obsidian tags |
| `timeEstimate` | Minutes (integer) |
| `recurrence` / `recurrence_anchor` | RRULE; anchor is `"scheduled"` or `"completion"` |
| `reminders` | `{type: "relative"|"absolute", value}` (e.g. `"-1d"` = 1 day before) |
| `archived` | Boolean |
| `id`, `date_created`, `date_modified`, `completed_date` | Plugin-managed — never set these |

`due` and `scheduled` are independent: a task can have either, both, or neither.

### Statuses (defaults — user may customize; read `api.catalog.statuses()` to confirm)

| Status | Meaning | Completed? |
|--------|---------|-----------|
| `open` | Not yet started | No |
| `in-progress` | Actively being worked on | No |
| `done` | Completed | Yes |

### Priorities (defaults — read `api.catalog.priorities()` to confirm)

`none`, `low`, `normal`, `high`.

---

## Tips & Constraints

- Prefer the `api` for all reads and mutations — it validates input and manages plugin-owned fields. Only fall back to `search_notes`/`read_content`/`manage_notes` if the `exec_tasknotes` tool is not available (integration off), and say so.
- Read the user's configured statuses/priorities via `api.catalog.*` before filtering on values that may have been customized.
- Task folder path is configurable; the `api` resolves paths for you, so you rarely need to know it.
- Tasks vs TaskNotes: if each task is its own file with YAML frontmatter, this is the right skill; if the user's tasks are `- [ ]` checkbox lines inside notes, use the **tasks** skill instead.

## Working with the Bases Skill

If the **bases** skill is enabled, you can create `.base` views over the task folder for a rich UI. Example — open tasks by priority:

```yaml
filters:
  and:
    - file.inFolder("TaskNotes/Tasks")
    - 'status != "done"'

formulas:
  days_until_due: 'if(due, (date(due) - today()).days, "")'

views:
  - type: table
    name: "Open Tasks"
    order:
      - file.name
      - status
      - priority
      - due
      - formula.days_until_due
    groupBy:
      property: priority
      direction: DESC
```
