---
name: notebook-navigator
description: Script the Notebook Navigator plugin via its public JavaScript API. Use when the user asks to work with Notebook Navigator and you have an exec_notebook_navigator tool — introspect the API first, then call it.
license: MIT
metadata:
  linkedPlugin: "notebook-navigator"
  displayName: "Notebook Navigator"
---

# Notebook Navigator API scripting

This skill covers scripting **Notebook Navigator**'s public JavaScript `api` object. You have an
`exec_notebook_navigator` tool that runs JavaScript against this plugin's `api` on the main thread.

There is no hand-written documentation for this plugin's API yet, so **discover it at runtime
before you rely on it**. Do not assume method names — introspect, then call. As you learn the API,
replace the generic steps below with the concrete methods and patterns that work.

## What's in scope

- `api` — the plugin's public API object (`app.plugins.plugins["<id>"].api`).
- `app` — the Obsidian `App` instance.
- `input` — optional JSON you pass to the tool.
- `return` the final value you want back (objects/arrays are stringified for you).

## Introspect first

Always start by inspecting the surface. Never call a method you haven't confirmed exists.

```javascript
// 1. What top-level members does the API expose?
return Object.keys(api);
```

```javascript
// 2. Inspect a specific member's type and, for functions, its arity/source signature.
const name = "someMember"; // ← the member you're curious about
const m = api[name];
return { type: typeof m, arity: typeof m === "function" ? m.length : undefined, preview: String(m).slice(0, 200) };
```

```javascript
// 3. For nested/namespaced APIs, walk one level deeper.
return Object.fromEntries(Object.keys(api).map((k) => [k, typeof api[k]]));
```

Once you know the shape, call the real methods. If a call throws, the error is returned to you as
a string — read it, adjust, and retry with a corrected call.

## Rules & constraints

- **Introspect before calling.** The API surface varies by plugin and version; guessing wastes turns.
- **Read-only by default.** Only perform mutations (create/update/delete) when the user explicitly
  asked to change data. When unsure whether a method mutates, inspect it or ask.
- **Not sandboxed.** This runs on the main thread with full `app` access — a call can do anything the
  plugin can. Keep snippets small and focused.
- **Awaited work times out.** Long-running or hanging promises are cut off; a runaway synchronous
  loop cannot be preempted, so avoid unbounded loops.
- **Prefer existing tools when they fit.** For reading/writing notes use `read_content` /
  `manage_notes`; reach for `exec_notebook_navigator` only for logic Notebook Navigator's API uniquely provides.
- **Report honestly.** If introspection shows the API can't do what the user asked, say so rather
  than fabricating a method.

## Typical flow

1. `return Object.keys(api)` to see what's available.
2. Inspect the one or two members that look relevant (type + arity).
3. Call them with the real arguments; return the result.
4. As you find reliable patterns, document them here so future runs skip the introspection.
