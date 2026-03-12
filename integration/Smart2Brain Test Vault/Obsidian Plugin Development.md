# Obsidian Plugin Development

#obsidian #development #javascript

Building plugins for Obsidian involves working with TypeScript, the Obsidian API, and understanding the vault file system. Plugins can extend the editor, add commands, create custom views, and integrate with external services.

## Getting Started

Every plugin needs a `manifest.json` that declares its ID, name, version, and minimum Obsidian version. The main entry point is a class extending `Plugin` with `onload()` and `onunload()` lifecycle methods.

## Key Concepts

- **Commands** — actions registered via `addCommand()` that users can invoke from the command palette
- **Views** — custom UI panels created with `ItemView` or `MarkdownView`
- **Settings** — persistent configuration stored in `data.json` within the plugin directory
- **Events** — hooks into vault changes, file modifications, and layout events

## Working with the Vault

The vault API provides methods to read, create, modify, and delete files. Plugins should use `app.vault.adapter` for file operations and respect the user's workspace layout.

## Best Practices

- Always clean up resources in `onunload()`
- Use debouncing for expensive operations triggered by user input
- Store minimal state and derive the rest
- Test with multiple themes and screen sizes

Related: [[The History of Computing]]
