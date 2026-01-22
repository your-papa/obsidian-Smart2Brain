# Provider Architecture Refactor - Ralph Loop Plan

> **Goal**: Unified provider system with TDD  
> **Spec**: [docs/specs/provider-architecture-refactor.md](./docs/specs/provider-architecture-refactor.md)

**Key principle**: Providers are stateless. Model configuration (genModels, embedModels) lives only in data.json/PluginDataStore, NOT in provider definitions.

Each task is a complete unit of work: write tests AND implementation, then verify.

---

## Phase 1: Core Types (COMPLETE)

- [x] Model config types (ChatModelConfig, EmbedModelConfig) with tests
- [x] Auth field types (AuthFieldDefinition, FieldBasedAuth, OAuthTokens, OAuthAuth, AuthMethod) with tests
- [x] Provider definition types (ProviderCapabilities, ProviderSetupInstructions, AuthValidationResult, DiscoveredModels) with tests
- [x] Runtime types (StoredAuthState, RuntimeAuthState, RuntimeProviderDefinition) with tests
- [x] Base provider types (BaseProviderDefinition, BuiltInProviderDefinition) with tests
- [x] Complete types: Add CustomProviderDefinition and ProviderDefinition union type with tests, run `bun test` and `bun run check`

---

## Phase 2: Error Classes

- [x] Create `src/providers/errors.ts` with ProviderAuthError, ProviderEndpointError, ModelNotFoundError classes and tests in `src/providers/__tests__/errors.test.ts`. Run `bun test` and `bun run check`

---

## Phase 3: Helper Functions (COMPLETE)

- [x] Create `src/providers/helpers.ts` with validateCustomProviderId function (rejects empty, spaces, uppercase, duplicates; accepts valid lowercase-dash IDs) and tests in `src/providers/__tests__/helpers.test.ts`
- [x] Add parseHeadersJson function (handles valid JSON, invalid JSON, empty string) with tests. Run `bun test` and `bun run check`

---

## Phase 4: Provider Registry (COMPLETE)

- [x] Create `src/providers/index.ts` with getBuiltInProvider, isBuiltInProvider, getProvider, listAllProviderIds functions and tests in `src/providers/__tests__/registry.test.ts`. Run `bun test` and `bun run check`

---

## Phase 5: OpenAI-Compatible Base Runtime

- [x] Create `src/providers/base/openaiCompatible.ts` with createOpenAIChatModel factory (handles temperature, baseUrl) and tests. Mock @langchain/openai ChatOpenAI
- [x] Add createOpenAIEmbeddingModel factory with tests. Mock OpenAIEmbeddings
- [x] Add discoverOpenAIModels function (fetches models, handles 401, separates chat/embedding) with tests. Mock fetch
- [x] Add validateOpenAIAuth function with tests. Create barrel export at `src/providers/base/index.ts`. Run `bun test` and `bun run check`

---

## Phase 6: Anthropic Base Runtime (COMPLETE)

- [x] Create `src/providers/base/anthropicRuntime.ts` with createAnthropicChatModel and validateAnthropicAuth functions. Mock @langchain/anthropic ChatAnthropic. Add tests and update barrel export. Run `bun test` and `bun run check`

---

## Phase 7: Ollama Base Runtime (COMPLETE)

- [x] Create `src/providers/base/ollamaRuntime.ts` with createOllamaChatModel (handles contextWindow as numCtx, no apiKey), createOllamaEmbeddingModel, discoverOllamaModels, validateOllamaConnection. Mock @langchain/ollama. Add tests and update barrel export. Run `bun test` and `bun run check`

---

## Phase 8: OpenAI Provider Definition (COMPLETE)

- [x] Create `src/providers/builtin/openai.ts` with complete openaiProvider definition: id, displayName, isBuiltIn, setupInstructions, auth config (apiKey, baseUrl, headers), capabilities (chat, embedding, modelDiscovery all true), createRuntimeDefinition, validateAuth, discoverModels. Add comprehensive tests. Run `bun test` and `bun run check`

---

## Phase 9: Anthropic Provider Definition (COMPLETE)

- [x] Create `src/providers/builtin/anthropic.ts` with complete anthropicProvider: id, displayName, isBuiltIn, setupInstructions, auth (apiKey only), capabilities (chat true, embedding false, modelDiscovery false), createRuntimeDefinition, validateAuth. Add tests. Run `bun test` and `bun run check`

---

## Phase 10: Ollama Provider Definition (COMPLETE)

- [x] Create `src/providers/builtin/ollama.ts` with complete ollamaProvider: id, displayName, isBuiltIn, setupInstructions, auth (baseUrl only, default localhost), capabilities (all true), createRuntimeDefinition, validateAuth, discoverModels. Add tests. Run `bun test` and `bun run check`

---

## Phase 11: SAP AI Core Provider Definition (COMPLETE)

- [x] Create `src/providers/builtin/sapAiCore.ts` with complete sapAiCoreProvider: SAP-specific auth fields, capabilities, models, runtime methods. Add tests. Run `bun test` and `bun run check`

---

## Phase 12: Built-in Provider Index & Custom Provider Factory (COMPLETE)

- [x] Create `src/providers/builtin/index.ts` barrel export with builtInProviders record
- [x] Create `src/providers/custom/openaiCompatible.ts` with createCustomOpenAICompatibleProvider factory (sets isBuiltIn false, baseProviderId, createdAt). Add tests. Create `src/providers/custom/index.ts`. Run `bun test` and `bun run check`

---

## Phase 13: Wire Up Registry (COMPLETE)

- [x] Update `src/providers/index.ts` to import all built-in providers, wire up getBuiltInProvider/isBuiltInProvider to use builtInProviders record, export custom provider factory. Run `bun test` and `bun run check`

---

## Phase 14: AgentManager Integration (COMPLETE)

- [x] Update `src/agent/AgentManager.ts`: replace switch statement in configureProviderOnRegistry with registry lookup, update testProviderConfig to use provider.validateAuth, update getAvailableModels for custom providers. Add/update tests. Run `bun test` and `bun run check`

---

## Phase 15: DataStore Integration

- [x] Update `src/stores/dataStore.svelte.ts`: import new types, update StoredProviderState, update DEFAULT_SETTINGS, update provider methods (getConfiguredProviders, getStoredProviderAuthParams, getResolvedProviderAuth). Run `bun run check`
- [x] Add custom provider CRUD methods (addCustomProvider, updateCustomProvider, deleteCustomProvider, getCustomProviders) and migration function for old format. Add tests. Run `bun test` and `bun run check`

---

## Phase 16: Settings UI Updates

- [x] Update `src/views/settings/ProvidersSettings.svelte`: use listAllProviderIds, update sortedProviders and provider type handling. Run `bun run check`
- [x] Update `src/components/settings/ProviderItem.svelte`: use getProvider for setupInstructions, update props to use provider id string, update auth status handling. Run `bun run check`
- [x] Update `src/components/settings/AuthConfigFields.svelte`: use provider.auth.fields for dynamic field rendering, handle secret/text/textarea kinds, update storage keys. Run `bun run check`

---

## Phase 17: Query Functions & Cleanup

- [x] Update query functions (createProviderStateQuery, createAuthStateQuery, createModelListQuery, invalidation functions) to use new types. Run `bun run check`
- [x] Cleanup: verify no imports from old files remain, delete `src/types/providers.ts` and unused files in `src/agent/providers/`, remove unused imports. Run `bun run lint`, `bun run format`, `bun test`, `bun run check`

---

## Phase 18: Final Verification

- [x] Run full test suite and verify: all tests pass, no type errors, no lint errors
- [ ] Manual verification: OpenAI/Anthropic/Ollama providers configurable in settings, auth validation works, model discovery works, chat works

---

## Completion

When ALL tasks above are checked `[x]`, update status.md to `done`.
