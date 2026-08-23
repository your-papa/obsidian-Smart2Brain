# Critical Rules

- after each implementation run `bun check` and `bun format`
- use the `obsidian` CLI to verify changes in a live vault (reload plugin, inspect DOM, check for errors). See the `obsidian-integration-test` skill for full reference.
- when executing `obsidian` CLI commands, always target the opened test vault by name: `vault="S2B Test Vault"`. The `vault=` flag must come **first**, before any other flags or subcommands (e.g., `obsidian vault="S2B Test Vault" command id=smart-second-brain:search-notes`). See `integration/helpers/cli.ts` for reference.
- prefer this stable manual verification flow with the Obsidian CLI:
  1. Open the test vault once in the Obsidian desktop app.
  2. Run a command, such as `obsidian vault="S2B Test Vault" command id=smart-second-brain:search-notes`.
  3. Wait briefly or poll for the UI to exist before inspecting it, for example `obsidian vault="S2B Test Vault" dev:dom selector='.s2b-search-modal' total`.
  4. Use `dev:dom`, `dev:screenshot`, and `dev:errors` for verification.
- prefer `command`, `dev:dom`, `dev:screenshot`, and `dev:errors` over `eval` or `dev:cdp` for routine manual checks. `eval` and `dev:cdp` are more brittle and should be reserved for cases where DOM queries and screenshots are insufficient.
- if a modal or view does not appear immediately after an Obsidian CLI command, do not assume failure. Poll for the selector first; some commands return before the UI has fully mounted.
- known upstream issue: on macOS, launching `obsidian` from Codex Desktop can cause Obsidian to quit unexpectedly in some environments. See `openai/codex` issue `#13706`.
- if Obsidian starts quitting unexpectedly during CLI verification, stop running more `obsidian` commands from Codex for that task and switch to one of these safer options:
  1. Run the same `obsidian` CLI commands manually in a regular terminal outside Codex.
  2. Reopen Obsidian, restore the test vault, and continue verification with the minimum number of `command` / `dev:dom` / `dev:screenshot` calls needed.

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
