# AGENTS.md

## Critical Rules

- **ONLY use `bun`** - never npm/yarn
- **NEVER run dev/build commands** (`bun dev`, `bun build`)
- **ALWAYS use svelte 5 syntax, no legacy**

### Root Commands

- Type check: `bun run check`
- Format: `bun run format`
- Lint: `bun run lint`

## Code Style

- **Runtime**: Bun only. No Node.js, npm, pnpm, vite, dotenv.
- **TypeScript**: Strict mode enabled. Biome target.
- **Imports**: External packages first, then local. Use `.ts` extensions for local imports.

## btca

When you need up-to-date information about technologies used in this project, use btca to query source repositories directly.

**Available resources**: svelte, tailwindcss, langchainjs, bitsUi, runed, zod, tanstackQuery, obsidian, dexie, biome

### Usage

```bash
bunx btca ask -r <resource> -q "<question>"
```

Use multiple `-r` flags to query multiple resources at once:

```bash
bunx btca ask -r svelte -r bitsUi -q "How do I create accessible dialog components?"
```

## codesearch

**Prefer codesearch over grep/glob** for finding code in this repository. It uses semantic search to find relevant code.

### Usage

```bash
bunx codesearch search "<question>"
```

Only use the `search` command. Do not use `index`, `watch`, `init`, or `stats` commands.

## Custom Components

**Use project components over standard HTML elements.** This project has custom Obsidian-styled components in `src/components/`.

### Base Components (`src/components/base/`)

| Component | Use instead of |
|-----------|----------------|
| `Button.svelte` | `<button>` |
| `Toggle.svelte` | `<input type="checkbox">` |
| `Dropdown.svelte` | `<select>` |
| `Text.svelte` | `<input type="text">` / `<input type="number">` |
| `Slider.svelte` | `<input type="range">` |
| `Icon.svelte` | manual icon rendering |
| `MarkdownRenderer.svelte` | raw HTML for markdown |
| `Suggestion.svelte` | custom autocomplete |
| `FilePopover.svelte` | file selection UI |
| `ProgressBar.svelte` / `ProgressCircle.svelte` | progress indicators |
| `LoadingAnimation.svelte` / `DotAnimation.svelte` | loading states |

### Settings Components (`src/components/Settings/`)

| Component | Purpose |
|-----------|---------|
| `SettingContainer.svelte` | Wrapper for settings rows (name, description, control) |
| `ConfiguredProvider.svelte` | Provider configuration accordion |
| `ProviderSetup.svelte` | Provider setup flow |
| `AuthConfigFields.svelte` | Authentication fields |
| `ConfirmModal.svelte` | Confirmation dialogs |

### SettingContainer Usage

**Every form control in settings must be wrapped in a `SettingContainer`.** This ensures consistent Obsidian-style layout with name, description, and control aligned properly.

```svelte
<!-- Correct: Each control in its own SettingContainer -->
<SettingContainer name="API Key" desc="Your provider API key">
    <TextComponent inputType="password" bind:value={apiKey} />
</SettingContainer>
<SettingContainer name="Model" desc="Select a model">
    <Dropdown type="options" dropdown={modelOptions} bind:selected={model} onSelect={handleSelect} />
</SettingContainer>

<!-- Incorrect: Multiple controls in one container -->
<SettingContainer name="Settings" desc="Configure your settings">
    <div>
        <TextComponent ... />
        <Dropdown ... />
    </div>
</SettingContainer>
```

For action buttons without a label, use empty strings:
```svelte
<SettingContainer name="" desc="">
    <div class="flex gap-2">
        <Button cta buttonText="Save" onClick={handleSave} />
        <Button buttonText="Cancel" onClick={handleCancel} />
    </div>
</SettingContainer>
```

## Svelte 5 Runes - $effect Best Practices

This project uses Svelte 5 with runes (`$state`, `$derived`, `$effect`).

### When to use `$effect`
- DOM manipulation (canvas, animations)
- Third-party library integration
- Cleanup operations (timers, event listeners)
- One-time initialization
- Browser-only operations (analytics, logging)

### When to AVOID `$effect`
- **State synchronization** - Don't use `$effect` to sync state between variables
- **Computed values** - Use `$derived` instead

### Anti-pattern (avoid):
```svelte
<script>
  let count = $state(0);
  let doubled = $state();

  $effect(() => {
    doubled = count * 2; // ❌ Don't mutate state in effects
  });
</script>
```

### Correct pattern:
```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2); // ✅ Use $derived for computed values
</script>
```

### Key rules:
1. Prefer `$derived` over `$effect` for computed values
2. Handle state changes at the source (e.g., in dataStore methods) rather than reacting in UI
3. Use `untrack()` if you must update state in effects to prevent infinite loops
4. Treat `$effect` as an escape hatch, not a primary tool
