# Critical Rules

- **ONLY use `bun`** - never npm/yarn
- **NEVER run dev/build commands** (`bun dev`, `bun build`)
- **ALWAYS use svelte 5 syntax, no legacy**


## When to use `$effect`
- DOM manipulation (canvas, animations)
- Third-party library integration
- Cleanup operations (timers, event listeners)
- One-time initialization
- Browser-only operations (analytics, logging)

## When to AVOID `$effect`
- **State synchronization** - Don't use `$effect` to sync state between variables
- **Computed values** - Use `$derived` instead

# btca

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

# Custom Components

**Use project components over standard HTML elements.** This project has custom Obsidian-styled components in `src/components/`.

## SettingContainer Usage

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
