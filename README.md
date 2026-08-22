<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
  <img alt="Smart Second Brain" src="assets/logo-light.svg" width="300">
</picture>

</div>

<br>

Your Smart Second Brain is a **free** and **open-source** Obsidian plugin that makes your vault smarter — better search, an interactive knowledge graph, and an AI assistant that actually knows your notes.

The three are designed to work together: search surfaces your notes, the graph reveals how they connect, and the AI assistant can draw on both when answering. Each pillar is also useful on its own. **Smart search and the graph work right away with no AI provider** — connecting one (OpenAI, Anthropic, OpenRouter, or a local [Ollama](https://ollama.com/) model) unlocks the full AI assistant. Desktop-only.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/your-papa/obsidian-Smart2Brain/assets/48623649/3e9cb3bc-ea57-4afc-b616-9c9360e39232">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/your-papa/obsidian-Smart2Brain/assets/48623649/9948671a-ebc4-4315-b376-0918c6f7f4f8">
  <img alt="S2B Chat" src="https://github.com/your-papa/obsidian-Smart2Brain/assets/48623649/9948671a-ebc4-4315-b376-0918c6f7f4f8">
</picture>


# 🌟 Features

**🔍 Smarter search** *(no AI provider required)*

- A smarter search experience out of the box — full-text, fuzzy, and tag/frontmatter-aware, already more capable than Obsidian's default search. Add an embedding model to layer on semantic (vector) search for concept-level queries too.

**🕸️ Smart Graph** *(no AI provider required)*

- An interactive graph view that goes beyond Obsidian's link graph — with clustering, layout, and filtering to surface connections between notes. Add an embedding model to further enrich it with semantic similarity edges.

**🤖 Agentic chat with your notes** *(requires an AI provider)*

- **Tool-using agent:** An LLM agent that decides how to answer — it can search your vault, read note and file content, list folders, inspect tags and frontmatter properties, fetch URLs, and search the web as needed. Connect additional **MCP servers** to give the agent access to any external tool or data source.
- **Skills:** Extend the agent with reusable instruction sets. Bundled skills cover Dataview, Canvas, Bases, TaskNotes, and Obsidian Charts; you can add your own under the plugin's config folder.
- **Reference links to notes:** Answers cite the notes they draw from as Obsidian links, so you can trace where information comes from.
- **Staged note edits:** The agent can create and modify notes, but changes are **staged for your review** — you see an inline diff and approve or reject before anything is written to disk.
- **Run code in context:** Execute JavaScript and Dataview queries against your vault when a question needs computation, not just retrieval.
- **Conversation branching:** Chats are saved as `.chat` files in your vault. Editing or regenerating a message forks the conversation into a tree of branches instead of overwriting history.
- **Multimodal:** Send images and PDFs to models that support them — vision/PDF capability is detected per model automatically.

**🔌 Provider & model choice**

- **Providers:** OpenAI (and any OpenAI-compatible endpoint), Anthropic, Ollama (local), OpenRouter, [OrcaRouter](https://www.orcarouter.ai), and OpenAI Codex sign-in. Multiple instances of a provider with distinct names/endpoints are supported.
- **Local & private:** With Ollama, models run entirely on your machine and no data leaves it.
- **Quickly switch models:** Change the active model per chat — e.g. one model for scientific writing, another for brainstorming.
- **Fine-grained privacy controls:** Mark individual providers as *trusted* or *untrusted*. Set the vault to **private-by-default** (only notes you explicitly allow can reach a provider) or **public-by-default** (only notes you explicitly exclude are blocked). Untrusted providers — cloud APIs, by default — are blocked from reading, embedding, or being sent private notes, even if the agent tries to access them.

# ⚠️ Limitations

- **Performance depends on the chosen model:** Models vary in reasoning, tool use, and embedding quality, so results differ between them. Go with our recommendations or find your own best fit.
- **Quality depends on knowledge structure and organization:** The response improves when you have a clear structure and do not mix unrelated information or connect unrelated notes. Therefore, we recommend a well-structured vault and notes.
- **AI Assistant might generate incorrect or irrelevant answers:** Due to a lack of relevant notes or limitations of AI understanding the AI Assistant might generate unsatisfying answers. In those cases, we recommend rephrasing your query or describing the context in more detail

# 🔧 Getting started

Install from Obsidian's community plugins (or drop a build into `.obsidian/plugins/smart-second-brain/`), enable it, and you're done — smarter search and the Smart Graph work immediately with no configuration. Add an embedding model in the plugin settings to unlock semantic search and graph clustering; add an AI provider to enable the full agent.

# ⚙️ Under the hood

Built with Svelte 5, TypeScript, and Vite, orchestrating the agent via LangChain/LangGraph. Retrieval uses HNSW for vector search and MiniSearch for lexical search; graph computation and indexing run in web workers to keep the UI responsive. See [`docs/architecture-overview.md`](docs/architecture-overview.md) for the full deep-dive.

# 🎯 Roadmap

Much of the original roadmap has shipped: Claude support, hybrid vector search, chat threads/branching, an agent with Obsidian tooling, and multimodality are all in the plugin today. Next up:

- Similar-note connections view improvements
- Predictive note placement
- More UI languages

# 🧑‍💻 About us

We initially made this plugin as part of a university project, which is now complete. However, we are still fully committed to developing and improving the assistant in our spare time.
We use this as an experimental playground to explore state-of-the-art AI topics and as a tool to enrich the Obsidian experience we're so passionate about.
If you have any suggestions or wish to contribute, we would greatly appreciate it.

# 📢 You want to support?

- Report issues or open a feature request [here](https://github.com/your-papa/obsidian-Smart2Brain/issues/new/choose)
- Open a PR for code contributions — see **Development** below

# 🛠️ Development

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

To try a dev build in a real vault, run `bun run setup-vault` once to symlink `build/smart-second-brain/` into the bundled test vault's plugins folder, then open `integration/Smart2Brain Test Vault` in Obsidian and enable the plugin. See [`CLAUDE.md`](CLAUDE.md) for the full command reference and integration-test setup.


# ❓ FAQ

Don't hesitate to ask your question in the [Q&A](https://github.com/your-papa/obsidian-Smart2Brain/discussions/categories/q-a)

## Are any queries sent to the cloud?

Only if you choose a cloud AI provider (OpenAI, Anthropic, or OpenRouter) **and** the notes involved are not marked private. Search and graph features run entirely locally. With Ollama, everything stays on your machine. And even with a cloud provider configured, the built-in privacy controls let you mark notes or folders as private — those are blocked from being read, embedded, or sent to any untrusted (cloud) provider.

## How does it differ from the Smart Connections plugin?
The plugins share the goal of AI-assisted knowledge work, but the approach differs:
- We are completely open-source
- We support Ollama/local models without needing a license
- We place a lot of value on UI/UX
- Rather than a fixed RAG pipeline, we use a **tool-using agent** (LangChain/LangGraph) that can search, read, run Dataview/JS, and stage note edits
- Retrieval is **hybrid** — semantic (HNSW vector) plus lexical (MiniSearch) — and lexical search works even without an embedding model configured
- We ship a **Smart Graph** view and a **skills** system for extending the agent

## What models do you recommend?
Use the latest and most capable model your chosen provider offers. Frontier cloud models (recent OpenAI, Anthropic, and OpenRouter offerings) give the best reasoning and tool-use quality. For a fully local setup, a capable Ollama chat model paired with a strong embedding model such as `mxbai-embed-large` works well.

## Does it support multi-language vaults?

Yes. Response quality can vary with the model and the language used internally (more UI translations are on the way). Strong multilingual embedding models produce the best retrieval results.
