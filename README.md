<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
  <img alt="Smart Second Brain" src="assets/logo-light.svg" width="300">
</picture>

</div>

<br>

Your Smart Second Brain is a **free** and **open-source** Obsidian plugin that makes your vault smarter: better search, an interactive knowledge graph, and an AI assistant that actually knows your notes.

Search surfaces your notes, the graph reveals how they connect, and the assistant can draw on both when answering. **Search and the graph work right away with no AI provider.** Connecting one unlocks the full agent. Runs on desktop and mobile.

**[smartsecondbrain.dev](https://smartsecondbrain.dev)** has the features, setup guides, and documentation.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/s2b-dev/smart-second-brain/assets/48623649/3e9cb3bc-ea57-4afc-b616-9c9360e39232">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/s2b-dev/smart-second-brain/assets/48623649/9948671a-ebc4-4315-b376-0918c6f7f4f8">
  <img alt="S2B Chat" src="https://github.com/s2b-dev/smart-second-brain/assets/48623649/9948671a-ebc4-4315-b376-0918c6f7f4f8">
</picture>

## Install

Install **Smart Second Brain** from Obsidian's community plugins and enable it. Search and the Smart Graph work immediately, with no configuration.

Add an embedding model to unlock semantic search and graph clustering; add an AI provider to enable the agent. See the [getting started guide](https://smartsecondbrain.dev/start/installation/).

## Network use

The plugin only makes network requests to the AI providers **you** configure (a local one like Ollama, or cloud APIs such as OpenAI, Anthropic, or OpenRouter) to generate embeddings and chat responses, plus web requests on your agent's behalf when you enable the web skill. Out of the box, nothing leaves your machine, and notes on your privacy list are never sent to untrusted providers. There is no telemetry. See the [privacy documentation](https://smartsecondbrain.dev/privacy/model/) for details.

## Documentation

Everything lives at **[smartsecondbrain.dev](https://smartsecondbrain.dev)**:

- [Getting started](https://smartsecondbrain.dev/start/installation/): install, first run, connecting a provider
- [Search](https://smartsecondbrain.dev/search/): hybrid lexical + semantic search
- [Graph](https://smartsecondbrain.dev/graph/): the smart graph view
- [Agents](https://smartsecondbrain.dev/agents/): skills, integrations, memory, MCP
- [Privacy](https://smartsecondbrain.dev/privacy/model/): what leaves your machine, and what never does
- How it works: [search](https://smartsecondbrain.dev/search/how-it-works/) and [graph](https://smartsecondbrain.dev/graph/how-it-works/) internals

## Development

This project uses [Bun](https://bun.sh/) as its package manager.

```bash
bun install         # install dependencies
bun run dev         # watch build into build/smart-second-brain/
bun run build       # production build into build/prod
bun run check       # svelte-check type checking
bun run format      # Biome formatter
bun run lint        # Biome linter
bun run test        # Vitest unit tests
```

To try a dev build in a real vault, run `bun run setup-vault` once to symlink `build/smart-second-brain/` into the bundled test vault's plugins folder, then open `integration/S2B Test Vault` in Obsidian and enable the plugin. See [`AGENTS.md`](AGENTS.md) for the full command reference and integration-test setup.

[`AGENTS.md`](AGENTS.md) describes the module structure and conventions.

## Contributing

- Report a bug or request a feature [here](https://github.com/s2b-dev/smart-second-brain/issues/new/choose)
- Ask a question in the [Q&A](https://github.com/s2b-dev/smart-second-brain/discussions/categories/q-a)
- Share a skill, agent, or workflow in [Show and tell](https://github.com/s2b-dev/smart-second-brain/discussions/categories/show-and-tell)
- Pull requests welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, including how we handle AI-assisted contributions

We initially built this as a university project. That's long finished, but we keep developing it in our spare time, as an experimental playground for state-of-the-art AI and as a tool for the Obsidian workflow we're passionate about.

## License

[MIT](LICENSE)
