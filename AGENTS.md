# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project

Smart Second Brain is an Obsidian plugin (`smart-second-brain`) that turns the vault into an AI-assisted second brain: chat-with-your-notes via a RAG pipeline, a smart graph view, and provider-agnostic LLM support (OpenAI, Ollama, oMLX, Anthropic, OpenRouter, OpenAI-compatible endpoints). Runs on desktop and mobile (`isDesktopOnly: false`). Stack: Svelte 5 (runes) + TypeScript + Vite + LangChain/LangGraph, with Tailwind for styles, Biome for lint/format, Vitest for tests, and Bun as the package manager.

## Commands

Use `bun` (not npm/yarn). The lockfile is `bun.lock`.

- `bun run dev` — Vite watch build to `build/smart-second-brain/` (development).
- `bun run build` — production build to `build/prod`.
- `bun run check` — `svelte-check` over `tsconfig.json`. **Run after each implementation.**
- `bun run format` — Biome formatter (writes). **Run after each implementation.**
- `bun run lint` — Biome linter with `--unsafe` autofixes.
- `bun run test` — Vitest unit tests (single run). `bun run test:watch` for watch mode. `bun run test:coverage` for coverage.
- `bun run test -- <pattern>` — single file/pattern, e.g. `bun run test -- test/providers/openai.test.ts`.
- `bun run test:integration` — end-to-end tests against a live Obsidian instance (see Integration tests below).
- `bun run setup-vault` — symlinks `build/smart-second-brain/` into `integration/S2B Test Vault/.obsidian/plugins/`. Run once after the first build.

There is no separate `bun install` step needed beyond what `bun.lock` records; do **not** edit `package.json` versions manually without re-locking.

## Documentation lives on the site, not in the README

User-facing documentation lives in the **`s2b-dev/site`** repo (checked out at
`../site`), published at `smartsecondbrain.dev`. The README here is deliberately
minimal — pitch, install, development setup, links. Do not add feature lists,
provider tables, or FAQ content back into it; that duplication is what caused
the README to drift out of date.

**Before cutting a release**, refresh the site's enumerable facts — it is not
automated. The checklist lives in `../site/CLAUDE.md` under "Before a plugin
release" and covers the provider list, bundled skills, built-in tools,
`minAppVersion`, and platform support. Changing `PROVIDER_TEMPLATES`,
`BUILT_IN_TOOL_IDS`, `src/skills/defaults/`, or `manifest.json` means the site
needs updating too.

## btca — querying upstream docs

When working with the libraries in this project, use `btca` to pull real docs from source repos rather than relying on memory:

```bash
bunx btca ask -r <resource> -q "<question>"
```

Resources defined in `btca.config.jsonc`: `svelte`, `tailwindcss`, `langchainjs`, `bitsui`, `runed`, `zod`, `tanstackQuery`, `obsidian`, `btca`, `biome`. Pass multiple `-r` flags to query several at once.

## Architecture

This section is the canonical description of the architecture. (A longer
`docs/architecture-overview.md` existed but went stale and was removed in
August 2026; recover it from git history if useful, but do not trust it.)

### Composition root

`src/main.ts` (`SecondBrainPlugin`) is the single owner of lifecycle. It:
- Constructs the data store, then registers views/commands/extensions synchronously.
- Defers heavy init (`LexicalSearchService`, `VectorStoreService`, `SkillsService`, `AgentManager`) to `onLayoutReady` so the workspace renders immediately. If a chat opens before init finishes, `AgentManager.ensureAgent()` lazy-initializes.
- Patches `WorkspaceLeaf.prototype.openFile` so `.chat` files always open in the configured sidebar split rather than replacing the active note.
- Registers three views: `VIEW_TYPE_CHAT` (`.chat` FileView), `VIEW_TYPE_SMART_GRAPH`, `VIEW_TYPE_ONBOARDING`. (`VIEW_TYPE_NOTE_CONTEXT` exists but is **disabled for the initial release** — its registration, command and activator are commented out in `main.ts`.)

### Layered structure

- `src/agent/` — LLM orchestration. `Agent.ts` wraps LangChain React-agent execution and streaming; `AgentManager.ts` is the Obsidian-facing facade that registers providers, binds tools (`tools/`), assembles the system prompt from base prompt + selected skills, and resolves multimodal capability dynamically per model. `ObsidianChatManager.ts` is a custom LangGraph checkpoint saver: threads stored as NDJSON `.chat` files in the vault, fast index in plugin data. **Conversation history is a tree of checkpoints, not a flat list** — edit/regenerate creates branches.
- `src/providers/` — Template-aware provider definitions (one file per vendor) plus a singleton runtime `registry.ts` holding only **configured** providers. OpenAI-compatible is treated as a first-class template. Multiple instances per template are supported with distinct display names/endpoints.
- `src/vectorstore/` — Hybrid retrieval. `VectorStoreService.ts` owns index lifecycle and supports multiple indexes keyed by embedding model (chat retrieval and graph analytics can use different models). `HNSWVectorStore.ts` + `hnswWorker.ts` for ANN; `MiniSearchService.ts` for BM25-style lexical fallback (works without any embedding model configured).
- `src/search/` — Query planning, lexical scoring, recent-notes boosting, final ranking pipeline used by the search modal and `search_notes` tool.
- **Agent context lives under one vault folder.** All of an agent's editable context is consolidated under a single configurable root, `agentFolder` (default `Agents/`), with three fixed subdirectories, so everything the system prompt is built from is a real, user-visible note:
  - `Agents/Memories/` — shared working-memory notes (global across agents; writes inside it auto-approve when `memoryEnabled` + `manage_notes`).
  - `Agents/Skills/` — skill `<name>/SKILL.md` dirs. **Everything is a skill**: the 4 former capabilities (`vault`, `notes`, `web`, `update`) ship as bundled **core skills** whose body is their guidance and whose `allowed-tools` frontmatter attaches built-in tools; user skills are the same thing with no attached tools. Discovery scans this folder and treats every `SKILL.md` dir as a skill (no reserved names, no `GUIDANCE.md`).
  - `Agents/System Prompts/<Agent Name>/` — one subfolder per agent, holding `Base.md` (the base system prompt) and `Memory.md` (memory-usage instructions, injected right after the base prompt when memory is enabled). Both files move together on agent rename/duplicate/delete (see `PromptFilesService`).
  The whole tree is plugin machinery, excluded from indexing/search/graph via `isAgentFilePath` in `utils/fileFiltering.ts` (path helpers in `utils/agentPaths.ts`). Legacy installs are consolidated on first run (`SkillsService.migrateAgentFolder`, from the old top-level `Skills/` folder or the pre-vault `<configDir>/skills`); the v6 `migrateCoreSkills` deletes orphaned per-core-skill `GUIDANCE.md` files so the bundled core-skill `SKILL.md`s seed cleanly into the same dirs.
- `src/skills/` — Two-phase skill system (Agent Skills style): discover frontmatter on startup, load full content on demand. Bundled defaults under `src/skills/defaults/` (including the `vault`/`notes`/`web`/`manage-skills` core skills — the last one was named `update-skills` before it gained create/delete, migrated in schema v8). **`allowed-tools` is load-bearing**: `AgentManager.buildToolsForAgent` binds a built-in tool only when some *enabled* skill attaches it via `allowed-tools` AND the per-tool `toolsConfig[toolId].enabled` override hasn't vetoed it. All skill guidance reaches the model lazily — advertised by description in the `# Skills` `<available_skills>` block, body loaded on demand via `load_skill`. The `manage_skills` tool (the opt-in "Manage Skills" core skill) lets an agent create new skills, revise its own attached skills, or delete skills it created; unlike `manage_notes`, every operation applies immediately with no `pendingChangesStore` review step — creating a skill is the same action as attaching it. A created skill gets no explicit `agent.skills` entry, so it reads as attached (`?? true`) the moment its file exists on disk. `allowedTools` on a new skill is filtered through a fixed read-only allow-list, never passed through verbatim — the one guard against an agent granting itself new capability via a skill it just wrote. Deleting a built-in core skill is refused (it would just reappear via `bootstrapDefaultSkills` on next startup). Because a tool can be attached by more than one skill (e.g. an integration skill re-declaring a tool a core skill already owns), per-tool overrides are **not** configured per-skill — they live in one agent-level `ToolsModal` (opened from the "Tools" row in the Agent editor's General section), which lists all `BUILT_IN_TOOL_IDS` flat and shows each tool's attaching skill(s).
- `src/agent/promptFiles.ts` — File-backed store for each agent's `System Prompts/<Agent Name>/{Base,Memory}.md`. The code constants `BASE_SYSTEM_PROMPT` / `DEFAULT_MEMORY_PROMPT` remain the factory defaults the diff/reset UI compares against; the files are the editable copies. Content is cached in memory (populated at init + on vault change) so `assembleSystemPrompt` and the reactive stale-guidance getter read it without hitting disk. Editing happens in the vault note (pencil/"open note"); the `SystemPromptModal` diff modal stays for comparing against the default and resetting. Because both files share a folder, rename/duplicate/delete are single directory operations, not per-file ones. (Skill/tool guidance is no longer stored here — it's the skill body, edited via the note / `manage_skills`.)
- `src/stores/` — Reactive state via Svelte 5 runes (`*.svelte.ts`). `dataStore` is canonical config + secrets indirection; `chatStore` owns the message timeline, branching metadata, and messenger orchestration; `pendingChangesStore` stages note mutations for review.
- `src/components/` — Feature-vertical Svelte UI: `chat/`, `graph/`, `settings/`, `modal/`, plus shared `ui/` and `base/` primitives. Markdown rendering goes through Obsidian's renderer (not a custom one).
- `src/views/` — Thin Obsidian view wrappers (`ItemView`/`FileView`/`PluginSettingTab`) that mount Svelte components.
- `src/editor/` — CodeMirror extensions (`inlineDiffExtension`, `selectionHighlightExtension`) and a markdown post-processor for reading-view diffs. Pending-change refresh is event-driven via the custom `s2b-pending-changes-updated` DOM event.
- `src/lib/` — Adapters that hide host quirks: `obsidianFetch.ts` (native fetch first, `requestUrl` fallback for CORS), `aiTransport.ts` (streaming-mode fallback), `secretStorage.ts`, `query.ts` (TanStack Query), `i18n.ts` + `en.json`/`de.json`.
- `src/hooks/` — Svelte 5 reactive context helpers (`*.svelte.ts`): visible notes, selection, available models, secrets.
- `src/utils/` — Pure helpers (PDF extraction, clustering/projection, worker orchestration via `computeWorkerManager.ts`, token estimation, wikilink extraction).

### Cross-cutting

- **Staged writes:** Tools that mutate notes go through `pendingChangesStore` for user review rather than applying immediately.
- **Worker offload:** Graph projection/clustering and HNSW operations run in workers (`hnswWorker.ts`, `computeWorker.ts`) to keep the UI fluid.
- **Capability-driven multimodal:** Vision/PDF support is resolved per model at runtime — do not hard-code provider assumptions.
- **Secrets:** `dataStore` holds secret IDs, not raw values; raw values resolve through `secretStorage.ts`.

## Build

`vite.config.ts` outputs a CommonJS bundle as `main.js` for Obsidian. Externals: `obsidian`, `electron`, all `@codemirror/*` and `@lezer/*` (provided by host), `@sap-ai-sdk/langchain` (optional dep), and Node builtins. Dev mode emits to `build/smart-second-brain/` with sourcemaps; production wipes and emits minified to `build/prod`.

Tests mock `obsidian`, `electron`, and `@sap-ai-sdk/langchain` via `test/__mocks__/` aliases in `vitest.config.ts`. The unit suite uses `jsdom`, runs `pool: forks` with `fileParallelism: false` and `mockReset: true` to prevent leakage. Coverage scope is `src/providers/**` only.

## Code conventions

- **Biome** governs lint/format. Tabs (width 4), line width 120, semicolons always, trailing commas everywhere. `useConst` and `useImportType` are off. Imports auto-organize.
- **Svelte 5 runes:**
  - Use `$effect` for: DOM manipulation (canvas, animations), third-party library integration, cleanup (timers, listeners), one-time init, browser-only operations (analytics, logging).
  - **Avoid `$effect`** for state synchronization (don't sync state between variables) or for computed values (use `$derived`).
- **Custom components over raw HTML.** This project has Obsidian-styled wrappers — use them. In particular: every form control in settings must be wrapped in a `SettingContainer` (with `name=` and `desc=`) so the layout matches Obsidian conventions:
  ```svelte
  <SettingContainer name="API Key" desc="Your provider API key">
      <TextComponent inputType="password" bind:value={apiKey} />
  </SettingContainer>
  ```
- **Prefer Obsidian's native styling over custom CSS.** Match native look/behavior wherever possible instead of reinventing it. For icon buttons use the native `.clickable-icon` class (it already provides the transparent-at-rest → `--background-modifier-hover` highlight, native rounding, and cursor) rather than hand-rolled hover backgrounds. Lean on Obsidian's CSS variables (`--background-modifier-hover`, `--radius-s`, `--text-muted`, etc.) so the plugin tracks the user's theme. Only add custom CSS when native genuinely can't express the intent.

## Verifying changes in a live vault

Prefer the Obsidian CLI for manual verification over editing-and-hoping. Always target the test vault by name, with `vault=` **first**:

```bash
obsidian vault="S2B Test Vault" command id=smart-second-brain:search-notes
obsidian vault="S2B Test Vault" dev:dom selector='.s2b-search-modal' total
obsidian vault="S2B Test Vault" dev:screenshot path="/tmp/search-modal.png"
obsidian vault="S2B Test Vault" dev:errors
```

Stable manual flow:
1. Open the test vault once in the Obsidian desktop app.
2. Run a `command`.
3. **Poll** for the selector before inspecting — some commands return before the UI mounts. Don't assume failure if a modal isn't there immediately.
4. Use `command`, `dev:dom`, `dev:screenshot`, `dev:errors`. Reserve `eval` and `dev:cdp` for cases where DOM queries and screenshots are insufficient — they're more brittle.

Known issue: on macOS, launching `obsidian` from Codex Desktop can cause Obsidian to quit unexpectedly (upstream `openai/codex#13706`). If that happens, run the CLI from a normal terminal instead, or reopen the vault and minimize CLI calls. Reference flow lives in `integration/helpers/cli.ts`; see also the `obsidian-integration-test` skill under `.github/skills/`.

## Integration tests

`integration/` runs Vitest against a live Obsidian via the CLI (`integration/helpers/cli.ts`). Setup:

1. `bun run build`
2. `bun run setup-vault` (one-time symlink)
3. Open `integration/S2B Test Vault` in Obsidian and enable the plugin.
4. (Optional) Configure a provider with valid API keys for LLM-dependent tests.
5. `bun run test:integration` — or a single file: `bunx vitest run --config vitest.integration.config.ts integration/plugin-lifecycle.test.ts`

Tests run **sequentially** (`fileParallelism: false`, single shared Obsidian instance), 120s timeout, 1 retry. Tests requiring an LLM (`agent-interaction`, `chat-e2e-flow`, `multi-turn`) auto-skip when no provider is configured but **fail** if a provider is configured with invalid keys. To skip them entirely:

```bash
bunx vitest run --config vitest.integration.config.ts --exclude 'integration/{agent-interaction,chat-e2e-flow,multi-turn}.test.ts'
```

`globalSetup.ts` performs a disable/enable cycle before the suite to start clean.
