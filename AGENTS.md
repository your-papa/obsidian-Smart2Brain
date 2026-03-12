# Critical Rules

- after each implementation run `bun check` and `bun format`
- use the `obsidian` CLI to verify changes in a live vault (reload plugin, inspect DOM, check for errors). See the `obsidian-integration-test` skill for full reference.
- when executing `obsidian` CLI commands, always target the testing vault in this repo: `vault="integration/Smart2Brain Test Vault"`. The `vault=` flag must come **first**, before any other flags or subcommands (e.g., `obsidian vault="integration/Smart2Brain Test Vault" dev:reload`). See `integration/helpers/cli.ts` for reference.

# btca

When you need up-to-date information about technologies used in this project, use btca to query source repositories directly.

**Available resources**: check projects `btca.config.jsonc` for available resources.

### Usage

```bash
bunx btca ask -r <resource> -q "<question>"
```

Use multiple `-r` flags to query multiple resources at once:

```bash
bunx btca ask -r svelte -r bitsUi -q "How do I create accessible dialog components?"
```

## When to use `$effect`

- DOM manipulation (canvas, animations)
- Third-party library integration
- Cleanup operations (timers, event listeners)
- One-time initialization
- Browser-only operations (analytics, logging)

## When to AVOID `$effect`

- **State synchronization** - Don't use `$effect` to sync state between variables
- **Computed values** - Use `$derived` instead

# Custom Components

**Use project components over standard HTML elements.** This project has custom Obsidian-styled components.

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
```
