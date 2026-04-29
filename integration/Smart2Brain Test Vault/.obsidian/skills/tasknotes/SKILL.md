---
name: tasknotes
description: Create, read, update, and query tasks managed by the TaskNotes plugin. Use when the user asks about their tasks, todos, due dates, priorities, projects, scheduling, time tracking, or recurring tasks.
license: MIT
compatibility: Requires TaskNotes plugin to be installed and enabled in Obsidian
metadata:
  author: "Smart2Brain"
  version: "1.0"
  linkedPlugin: "tasknotes"
---

# TaskNotes Skill

This skill enables you to work with tasks managed by the [TaskNotes](https://github.com/callumalpass/tasknotes) plugin. Each task is a Markdown file with YAML frontmatter stored in a configurable folder (default: `TaskNotes/Tasks/`).

Use the `search_notes`, `read_content`, `get_properties`, and `manage_notes` tools to read and write tasks.

---

## Task File Format

Every task is a `.md` file. The full set of supported frontmatter fields is:

```yaml
---
title: "Task title"               # string, required
status: "open"                    # see Statuses below
priority: "normal"                # see Priorities below
due: "2025-01-20"                 # YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
scheduled: "2025-01-15"          # planned start date (when to work on it)
completed_date: "2025-01-20"     # set automatically when status → completed
contexts:                         # list of @context strings
  - "@work"
  - "@computer"
projects:                         # list of [[wikilinks]] or plain strings
  - "[[Website Redesign]]"
tags:                             # native Obsidian tags
  - "important"
time_estimate: 60                 # minutes (integer)
timeEntries:                      # work session log
  - startTime: "2025-01-15T10:00:00Z"
    endTime: "2025-01-15T10:45:00Z"
    description: "Initial work"
recurrence: "FREQ=WEEKLY;BYDAY=MO"  # RFC 5545 RRULE
recurrence_anchor: "scheduled"      # "scheduled" or "completion"
complete_instances:               # list of completed occurrence dates (recurring tasks)
  - "2025-01-13"
skipped_instances: []             # list of skipped occurrence dates
blocked_by:                       # prerequisite tasks
  - uid: "other-task-id"
    reltype: "FINISHTOSTART"      # FINISHTOSTART | FINISHTOFINISH | STARTTOSTART | STARTTOFINISH
    gap: "1d"                     # optional delay after predecessor
reminders:
  - type: "relative"              # "relative" or "absolute"
    value: "-1d"                  # "-1d" means 1 day before due/scheduled
archived: false                   # boolean
id: "task-uuid"                   # stable identifier (set by plugin)
date_created: "2025-01-10T09:00:00Z"
date_modified: "2025-01-15T14:30:00Z"
---

Optional markdown body with notes, checklists, context, etc.
```

---

## Statuses

Default values (the user may have customized these):

| Status | Meaning | Is completed? |
|--------|---------|---------------|
| `open` | Not yet started | No |
| `in-progress` | Actively being worked on | No |
| `done` | Completed | Yes |

> When a task reaches a "completed" status, `completed_date` is set automatically and the plugin may archive it after a configured delay.

---

## Priorities

Default values (the user may have customized these):

| Priority | Meaning |
|----------|---------|
| `none` | No priority |
| `low` | Low urgency |
| `normal` | Default |
| `high` | Urgent |

---

## Key Distinctions

- **`due`** — the hard deadline. Use this when the user says "due by", "deadline", "must finish by".
- **`scheduled`** — the planned start date. Use this when the user says "start on", "work on it on", "plan for". For recurring tasks, this holds the next concrete occurrence.
- Both fields are independent: a task can have a scheduled date without a due date and vice versa.

---

## Querying Tasks

### Find tasks by status
Use `search_notes` with a property filter, or `get_properties` to inspect a file's frontmatter.

For structured queries across many tasks, use `execute_dataview_query` (if the Dataview skill is also enabled):

```dataview
TABLE title, status, due, priority
FROM "TaskNotes/Tasks"
WHERE status != "done"
SORT due ASC
LIMIT 20
```

### Find overdue tasks

```dataview
TABLE title, due, priority
FROM "TaskNotes/Tasks"
WHERE due AND date(due) < date(today) AND status != "done"
SORT priority DESC, due ASC
LIMIT 20
```

### Find tasks due today or this week

```dataview
TABLE title, due, status
FROM "TaskNotes/Tasks"
WHERE due AND date(due) >= date(today) AND date(due) <= date(today) + dur(7 days)
SORT due ASC
LIMIT 20
```

### Find tasks by project

```dataview
TABLE title, status, due
FROM "TaskNotes/Tasks"
WHERE contains(projects, "[[Website Redesign]]")
SORT due ASC
LIMIT 20
```

### Find tasks by context

```dataview
TABLE title, status, due
FROM "TaskNotes/Tasks"
WHERE contains(contexts, "@work")
SORT priority DESC
LIMIT 20
```

### Find high-priority open tasks

```dataview
TABLE title, due, scheduled
FROM "TaskNotes/Tasks"
WHERE priority = "high" AND status = "open"
SORT due ASC
LIMIT 20
```

---

## Creating a Task

Use `manage_notes` with `type: "create"`. Always include at minimum `title` and `status`. Follow this template:

```yaml
---
title: "Buy groceries"
status: "open"
priority: "normal"
scheduled: "2025-01-15"
due: ""
contexts:
  - "@errands"
projects: []
tags: []
time_estimate: 30
---
```

**Rules:**
- Store in the task folder (ask the user if unsure; default is `TaskNotes/Tasks/`).
- Use the task title as the filename, sanitised for the filesystem (e.g., `Buy groceries.md`).
- Always use `YYYY-MM-DD` date format.
- Leave unknown fields empty (`""`) rather than omitting them — the plugin expects them.
- Do NOT set `date_created`, `date_modified`, or `id` — these are managed by the plugin.

---

## Completing a Task

Update the `status` field to the completed value (usually `"done"`) via `manage_notes` with `type: "update"`.

```json
{
  "type": "update",
  "path": "TaskNotes/Tasks/Buy groceries.md",
  "edits": [
    { "oldText": "status: \"open\"", "newText": "status: \"done\"" }
  ]
}
```

> Do NOT set `completed_date` manually — the plugin manages it automatically.

---

## Rescheduling a Task

Update `scheduled` and/or `due` with the new date:

```json
{
  "type": "update",
  "path": "TaskNotes/Tasks/Some task.md",
  "edits": [
    { "oldText": "scheduled: \"2025-01-10\"", "newText": "scheduled: \"2025-01-17\"" }
  ]
}
```

---

## Recurring Tasks

Recurring tasks use RFC 5545 RRULE syntax in the `recurrence` field. The `scheduled` field holds the *next* occurrence — do not manually advance it; the plugin handles this on completion.

### Common patterns

| Pattern | RRULE |
|---------|-------|
| Daily | `FREQ=DAILY` |
| Every weekday | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| Every Monday | `FREQ=WEEKLY;BYDAY=MO` |
| Every Mon/Wed/Fri | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| Weekly on a specific day | `FREQ=WEEKLY;BYDAY=FR` |
| Bi-weekly | `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO` |
| Monthly on the 1st | `FREQ=MONTHLY;BYMONTHDAY=1` |

`recurrence_anchor` controls whether the next recurrence is calculated from the `scheduled` date (`"scheduled"`) or from the actual completion date (`"completion"`).

To mark a single occurrence as done without creating a new `manage_notes` update, you'd normally use the plugin's UI. If the user asks to mark one occurrence done via the agent, append the date to `complete_instances`:

```json
{ "oldText": "complete_instances: []", "newText": "complete_instances:\n  - \"2025-01-13\"" }
```

---

## Time Estimates & Tracking

- `time_estimate` is an integer in **minutes**.
- `timeEntries` is a list of `{startTime, endTime, description}` objects with ISO 8601 UTC timestamps.
- Use the plugin's UI to start/stop the timer. The agent can read `timeEntries` to summarise tracked time.

### Summarise tracked time for a task

Total minutes tracked = sum of `(endTime - startTime)` across all entries. When answering questions about time tracked, compute this from the `timeEntries` array.

---

## Task Dependencies

The `blocked_by` field lists prerequisite tasks:

```yaml
blocked_by:
  - uid: "abc123"           # the `id` of the blocking task
    reltype: "FINISHTOSTART" # relationship type
    gap: "1d"               # optional gap after predecessor finishes
```

Relationship types:
- `FINISHTOSTART` — this task can start after the predecessor finishes (most common)
- `FINISHTOFINISH` — this task must finish at/after the predecessor finishes
- `STARTTOSTART` — this task can start after the predecessor starts
- `STARTTOFINISH` — this task must finish after the predecessor starts

---

## Working with the Bases Skill

If the **bases** skill is enabled, you can create `.base` views over the task folder for rich UI. Example — open tasks by priority:

```yaml
filters:
  and:
    - file.inFolder("TaskNotes/Tasks")
    - 'status != "done"'

formulas:
  days_until_due: 'if(due, (date(due) - today()).days, "")'
  is_overdue: 'if(due, date(due) < today(), false)'

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

---

## Tips & Constraints

- Always read a task file before updating it — use `read_content` or `get_properties` to get the current frontmatter before constructing edits.
- Use exact string matches in `edits` — Obsidian's `manage_notes` tool does text replacement, so the `oldText` must exactly match what's in the file, including indentation and quotes.
- Do not edit `id`, `date_created`, `date_modified`, `completed_date` — these are plugin-managed fields.
- Task folder path is configurable by the user. If unsure, search for files with `status` in their frontmatter to locate the tasks folder.
- If the user's statuses or priorities differ from the defaults above, read an existing task first to discover the actual values in use.
