---
name: core
description: Script Smart Second Brain's own capabilities (search, read, write, tags, properties, directory listing) via its public JavaScript API. Use when you have an exec_smart_second_brain tool and want to combine or extend the built-in operations in one call.
license: MIT
compatibility: Bundled with Smart Second Brain
metadata:
  author: "Smart2Brain"
  version: "1.0"
  linkedPlugin: "smart-second-brain"
---

# Core API scripting

Smart Second Brain exposes its own capabilities as a public JavaScript `api` object — the same
operations available as dedicated tools (`search_notes`, `read_content`, `manage_notes`, …), reachable
programmatically. When this integration is enabled you have an `exec_smart_second_brain` tool that runs
JavaScript against that `api` on the main thread.

Reach for this when you want to **combine** operations in one pass — e.g. search, then read the top
hit, then compute over its contents — or apply logic the individual tools don't express. For a single
plain operation, the dedicated tool is usually simpler.

## What's in scope

- `api` — Smart Second Brain's public API (`app.plugins.plugins["smart-second-brain"].api`).
- `app` — the Obsidian `App` instance.
- `input` — optional JSON you pass to the tool.
- `return` the final value you want back (objects/arrays are stringified for you).

## API surface

- `await api.searchNotes({ query, algorithm?, filter?, maxResults? })` — search the vault. `algorithm`
  is `"lexical"` (default) or `"hybrid"` (needs an embedding model). Returns an array of ranked result
  objects (path, name, score, …).
- `await api.readContent(path)` — read a note/PDF/text/Excalidraw file as a string. Supports fragments
  like `"Note#Section"` and `"doc.pdf#page=1-3"`.
- `await api.manageNotes(operations)` — validate and **stage** a batch of write operations for the user
  to review. Each operation is one of:
  `{ type: "create", path, content }`, `{ type: "update", path, edits: [{ oldText, newText }] }`,
  `{ type: "delete", path }`, `{ type: "move", path, newPath }`. Returns a summary string. **Nothing is
  written until the user approves** — never tell the user a change has already been applied.
- `await api.getAllTags()` — all tags in the vault.
- `await api.getProperties(noteName?)` — a note's frontmatter, or (no argument) every property key in
  the vault.
- `await api.listDirectory({ path?, recursive?, maxDepth? })` — the vault's directory tree.
- `await api.loadSkill(name)` — a skill's full instructions by name, or `null` if unknown.

When unsure of the exact shape, introspect before relying on it — the surface can change across versions:

```javascript
// What does the API expose?
return Object.keys(api);
```

```javascript
// Search, then read the top hit, and return a short excerpt.
const hits = await api.searchNotes({ query: input.query, maxResults: 1 });
if (!hits.length) return "No matching notes.";
const body = await api.readContent(hits[0].path);
return { path: hits[0].path, excerpt: body.slice(0, 500) };
```

## Rules & constraints

- **Writes go through `api.manageNotes`.** It stages changes for user review — that is the correct,
  reviewable write path. Prefer it over raw `app.vault` writes so the user stays in control.
- **Read-only by default.** Only stage mutations when the user explicitly asked to change data.
- **Not sandboxed.** This runs on the main thread with full `app` access — a call can do anything the
  plugin can. Keep snippets small and focused.
- **Awaited work times out.** Long-running or hanging promises are cut off; a runaway synchronous loop
  cannot be preempted, so avoid unbounded loops.
- **Prefer the dedicated tool for a single plain operation.** Reach for `exec_smart_second_brain` when
  you need to combine steps or apply logic the individual tools don't offer.
- **Report honestly.** If the API can't do what the user asked, say so rather than fabricating a method.
