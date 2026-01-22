# Provider Architecture Refactor - Task Tracker

> **Status**: In Progress  
> **Spec**: [specs/provider-architecture-refactor.md](./specs/provider-architecture-refactor.md)  
> **Summary**: [specs/provider-architecture-summary.md](./specs/provider-architecture-summary.md)

## Overview

This document tracks the progress of refactoring the provider architecture to unify UI configuration and agent runtime into single-file provider modules.

**Goal**: One file per provider containing ALL configuration. Adding a new provider = 1 file + 1 import.

---

## TDD Approach

Each phase follows Test-Driven Development:
1. **Write tests first** - Define expected behavior before implementation
2. **Tests must fail** - Verify tests fail before implementation exists
3. **Implement minimally** - Write just enough code to pass tests
4. **Refactor** - Clean up while keeping tests green

### Test Structure

```
src/
├── __tests__/           # Test files
│   ├── setup.ts         # Global test setup
│   └── setup.test.ts    # Verify test infra works
├── __mocks__/           # Mocks
│   └── obsidian.ts      # Obsidian API mock (when needed)
└── providers/
    └── __tests__/       # Provider-specific tests (to be created)
```

### Running Tests

```bash
bun test              # Run all tests once
bun test:watch        # Watch mode (re-run on changes)
bun test:coverage     # Generate coverage report
```

### Testing Strategy

- **Unit tests only** - All external APIs (OpenAI, Anthropic, Ollama) are mocked
- **No integration tests** - No real API calls, no API keys needed
- **Obsidian mock on-demand** - Provider code has no Obsidian dependency, so no mock needed
- **LangChain mocking** - Mock LangChain classes where needed for isolation

---

## Task Status Legend

| Status | Meaning |
|--------|---------|
| `[ ]` TO DO | Not started |
| `[~]` IN PROGRESS | Currently being worked on |
| `[x]` DONE | Completed and verified |
| `[-]` BLOCKED | Waiting on dependency |
| `[!]` NEEDS REVIEW | Completed, awaiting review |

---

## Phase 0: Testing Infrastructure

Set up Vitest for unit testing.

| Status | Task | Notes |
|--------|------|-------|
| `[x]` | Install Vitest and dependencies | `vitest`, `@vitest/coverage-v8`, `jsdom` |
| `[x]` | Create `vitest.config.ts` | Configure for TypeScript, jsdom, coverage |
| `[x]` | Add test scripts to `package.json` | `test`, `test:watch`, `test:coverage` |
| `[x]` | Create `src/__tests__/` directory | Test file location |
| `[x]` | Create `src/__mocks__/obsidian.ts` | Mock for Obsidian API (when needed) |
| `[x]` | Create setup test | Verify test infrastructure works |

**Done when**: `bun test` executes successfully

**Completed**: 2026-01-22

---

## Phase 1: Core Types & Infrastructure

Create the foundational types and utilities for the new provider system.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Create `src/providers/types.ts` | `types.test.ts` | All shared types |
| `[ ]` | Create auth types | `types.test.ts` | `AuthMethod`, `FieldBasedAuth`, `OAuthAuth` |
| `[ ]` | Create model config types | `types.test.ts` | `ChatModelConfig`, `EmbedModelConfig` |
| `[ ]` | Create `src/providers/errors.ts` | `errors.test.ts` | Provider-specific errors |
| `[ ]` | Create `src/providers/helpers.ts` | `helpers.test.ts` | Utility functions |
| `[ ]` | Create `src/providers/index.ts` | `registry.test.ts` | Provider registry |

### Test Specifications: `types.test.ts`

```typescript
describe('ChatModelConfig', () => {
  it('should allow temperature to be undefined', () => {
    const config: ChatModelConfig = { contextWindow: 128000 };
    expect(config.temperature).toBeUndefined();
  });

  it('should require contextWindow', () => {
    // TypeScript compilation test - this should fail to compile:
    // const config: ChatModelConfig = {}; // Error: missing contextWindow
  });

  it('should accept valid temperature values', () => {
    const config: ChatModelConfig = { temperature: 0.7, contextWindow: 128000 };
    expect(config.temperature).toBe(0.7);
  });
});

describe('EmbedModelConfig', () => {
  it('should require similarityThreshold', () => {
    const config: EmbedModelConfig = { similarityThreshold: 0.5 };
    expect(config.similarityThreshold).toBe(0.5);
  });
});

describe('FieldBasedAuth', () => {
  it('should have type "field-based"', () => {
    const auth: FieldBasedAuth = {
      type: 'field-based',
      fields: {
        apiKey: { label: 'API Key', kind: 'secret', primary: true, required: true }
      }
    };
    expect(auth.type).toBe('field-based');
  });

  it('should require at least one field marked as primary', () => {
    // Validation test - implementation should enforce this
  });
});

describe('OAuthAuth', () => {
  it('should have type "oauth"', () => {
    const auth: OAuthAuth = {
      type: 'oauth',
      buttonLabel: 'Sign in',
      startFlow: async () => ({ accessToken: 'token' })
    };
    expect(auth.type).toBe('oauth');
  });
});

describe('AuthMethod discriminated union', () => {
  it('should narrow type based on type field', () => {
    const auth: AuthMethod = { type: 'field-based', fields: {} };
    if (auth.type === 'field-based') {
      expect(auth.fields).toBeDefined();
    }
  });
});
```

### Test Specifications: `registry.test.ts`

```typescript
describe('Provider Registry', () => {
  describe('getBuiltInProvider', () => {
    it('should return OpenAI provider for "openai" id', () => {
      const provider = getBuiltInProvider('openai');
      expect(provider.id).toBe('openai');
      expect(provider.displayName).toBe('OpenAI');
    });

    it('should return Anthropic provider for "anthropic" id', () => {
      const provider = getBuiltInProvider('anthropic');
      expect(provider.id).toBe('anthropic');
    });

    it('should return Ollama provider for "ollama" id', () => {
      const provider = getBuiltInProvider('ollama');
      expect(provider.id).toBe('ollama');
    });
  });

  describe('isBuiltInProvider', () => {
    it('should return true for built-in provider IDs', () => {
      expect(isBuiltInProvider('openai')).toBe(true);
      expect(isBuiltInProvider('anthropic')).toBe(true);
      expect(isBuiltInProvider('ollama')).toBe(true);
    });

    it('should return false for unknown provider IDs', () => {
      expect(isBuiltInProvider('unknown')).toBe(false);
      expect(isBuiltInProvider('custom-provider')).toBe(false);
    });
  });

  describe('getProvider', () => {
    it('should return built-in provider when no custom providers', () => {
      const provider = getProvider('openai', []);
      expect(provider?.id).toBe('openai');
    });

    it('should return custom provider when it exists', () => {
      const customProviders = [{
        id: 'my-custom',
        displayName: 'My Custom',
        baseProviderId: 'openai-compatible',
        auth: {},
        genModels: {},
        embedModels: {},
        createdAt: Date.now()
      }];
      const provider = getProvider('my-custom', customProviders);
      expect(provider?.id).toBe('my-custom');
    });

    it('should return undefined for unknown provider', () => {
      const provider = getProvider('unknown', []);
      expect(provider).toBeUndefined();
    });
  });

  describe('listAllProviderIds', () => {
    it('should include all built-in provider IDs', () => {
      const ids = listAllProviderIds([]);
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('ollama');
      expect(ids).toContain('sap-ai-core');
    });

    it('should include custom provider IDs', () => {
      const customProviders = [{ id: 'custom-1' }, { id: 'custom-2' }];
      const ids = listAllProviderIds(customProviders as any);
      expect(ids).toContain('custom-1');
      expect(ids).toContain('custom-2');
    });
  });
});
```

### Test Specifications: `errors.test.ts`

```typescript
describe('ProviderAuthError', () => {
  it('should contain provider name and status code', () => {
    const error = new ProviderAuthError('openai', 401, 'invalid_api_key', 'Invalid API key');
    expect(error.provider).toBe('openai');
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('invalid_api_key');
    expect(error.message).toContain('Invalid API key');
  });
});

describe('ProviderEndpointError', () => {
  it('should contain provider name and endpoint message', () => {
    const error = new ProviderEndpointError('ollama', 'Connection refused');
    expect(error.provider).toBe('ollama');
    expect(error.message).toContain('Connection refused');
  });
});

describe('ModelNotFoundError', () => {
  it('should contain provider, model, and type', () => {
    const error = new ModelNotFoundError('openai', 'gpt-5', 'chat');
    expect(error.provider).toBe('openai');
    expect(error.model).toBe('gpt-5');
    expect(error.modelType).toBe('chat');
  });
});
```

**Done when**: All tests in Phase 1 pass

---

## Phase 2: Base Implementations & LangChain Integration

Create shared runtime logic for provider families.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Create `src/providers/base/openaiCompatible.ts` | `openaiCompatible.test.ts` | Chat, embedding, discovery |
| `[ ]` | Create `src/providers/base/anthropicRuntime.ts` | `anthropicRuntime.test.ts` | Chat only |
| `[ ]` | Create `src/providers/base/ollamaRuntime.ts` | `ollamaRuntime.test.ts` | Chat, embedding |
| `[ ]` | Create `src/providers/base/index.ts` | - | Barrel exports |

### Test Specifications: `openaiCompatible.test.ts`

```typescript
describe('OpenAI Compatible Runtime', () => {
  describe('createChatModel', () => {
    it('should return a BaseChatModel instance', async () => {
      const model = await createOpenAIChatModel('gpt-4o', {
        apiKey: 'test-key'
      });
      expect(model).toBeInstanceOf(BaseChatModel);
    });

    it('should pass temperature to LangChain when provided', async () => {
      const model = await createOpenAIChatModel('gpt-4o', 
        { apiKey: 'test-key' },
        { temperature: 0.5, contextWindow: 128000 }
      );
      expect(model.temperature).toBe(0.5);
    });

    it('should not set temperature when undefined', async () => {
      const model = await createOpenAIChatModel('gpt-4o',
        { apiKey: 'test-key' },
        { contextWindow: 128000 }  // no temperature
      );
      // LangChain default should be used
      expect(model.temperature).toBe(1); // LangChain default
    });

    it('should use custom baseUrl when provided', async () => {
      const model = await createOpenAIChatModel('gpt-4o', {
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com/v1'
      });
      // Verify baseUrl is set (implementation-specific check)
    });
  });

  describe('createEmbeddingModel', () => {
    it('should return an EmbeddingsInterface instance', async () => {
      const model = await createOpenAIEmbeddingModel('text-embedding-3-small', {
        apiKey: 'test-key'
      });
      expect(model).toBeDefined();
      expect(typeof model.embedQuery).toBe('function');
    });
  });

  describe('discoverModels', () => {
    it('should return chat and embedding model arrays', async () => {
      // Mock fetch for this test
      const result = await discoverOpenAIModels({ apiKey: 'test-key' });
      expect(result.chat).toBeInstanceOf(Array);
      expect(result.embedding).toBeInstanceOf(Array);
    });

    it('should throw ProviderAuthError on 401', async () => {
      // Mock fetch to return 401
      await expect(discoverOpenAIModels({ apiKey: 'invalid' }))
        .rejects.toThrow(ProviderAuthError);
    });

    it('should separate embedding models from chat models', async () => {
      // Mock response with mixed models
      const result = await discoverOpenAIModels({ apiKey: 'test-key' });
      
      // Embedding models should only be in embedding array
      result.embedding.forEach(id => {
        expect(id).toMatch(/embed/i);
      });
      
      // Chat models should not include embedding models
      result.chat.forEach(id => {
        expect(id).not.toMatch(/embed/i);
      });
    });
  });
});
```

### Test Specifications: `ollamaRuntime.test.ts`

```typescript
describe('Ollama Runtime', () => {
  describe('createChatModel', () => {
    it('should create ChatOllama instance', async () => {
      const model = await createOllamaChatModel('llama3.1', {
        baseUrl: 'http://localhost:11434'
      });
      expect(model).toBeInstanceOf(ChatOllama);
    });

    it('should pass numCtx (contextWindow) to Ollama', async () => {
      const model = await createOllamaChatModel('llama3.1',
        { baseUrl: 'http://localhost:11434' },
        { contextWindow: 8192 }
      );
      // Ollama uses numCtx for context window
      expect(model.numCtx).toBe(8192);
    });

    it('should not require apiKey', async () => {
      // Ollama doesn't need API key
      const model = await createOllamaChatModel('llama3.1', {
        baseUrl: 'http://localhost:11434'
        // no apiKey
      });
      expect(model).toBeDefined();
    });
  });

  describe('discoverModels', () => {
    it('should throw ProviderEndpointError when Ollama not running', async () => {
      await expect(discoverOllamaModels({ 
        baseUrl: 'http://localhost:99999' 
      })).rejects.toThrow(ProviderEndpointError);
    });
  });
});
```

**Done when**: All tests in Phase 2 pass (with mocked LangChain/fetch where needed)

---

## Phase 3: Built-in Provider Definitions

Create unified provider definition files for each built-in provider.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Create `src/providers/builtin/openai.ts` | `builtin/openai.test.ts` | Full definition |
| `[ ]` | Create `src/providers/builtin/anthropic.ts` | `builtin/anthropic.test.ts` | No embedding |
| `[ ]` | Create `src/providers/builtin/ollama.ts` | `builtin/ollama.test.ts` | No API key |
| `[ ]` | Create `src/providers/builtin/sapAiCore.ts` | `builtin/sapAiCore.test.ts` | Extended auth |
| `[ ]` | Create `src/providers/builtin/index.ts` | - | Barrel exports |

### Test Specifications: `builtin/openai.test.ts`

```typescript
describe('OpenAI Provider Definition', () => {
  describe('identity', () => {
    it('should have id "openai"', () => {
      expect(openaiProvider.id).toBe('openai');
    });

    it('should have displayName "OpenAI"', () => {
      expect(openaiProvider.displayName).toBe('OpenAI');
    });

    it('should be marked as built-in', () => {
      expect(openaiProvider.isBuiltIn).toBe(true);
    });
  });

  describe('setupInstructions', () => {
    it('should have steps array with at least 1 step', () => {
      expect(openaiProvider.setupInstructions.steps.length).toBeGreaterThan(0);
    });

    it('should have link to OpenAI dashboard', () => {
      expect(openaiProvider.setupInstructions.link?.url).toContain('openai.com');
    });
  });

  describe('auth', () => {
    it('should be field-based auth', () => {
      expect(openaiProvider.auth.type).toBe('field-based');
    });

    it('should have apiKey as primary required field', () => {
      const auth = openaiProvider.auth as FieldBasedAuth;
      expect(auth.fields.apiKey).toBeDefined();
      expect(auth.fields.apiKey.primary).toBe(true);
      expect(auth.fields.apiKey.required).toBe(true);
      expect(auth.fields.apiKey.kind).toBe('secret');
    });

    it('should have baseUrl as non-primary optional field', () => {
      const auth = openaiProvider.auth as FieldBasedAuth;
      expect(auth.fields.baseUrl).toBeDefined();
      expect(auth.fields.baseUrl.primary).toBe(false);
      expect(auth.fields.baseUrl.required).toBe(false);
    });

    it('should have headers as non-primary optional field', () => {
      const auth = openaiProvider.auth as FieldBasedAuth;
      expect(auth.fields.headers).toBeDefined();
      expect(auth.fields.headers.primary).toBe(false);
      expect(auth.fields.headers.kind).toBe('textarea');
    });
  });

  describe('capabilities', () => {
    it('should support chat', () => {
      expect(openaiProvider.capabilities.chat).toBe(true);
    });

    it('should support embedding', () => {
      expect(openaiProvider.capabilities.embedding).toBe(true);
    });

    it('should support model discovery', () => {
      expect(openaiProvider.capabilities.modelDiscovery).toBe(true);
    });
  });

  describe('validateAuth', () => {
    it('should reject when apiKey is missing', async () => {
      const result = await openaiProvider.validateAuth({
        type: 'field-based',
        values: {}
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('API key');
    });

    it('should validate apiKey format', async () => {
      const result = await openaiProvider.validateAuth({
        type: 'field-based',
        values: { apiKey: 'not-a-valid-key' }
      });
      // Should attempt to validate with API
    });
  });
});
```

### Test Specifications: `builtin/ollama.test.ts`

```typescript
describe('Ollama Provider Definition', () => {
  describe('auth', () => {
    it('should have baseUrl as primary required field', () => {
      const auth = ollamaProvider.auth as FieldBasedAuth;
      expect(auth.fields.baseUrl).toBeDefined();
      expect(auth.fields.baseUrl.primary).toBe(true);
      expect(auth.fields.baseUrl.required).toBe(true);
    });

    it('should NOT have apiKey field', () => {
      const auth = ollamaProvider.auth as FieldBasedAuth;
      expect(auth.fields.apiKey).toBeUndefined();
    });

    it('should have default baseUrl value', () => {
      const auth = ollamaProvider.auth as FieldBasedAuth;
      expect(auth.fields.baseUrl.defaultValue).toBe('http://localhost:11434');
    });
  });

  describe('capabilities', () => {
    it('should support chat', () => {
      expect(ollamaProvider.capabilities.chat).toBe(true);
    });

    it('should support embedding', () => {
      expect(ollamaProvider.capabilities.embedding).toBe(true);
    });
  });
});
```

### Test Specifications: `builtin/anthropic.test.ts`

```typescript
describe('Anthropic Provider Definition', () => {
  describe('capabilities', () => {
    it('should support chat', () => {
      expect(anthropicProvider.capabilities.chat).toBe(true);
    });

    it('should NOT support embedding', () => {
      expect(anthropicProvider.capabilities.embedding).toBe(false);
    });
  });
});
```

**Done when**: All provider definition tests pass

---

## Phase 4: Custom Provider Support

Enable users to create OpenAI-compatible providers.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Create `src/providers/custom/openaiCompatible.ts` | `custom/openaiCompatible.test.ts` | Factory, validation |
| `[ ]` | Create `src/providers/custom/index.ts` | - | Barrel exports |

### Test Specifications: `custom/openaiCompatible.test.ts`

```typescript
describe('Custom OpenAI-Compatible Provider', () => {
  describe('createCustomOpenAICompatibleProvider', () => {
    it('should create provider with user-defined id', () => {
      const provider = createCustomOpenAICompatibleProvider({
        id: 'my-llm',
        displayName: 'My LLM',
        baseProviderId: 'openai-compatible',
        auth: { baseUrl: 'https://my-llm.com/v1' },
        genModels: {},
        embedModels: {},
        createdAt: Date.now()
      });
      expect(provider.id).toBe('my-llm');
      expect(provider.displayName).toBe('My LLM');
    });

    it('should mark as not built-in', () => {
      const provider = createCustomOpenAICompatibleProvider({
        id: 'custom',
        displayName: 'Custom',
        baseProviderId: 'openai-compatible',
        auth: {},
        genModels: {},
        embedModels: {},
        createdAt: Date.now()
      });
      expect(provider.isBuiltIn).toBe(false);
    });

    it('should use OpenAI-compatible runtime', async () => {
      const provider = createCustomOpenAICompatibleProvider({
        id: 'custom',
        displayName: 'Custom',
        baseProviderId: 'openai-compatible',
        auth: { baseUrl: 'https://api.example.com/v1' },
        genModels: {},
        embedModels: {},
        createdAt: Date.now()
      });
      // Should be able to create chat model
      expect(provider.createChatModel).toBeDefined();
    });
  });

  describe('validateCustomProviderId', () => {
    it('should reject empty id', () => {
      const result = validateCustomProviderId('', []);
      expect(result.valid).toBe(false);
    });

    it('should reject id with spaces', () => {
      const result = validateCustomProviderId('my provider', []);
      expect(result.valid).toBe(false);
    });

    it('should reject id with uppercase', () => {
      const result = validateCustomProviderId('MyProvider', []);
      expect(result.valid).toBe(false);
    });

    it('should reject duplicate id', () => {
      const result = validateCustomProviderId('existing', ['existing']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should accept valid lowercase-dash id', () => {
      const result = validateCustomProviderId('my-custom-provider', []);
      expect(result.valid).toBe(true);
    });
  });
});
```

**Done when**: All custom provider tests pass

---

## Phase 5: Data Store Integration

Update the plugin data store to use new provider types.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Update stored types | `dataStore.test.ts` | `StoredProvidersConfig` |
| `[ ]` | Update `DEFAULT_SETTINGS` | `dataStore.test.ts` | Generate from registry |
| `[ ]` | Add provider CRUD methods | `dataStore.test.ts` | Add, update, delete |
| `[ ]` | Handle serialization | `dataStore.test.ts` | Map ↔ Object |

### Test Specifications: `dataStore.test.ts`

```typescript
describe('Provider Data Store', () => {
  describe('StoredProvidersConfig', () => {
    it('should have builtIn providers keyed by id', () => {
      const config: StoredProvidersConfig = createDefaultProvidersConfig();
      expect(config.builtIn.openai).toBeDefined();
      expect(config.builtIn.anthropic).toBeDefined();
    });

    it('should have empty custom array by default', () => {
      const config = createDefaultProvidersConfig();
      expect(config.custom).toEqual([]);
    });
  });

  describe('ChatModelConfig storage', () => {
    it('should store temperature as optional', () => {
      const stored: ChatModelConfig = { contextWindow: 128000 };
      expect(stored.temperature).toBeUndefined();
    });

    it('should preserve temperature when set', () => {
      const stored: ChatModelConfig = { temperature: 0.7, contextWindow: 128000 };
      expect(stored.temperature).toBe(0.7);
    });
  });

  describe('Custom provider CRUD', () => {
    it('should add custom provider', () => {
      const store = createDataStore();
      store.addCustomProvider({
        id: 'my-llm',
        displayName: 'My LLM',
        baseProviderId: 'openai-compatible',
        auth: {},
        genModels: {},
        embedModels: {},
        createdAt: Date.now()
      });
      expect(store.getCustomProviders()).toHaveLength(1);
    });

    it('should update custom provider', () => {
      const store = createDataStore();
      store.addCustomProvider({ id: 'my-llm', displayName: 'Old Name', ... });
      store.updateCustomProvider('my-llm', { displayName: 'New Name' });
      expect(store.getCustomProvider('my-llm')?.displayName).toBe('New Name');
    });

    it('should delete custom provider', () => {
      const store = createDataStore();
      store.addCustomProvider({ id: 'my-llm', ... });
      store.deleteCustomProvider('my-llm');
      expect(store.getCustomProviders()).toHaveLength(0);
    });
  });
});
```

**Done when**: All data store tests pass

---

## Phase 6: AgentManager Integration

Update the agent manager to use the new provider registry.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Remove switch statement | `agentManager.test.ts` | Use registry |
| `[ ]` | Update `testProviderConfig` | `agentManager.test.ts` | Use `validateAuth` |
| `[ ]` | Support custom providers | `agentManager.test.ts` | In model listing |

### Test Specifications: `agentManager.test.ts`

```typescript
describe('AgentManager Provider Integration', () => {
  describe('configureProvider', () => {
    it('should configure OpenAI provider from registry', async () => {
      const manager = createAgentManager();
      await manager.configureProvider('openai', { apiKey: 'test' });
      expect(manager.hasProvider('openai')).toBe(true);
    });

    it('should configure custom provider from registry', async () => {
      const manager = createAgentManager();
      manager.registerCustomProvider({ id: 'my-llm', ... });
      await manager.configureProvider('my-llm', { apiKey: 'test', baseUrl: '...' });
      expect(manager.hasProvider('my-llm')).toBe(true);
    });

    it('should throw for unknown provider', async () => {
      const manager = createAgentManager();
      await expect(manager.configureProvider('unknown', {}))
        .rejects.toThrow('Unknown provider');
    });
  });

  describe('getAvailableModels', () => {
    it('should list models for built-in provider', async () => {
      const manager = createAgentManager();
      await manager.configureProvider('openai', { apiKey: 'test' });
      const models = await manager.getAvailableModels('openai');
      expect(models.chat.length).toBeGreaterThan(0);
    });

    it('should list models for custom provider', async () => {
      const manager = createAgentManager();
      manager.registerCustomProvider({ id: 'my-llm', genModels: { 'model-1': {...} }, ... });
      const models = await manager.getAvailableModels('my-llm');
      expect(models.chat).toContain('model-1');
    });
  });
});
```

**Done when**: All AgentManager tests pass

---

## Phase 7: UI Integration

Update settings UI to use new provider system.

### Tasks

| Status | Task | Test File | Notes |
|--------|------|-----------|-------|
| `[ ]` | Update `ProvidersSettings.svelte` | (Svelte component tests) | List providers |
| `[ ]` | Update `ProviderItem.svelte` | (Svelte component tests) | Dynamic fields |
| `[ ]` | Update `AuthConfigFields.svelte` | (Svelte component tests) | From fieldMeta |
| `[ ]` | Add custom provider modal | (Svelte component tests) | Create/edit |

**Done when**: UI correctly renders all providers and handles custom provider creation

---

## Phase 8: Cleanup

Remove old code and update imports.

### Tasks

| Status | Task | Verification | Notes |
|--------|------|--------------|-------|
| `[ ]` | Delete `src/types/providers.ts` | No import errors | Types moved |
| `[ ]` | Delete `src/agent/providers/` | No import errors | Logic moved |
| `[ ]` | Update imports | `tsc --noEmit` | All files |
| `[ ]` | Run linter | `npm run lint` | Clean output |

**Done when**: `npm run build` succeeds with no errors

---

## Phase 9: Integration Tests

End-to-end validation of the provider system.

### Test Specifications: `integration.test.ts`

```typescript
describe('Provider System Integration', () => {
  describe('Full provider lifecycle', () => {
    it('should configure, validate, and create model for OpenAI', async () => {
      const provider = getBuiltInProvider('openai');
      
      // Validate auth
      const authResult = await provider.validateAuth({
        type: 'field-based',
        values: { apiKey: process.env.OPENAI_API_KEY }
      });
      expect(authResult.success).toBe(true);
      
      // Create model
      const model = await provider.createChatModel('gpt-4o', 
        { apiKey: process.env.OPENAI_API_KEY },
        { contextWindow: 128000 }
      );
      expect(model).toBeDefined();
    });
  });

  describe('Custom provider lifecycle', () => {
    it('should create, store, and use custom provider', async () => {
      // Create
      const customConfig = {
        id: 'test-provider',
        displayName: 'Test Provider',
        baseProviderId: 'openai-compatible',
        auth: { baseUrl: 'https://api.example.com/v1' },
        genModels: { 'test-model': { contextWindow: 8192 } },
        embedModels: {},
        createdAt: Date.now()
      };
      
      // Store
      const store = createDataStore();
      store.addCustomProvider(customConfig);
      
      // Retrieve and use
      const provider = getProvider('test-provider', store.getCustomProviders());
      expect(provider?.id).toBe('test-provider');
    });
  });
});
```

**Done when**: All integration tests pass

---

## Open Questions

| Status | Question | Options | Decision |
|--------|----------|---------|----------|
| `[ ]` | Model sync strategy | A) Prefer discovered B) Merge with defaults C) User choice | TBD |
| `[ ]` | Provider icons | Store as SVG strings? Import assets? | TBD |
| `[ ]` | Export/import custom providers | Support JSON export? | TBD |

---

## Test Coverage Summary

When all phases are complete, the test suite should cover:

| Area | Test Count (approx) | Coverage |
|------|---------------------|----------|
| Types & Interfaces | ~15 | Type safety, discriminated unions |
| Registry | ~10 | Lookup, listing, custom providers |
| Errors | ~5 | Error classes, properties |
| OpenAI Runtime | ~10 | Model creation, discovery, auth |
| Anthropic Runtime | ~5 | Model creation, no embedding |
| Ollama Runtime | ~5 | Model creation, no apiKey |
| Provider Definitions | ~20 | All built-in providers |
| Custom Providers | ~10 | Creation, validation |
| Data Store | ~15 | CRUD, serialization |
| AgentManager | ~10 | Configuration, model listing |
| Integration | ~5 | End-to-end flows |

**Total: ~110 tests**

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-01-22 | Initial task list created | - |
| 2026-01-22 | Added TDD test specifications for all phases | - |
| 2026-01-22 | Completed Phase 0: Testing infrastructure (Vitest) | - |
