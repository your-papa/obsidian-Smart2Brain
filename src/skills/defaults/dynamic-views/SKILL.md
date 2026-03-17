---
name: dynamic-views
description: Create persistent interactive views (calendars, dashboards, timelines, kanban boards, etc.) that render in sandboxed iframes and can be pinned alongside notes. Use when the user asks for any custom visualization or interactive panel that should persist across sessions.
license: MIT
metadata:
  author: "Smart2Brain"
  version: "1.0"
  category: "core"
---

# Dynamic Views

You can create **persistent interactive views** using the `manage_views` tool. Views are rendered in sandboxed iframes and saved as `.s2b-view` files in the vault. Users can pin them to their sidebar, move them to any pane, and they survive plugin restarts.

## How It Works

Call `manage_views` with a `create` operation providing `title`, `icon`, `html`, `css`, and `js`. The view opens in a new tab immediately.

Views have access to the **s2b bridge API** — async JavaScript functions that let the view read and write vault data at runtime.

## Bridge API Reference

All bridge methods are async and available on `window.s2b`:

### Read Operations

```javascript
// Search notes by name/path keyword
const results = await s2b.searchNotes("recipe", 10);
// returns: [{ path: "Cooking/pasta.md", name: "pasta" }, ...]

// Read full content of a note
const content = await s2b.readContent("Cooking/pasta.md");
// returns: "# Pasta\n\nIngredients: ..."

// Get frontmatter properties of a note (or list all property keys)
const props = await s2b.getProperties("Cooking/pasta.md");
// returns: { tags: ["cooking"], rating: 5, date: "2024-01-15" }
const allKeys = await s2b.getProperties();
// returns: ["tags", "rating", "date", "status", ...]

// Get all tags in the vault
const tags = await s2b.getAllTags();
// returns: ["#cooking", "#recipe", "#project", ...]

// List all markdown files (optionally filtered by path prefix)
const files = await s2b.listFiles("Projects/");
// returns: [{ path: "Projects/todo.md", name: "todo", size: 1234 }, ...]
```

### Write Operations

```javascript
// Create a new note
await s2b.createNote("Notes/new-note.md", "# New Note\n\nContent here");

// Update an existing note (replaces full content)
await s2b.updateNote("Notes/existing.md", "# Updated\n\nNew content");

// Delete a note (moves to trash)
await s2b.deleteNote("Notes/old-note.md");
```

## Theme Integration

Obsidian theme colours are injected as CSS variables on `:root`. Use them for a native look:

- `--background-primary` — main background
- `--background-secondary` — sidebar/card background
- `--text-normal` — primary text
- `--text-muted` — secondary text
- `--interactive-accent` — accent colour (links, buttons)
- `--color-red`, `--color-green`, `--color-blue`, `--color-yellow`, `--color-cyan`, `--color-purple`, `--color-orange`, `--color-pink`

## Rules

1. Code must be **self-contained**. No external CDN links, `fetch()`, or `import()` — they are blocked by the sandbox.
2. Use the `s2b` bridge API for all vault interactions. Do NOT try to access `parent`, `top`, `localStorage`, or `document.cookie`.
3. Set `background: var(--background-primary)` and `color: var(--text-normal)` so the view blends with the Obsidian theme.
4. Keep code concise — output only the `manage_views` tool call, not explanations of the code.
5. For full-area views, use `width: 100%; height: 100vh;` on the main container and `overflow: auto` if content may scroll.
6. Always handle `s2b` errors gracefully — vault files may not exist or may have changed.
7. The `icon` parameter accepts any Lucide icon name (e.g. `calendar`, `table`, `bar-chart`, `kanban`, `clock`, `map`).

## Operations

### Create

```
manage_views({
  operation: {
    type: "create",
    title: "My Calendar",
    icon: "calendar",
    html: "<div id='app'></div>",
    css: "#app { padding: 16px; }",
    js: "const files = await s2b.listFiles(); document.getElementById('app').textContent = files.length + ' notes';"
  }
})
```

### Update

```
manage_views({
  operation: {
    type: "update",
    viewId: "01234567-...",
    html: "<div id='app'>Updated!</div>",
    js: "// new logic"
  }
})
```

### Delete

```
manage_views({
  operation: {
    type: "delete",
    viewId: "01234567-..."
  }
})
```

## Example: Note Calendar

A calendar view showing notes organized by their creation date:

```
manage_views({
  operation: {
    type: "create",
    title: "Note Calendar",
    icon: "calendar",
    html: "<div id='calendar'></div>",
    css: `
      #calendar { padding: 16px; font-family: inherit; overflow: auto; height: 100vh; }
      .month { margin-bottom: 24px; }
      .month h2 { color: var(--text-normal); margin-bottom: 8px; font-size: 1.1em; }
      .day { padding: 4px 8px; border-left: 2px solid var(--interactive-accent); margin: 2px 0; cursor: default; }
      .day:hover { background: var(--background-secondary); }
      .day-date { color: var(--text-muted); font-size: 0.85em; min-width: 80px; display: inline-block; }
      .day-title { color: var(--text-normal); }
    `,
    js: `
      const files = await s2b.listFiles();
      const entries = [];
      for (const f of files) {
        const props = await s2b.getProperties(f.path);
        const date = props.date || props.created || null;
        entries.push({ ...f, date });
      }
      entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      const grouped = {};
      for (const e of entries) {
        const key = e.date ? e.date.slice(0, 7) : 'No Date';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(e);
      }

      const cal = document.getElementById('calendar');
      for (const [month, notes] of Object.entries(grouped)) {
        const section = document.createElement('div');
        section.className = 'month';
        section.innerHTML = '<h2>' + month + '</h2>';
        for (const n of notes) {
          const row = document.createElement('div');
          row.className = 'day';
          row.innerHTML = '<span class="day-date">' + (n.date || '—') + '</span><span class="day-title">' + n.name + '</span>';
          section.appendChild(row);
        }
        cal.appendChild(section);
      }
    `
  }
})
```

## Capabilities

| Supported | Not Supported |
|-----------|---------------|
| Full DOM access | `fetch()`, `XMLHttpRequest` |
| Canvas 2D/WebGL | External CDN libraries |
| CSS animations | `parent`/`top` access |
| Keyboard/mouse events | `localStorage`/`sessionStorage` |
| `requestAnimationFrame` | `document.cookie` |
| `setTimeout`/`setInterval` | WebSocket |
| s2b bridge API (vault read/write) | Direct Obsidian API access |
