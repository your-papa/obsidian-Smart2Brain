# Smart2Brain Architecture Overview

> [!WARNING]
> **This document is outdated.** It was last revised in April 2026 and does not
> reflect the current codebase. Treat it as background on the original design
> rather than an accurate map. For current structure and conventions, see
> [`CLAUDE.md`](../CLAUDE.md); for retrieval specifically, see the
> [search algorithm reference](https://smartsecondbrain.dev/internals/search-algorithm/).

## Document Purpose

This document explains how the plugin is architected at a system level.

It is intentionally **not** a code reference. Instead, it focuses on:

- How responsibilities are split across modules
- Runtime boundaries and data flow
- Why key technical decisions were made
- Trade-offs and operational implications

## Scope

This overview covers the full `src/` codebase:

- Runtime entry and lifecycle
- Agent and tool orchestration
- Provider and model abstraction
- Retrieval and vector indexing
- Chat persistence and branching model
- Smart Graph pipeline
- UI and view composition
- Cross-cutting concerns (security, performance, telemetry)

## Architectural Intent

The plugin aims to deliver a privacy-aware AI assistant for Obsidian while remaining:

- Provider-agnostic (cloud and local models)
- Vault-native (Obsidian files remain the source of truth)
- UX-responsive (streaming + background indexing + worker offloading)
- Recoverable and inspectable (checkpointed conversations + staged writes)

## System Context

At runtime, Smart2Brain sits between three worlds:

1. Obsidian host runtime

- Plugin lifecycle, vault I/O, metadata cache, views, commands

2. AI ecosystems

- LangChain/LangGraph agent stack
- Multiple provider APIs (OpenAI-compatible, Ollama, Anthropic, OpenRouter, Codex-style)

3. Local knowledge substrate

- Markdown notes, frontmatter, tags, files/attachments
- Local vector and lexical indexes for retrieval

## High-Level Architecture

### 1) Runtime Shell

- `main.ts` composes services, registers views/commands, and wires lifecycle.
- Main concerns:
  - Plugin startup order
  - View registration and routing (`.chat` file handling)
  - Service ownership and cleanup

### 2) Domain Services

- `agent/` -> LLM agent orchestration, tools, checkpoints
- `vectorstore/` -> embeddings + lexical indexing + sync
- `skills/` -> skill discovery/load pipeline (Agent Skills style)
- `providers/` -> model/provider abstraction layer

### 3) State and Persistence Layer

- `stores/` -> reactive app state and chat session orchestration
- `agent/ObsidianChatManager.ts` -> durable chat/checkpoint storage in vault + plugin data
- Obsidian adapter and vault APIs as canonical storage mechanism

### 4) UI/Views Layer

- `views/` -> Obsidian view wrappers and mounting boundaries
- `components/` -> Svelte UI for chat, settings, graph, modal flows
- `editor/` -> editor and reading-view diff/highlight integrations

### 5) Infra/Utility Layer

- `lib/`, `utils/`, `types/`, `hooks/` -> shared infrastructure, adapters, and contracts

## Module Responsibilities by Folder

## `src/main.ts`

Role: Composition root and lifecycle coordinator.

Key decisions:

- Single owner of service initialization and teardown.
- Non-blocking vector store startup (`startInitialize`) to reduce perceived load time.
- Patches `.chat` open behavior to route to configured sidebar and preserve note editing context.
- Registers both command surface and UI entry points (ribbon, views, settings).

Why this matters:

- Centralizing lifecycle avoids duplicate setup/teardown logic.
- Startup remains responsive even with heavy indexing features.

## `src/agent/`

Role: AI runtime and tool orchestration.

Key components:

- `Agent.ts`
  - Wraps LangChain React agent creation and execution.
  - Handles multimodal message construction (text, images, PDF handling by provider capability).
  - Streams token/tool events and produces final run metadata.

- `AgentManager.ts`
  - Obsidian-facing facade over `Agent`.
  - Registers configured providers into runtime registry.
  - Binds built-in tools and optional MCP tools.
  - Assembles system prompt from base prompt + selected skills + tool guidance.
  - Manages deferred setup (vision capability resolution, MCP loading).

- `ObsidianChatManager.ts`
  - Custom checkpoint saver using Obsidian adapter.
  - Stores thread content in `.chat` NDJSON files.
  - Maintains fast thread index in plugin data path.
  - Handles external file deletion and cache consistency.

- `tools/`
  - Structured tool set for search, reading content, note mutation, metadata/tag access, JS/dataview execution, skill loading.
  - Write operations are staged first (approval-oriented workflow) rather than applied immediately by default interaction flow.

Architectural decisions:

- Split low-level LLM execution (`Agent`) from host orchestration (`AgentManager`).
  - Rationale: isolate provider/tool/prompt policy from streaming and message plumbing.
- Keep checkpointing inside Obsidian-native storage rather than external DB.
  - Rationale: portability with vault and offline behavior.
- Capability-based multimodal behavior (vision/PDF support resolved dynamically).
  - Rationale: avoid hard-coding assumptions across rapidly changing model catalogs.

## `src/providers/`

Role: provider abstraction and runtime registry.

Key components:

- Template-aware provider definitions (`index.ts` + per-provider files).
- Singleton runtime registry (`registry.ts`) for configured providers only.
- Auth and endpoint concerns separated from model invocation contracts.

Architectural decisions:

- Runtime registry holds only configured providers.
  - Rationale: cleaner failure modes and less conditional logic during run-time model creation.
- Provider definitions created from template metadata.
  - Rationale: supports multiple configured instances with unique display names/endpoints.
- OpenAI-compatible pattern normalized as a first-class template.
  - Rationale: keeps custom endpoints interoperable while preserving one invocation model.

Trade-off:

- Singleton registry simplifies access but creates implicit global state. Tests and reinit paths must reset carefully.

## `src/vectorstore/`

Role: retrieval substrate for semantic and lexical search.

Key components:

- `VectorStoreService.ts`
  - Service singleton controlling index lifecycle and indexing workflows.
  - Supports multiple indexes keyed by embedding model (search index and graph index can differ).
  - Runs provider-independent lexical index (`MiniSearch`) even without embedding model configuration.

- `HNSWVectorStore.ts`, `hnswWorker.ts`, `HNSWWorkerProxy.ts`
  - Approximate nearest-neighbor semantic retrieval.

- `MiniSearchService.ts`
  - BM25-style lexical retrieval for resilience and fallback.

Architectural decisions:

- Multi-index design per embedding model.
  - Rationale: avoids cross-model vector incompatibility and enables separate concerns (chat retrieval vs graph analytics).
- Hybrid retrieval strategy.
  - Rationale: lexical search remains useful for exact terms and metadata-heavy notes; semantic search captures conceptual similarity.
- Background-first indexing with vault event integration.
  - Rationale: index freshness without blocking user workflow.

Trade-off:

- Index management complexity increases (versioning, sync, migration, model-specific metadata).

## `src/stores/`

Role: reactive state and orchestration boundary between domain services and UI.

Key components:

- `dataStore.svelte.ts`
  - Canonical plugin configuration model + defaults.
  - Agent/tool settings, provider metadata, index selection, graph settings, and more.
  - Manages secret indirection (IDs vs raw values).

- `chatStore.svelte.ts`
  - Message model, timeline/tool event rendering state, checkpoint graph state, branching metadata.
  - Messenger orchestration for send/edit/regenerate workflows.
  - Handles integration points for selected notes, visible notes, and text selection context.

- `pendingChangesStore.svelte.ts`
  - Staged note mutations and review workflow state.

Architectural decisions:

- State is explicit and typed rather than ad-hoc component-local for core flows.
  - Rationale: checkpoint branching and multi-view interactions need deterministic state transitions.
- Keep config and runtime chat orchestration separate stores.
  - Rationale: avoids accidental coupling between static settings and high-frequency streaming state.

## `src/components/`

Role: feature UI and presentation logic.

Sub-areas:

- `chat/` -> chat interface, timeline rendering, attachments, model popovers, message editing/regen controls
- `graph/` -> smart graph canvas, controls, filtering, selection, cluster labeling
- `settings/` -> provider/agent/tool/graph settings UX
- `modal/` -> search and focused workflows
- `ui/` and `base/` -> reusable visual components and markdown renderer bridge

Architectural decisions:

- Svelte componentization by feature vertical (chat/graph/settings) with shared UI primitives.
  - Rationale: keeps high-change feature surfaces isolated while enabling common styling and behavior.
- Leverage Obsidian markdown rendering rather than custom markdown engine.
  - Rationale: consistency with host rendering semantics and link behavior.

## `src/views/`

Role: Obsidian integration wrappers.

Key components:

- `views/chat/Chat.ts` -> FileView for `.chat` threads
- `views/smart-graph/SmartGraphView.ts` -> ItemView for graph workspace
- `views/settings/Settings.ts` -> PluginSettingTab with Svelte mount boundary

Architectural decisions:

- Keep Obsidian-specific APIs in view wrappers, while complex UI remains inside Svelte components.
  - Rationale: clear host-integration seam, easier component evolution/testing.

## `src/skills/`

Role: skill catalog discovery and activation.

Key components:

- `SkillsService.ts`
  - Bootstraps bundled skills
  - Discovers and validates frontmatter
  - Loads full skill content only on demand

Architectural decisions:

- Two-phase skill lifecycle (discover metadata first, load content later).
  - Rationale: keep prompt assembly cheap while still enabling rich skill instructions when invoked.
- Skills stored under Obsidian config path.
  - Rationale: user-customizable and vault-local behavior.

## `src/editor/`

Role: editor/reading-view augmentation for pending changes and context cues.

Key decisions:

- Editor decorations and reading-view post-processing are registered as plugin extensions.
- Pending-change refresh is event-driven (`s2b-pending-changes-updated`) rather than polling.

## `src/lib/`

Role: infrastructure adapters.

Important elements:

- `aiTransport.ts`
  - Transport-mode management with fallback behavior for problematic streaming scenarios.
  - Encapsulates downgrade semantics and context propagation.

- `obsidianFetch.ts`
  - Native fetch first; Obsidian requestUrl fallback for CORS-constrained environments.

- `query.ts`, `QueryClientProvider.svelte`
  - Query-client integration for async UI data flows.

- `secretStorage.ts`
  - Secret value handling abstraction.

Architectural decisions:

- Keep host/network quirks isolated behind dedicated adapters.
  - Rationale: avoids leaking platform-specific complexity into agent/provider logic.

## `src/hooks/`

Role: shared reactive context helpers.

Examples:

- visible notes context capture
- selection context capture
- available models and secret-related helpers

Design choice:

- Context gathering is explicit and composable, then passed into chat runs.

## `src/utils/`

Role: pure utility algorithms and helpers.

Major themes:

- attachments and encoding
- PDF text extraction
- clustering and projection support
- worker orchestration helpers
- logging, token estimation, identifiers, wikilink extraction

Design choice:

- Keep deterministic logic and algorithmic helpers outside UI/state layers.

## `src/types/`

Role: shared contracts.

Design choice:

- Strong central type contracts enforce cross-layer compatibility (providers, graph, plugin data, shared message structures).

## End-to-End Flows

### A) Plugin Startup Flow

1. `main.ts` loads data store and sets plugin singleton references.
2. Skills service initializes and discovers skills.
3. Vector store initialization starts in background.
4. Views/commands/extensions are registered.
5. Agent manager initializes providers + agent + tools.
6. Chat messenger and pending changes store are created.

Decision impact:

- Heavy work is split to reduce startup latency while preserving eventual readiness.

### B) Chat Query Flow

1. UI sends message through messenger in `chatStore`.
2. `AgentManager` ensures agent readiness and deferred setup completion.
3. Active model is resolved/selected via provider registry.
4. Agent streams token and tool events.
5. Checkpoints are persisted via `ObsidianChatManager`.
6. UI updates timeline/tool sections progressively.

Decision impact:

- Streaming UX stays responsive while preserving replayable checkpoint state.

### C) Branching (Edit / Regenerate) Flow

1. User chooses edit or regenerate from a prior checkpoint context.
2. Store computes parent/fork checkpoint references.
3. Agent runs from checkpoint with or without new human message.
4. New branch path is persisted and becomes active.

Decision impact:

- Conversation history is modeled as a tree, not a flat list, enabling transparent alternative reasoning paths.

### D) Retrieval Flow

1. Query invokes `search_notes` tool.
2. Lexical and vector retrieval are computed.
3. Scores are fused/ranked and returned as candidate notes.
4. `read_content` optionally fetches deep content from selected notes/files.

Decision impact:

- Better robustness across exact-match and conceptual queries.

### E) Smart Graph Flow (High-Level)

1. Graph data built from notes/links and optional embedding-space relationships.
2. Projection/clustering can run with worker offloading.
3. Canvas-based rendering handles interaction (selection, hover, pinning, context actions).
4. Selection can be transferred into chat as structured note context.

Decision impact:

- Graph remains interactive on larger vaults through worker and canvas-centric rendering.

## Data and Persistence Model

### Data stores and files

- Plugin settings and metadata -> plugin data JSON
- Chat threads/checkpoints -> `.chat` files (NDJSON records)
- Thread index -> plugin data `threads.json`
- Vector index snapshots -> plugin data files + IndexedDB/runtime index state
- Skill definitions -> vault config `skills/` directory

Core decision:

- Persist user-relevant artifacts in vault/plugin-managed files instead of opaque external storage.

## Key Architectural Decisions and Rationale

1. Obsidian-native persistence over remote backend

- Prioritizes privacy and offline-capable operation.

2. Provider abstraction + runtime registry

- Supports multiple vendors and endpoint styles without rewriting agent logic.

3. Separation of orchestration and execution (`AgentManager` vs `Agent`)

- Keeps host-policy concerns independent from core agent execution mechanics.

4. Checkpoint-based chat state

- Enables branching workflows (edit/regenerate) and stable history reconstruction.

5. Hybrid retrieval and multi-index strategy

- Improves answer quality and resilience while enabling different embedding models per use case.

6. Staged note mutation pipeline

- Reduces risk of destructive AI writes and supports review-centric UX.

7. Deferred capability resolution and background initialization

- Improves startup and first-paint responsiveness.

8. Worker offloading for computational graph tasks

- Keeps UI fluid during clustering/projection heavy operations.

## Security and Privacy Posture

Current posture:

- Strong local-first behavior for vault data and indexing.
- Provider trust is explicit in configuration.
- Secrets are not stored inline in plain provider config objects.
- Write operations are staged for user review.

Residual risks/trade-offs:

- Any enabled remote provider still receives prompt/tool payloads by design.
- Capability and metadata calls to model catalogs can reveal model usage patterns.

## Performance and Scalability Characteristics

Strengths:

- Background vector initialization and re-indexing.
- Streaming response path with incremental UI rendering.
- Worker delegation for graph computation.
- Debounced or event-driven updates in several hot paths.

Known bottlenecks to monitor:

- Large vault indexing/re-indexing cycles.
- Multi-branch checkpoint graph growth in very long sessions.
- High-frequency provider capability checks without cache warming.

## Observability and Diagnostics

- Logging utility used across services for runtime diagnostics.
- Optional LangSmith telemetry integration for agent tracing.
- Rich chat timeline state captures tool call sequence and outputs.

Design decision:

- Keep observability optional and non-blocking to preserve local-first UX and privacy expectations.

## Change Guidance for Contributors

When extending this architecture:

1. Preserve layer boundaries

- Host integration in views/main, orchestration in services, rendering in components.

2. Prefer capability-driven behavior over provider hard-coding

- Especially for multimodal and model-specific features.

3. Keep write actions reviewable

- Maintain staged mutation semantics.

4. Treat checkpoint graph as the source of conversational truth

- Avoid shortcuts that bypass persistence model.

5. Offload expensive compute paths

- Use workers/background jobs when operations can exceed UI-frame budgets.

## Open Architectural Opportunities

1. Formal architecture decision records (ADRs)

- Capture future major decisions with explicit alternatives/trade-offs.

2. Unified event bus for cross-feature telemetry and UI synchronization

- Could reduce direct coupling between stores and components.

3. Retrieval policy profiles

- Different retrieval/fusion policies per agent persona or task type.

4. Explicit data retention controls for chat/vector artifacts

- Useful for enterprise or compliance-oriented workflows.

## Summary

Smart2Brain uses a layered, local-first architecture that combines:

- Obsidian-native persistence and UI integration
- Provider-agnostic AI orchestration
- Hybrid retrieval and graph-assisted knowledge exploration
- Safety-oriented staged editing workflows

The core design pattern is pragmatic separation: each subsystem owns one concern deeply, and integration happens through explicit typed boundaries rather than implicit side effects.
