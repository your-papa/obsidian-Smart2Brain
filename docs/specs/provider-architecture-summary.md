# Provider Architecture Refactor - Quick Summary

> See [provider-architecture-refactor.md](./provider-architecture-refactor.md) for the full specification.

## TL;DR

**Goal**: One file per provider containing ALL configuration (UI + runtime).

**Before**: 6+ files to add a provider  
**After**: 1 file to add a provider + 1 import

## New Directory Structure

```
src/providers/
├── index.ts              # Registry + exports
├── types.ts              # All types
├── errors.ts             # Error classes
├── helpers.ts            # Utilities
├── base/
│   └── openaiCompatible.ts   # Shared OpenAI-compatible logic
├── builtin/
│   ├── openai.ts         # OpenAI
│   ├── anthropic.ts      # Anthropic
│   ├── ollama.ts         # Ollama
│   └── sapAiCore.ts      # SAP AI Core
└── custom/
    └── openaiCompatible.ts   # Custom provider factory
```

## Class Hierarchy

```
BaseProviderDefinition (all providers implement this)
       │
       ├── BuiltInProviderDefinition (isBuiltIn: true)
       │      └── discoverModels?()
       │
       └── CustomProviderDefinition (isBuiltIn: false)
              └── baseProviderId, createdAt
```

## Core Interfaces

### Provider Definition
```typescript
interface BaseProviderDefinition {
  id: string;
  displayName: string;
  
  // REQUIRED: Setup instructions for users
  setupInstructions: { steps: string[]; link?: { url, text } };
  
  // Auth configuration (field-based OR oauth)
  auth: AuthMethod;
  
  // Capabilities
  capabilities: { chat: boolean; embedding: boolean; modelDiscovery: boolean };
  
  // LangChain factories
  createChatModel(modelId, auth, options?): Promise<BaseChatModel>;
  createEmbeddingModel(modelId, auth, options?): Promise<EmbeddingsInterface>;
  
  // Validation
  validateAuth(auth): Promise<AuthValidationResult>;
  
  // Optional: discover models from API
  discoverModels?(auth): Promise<{ chat: string[]; embedding: string[] }>;
}
```

> **Note: Providers are stateless.** Provider definitions contain no model configuration
> (no `defaultGenModels`, `defaultEmbedModels`, or similar). They only define:
> - How to authenticate
> - How to create LangChain model instances
> - How to discover available models (optional)
>
> All model configuration (which models are enabled, temperature, context window, etc.)
> is stored in `data.json` via `PluginDataStore`.

### Model Configs (stored in data.json)
```typescript
// Chat model config - passed to LangChain
interface ChatModelConfig {
  temperature?: number;    // Optional (reasoning models don't support it)
  contextWindow: number;   // Required (for LangChain trimMessages)
}

// Embedding model config - used by our retrieval logic
interface EmbedModelConfig {
  similarityThreshold: number;
}
```

### Auth Method
```typescript
interface FieldBasedAuth {
  type: "field-based";
  fields: Record<string, AuthFieldDefinition>;
}

interface OAuthAuth {
  type: "oauth";
  buttonLabel: string;
  startFlow(): Promise<OAuthTokens>;
  refreshTokens?(tokens): Promise<OAuthTokens | null>;
}
```

## Adding a New Built-in Provider

1. Create `src/providers/builtin/newprovider.ts`:
```typescript
export const newProvider: ProviderDefinition = {
  id: "newprovider",
  displayName: "New Provider",
  // ... fill in all fields
};
```

2. Register in `src/providers/index.ts`:
```typescript
import { newProvider } from "./builtin/newprovider";

export const builtInProviders = {
  // ...existing
  newprovider: newProvider,
};
```

Done! The UI automatically picks it up.

## Custom Providers

Users can create OpenAI-compatible providers with:
- Custom name
- Custom base URL
- Their own API key

Stored in `data.json` alongside plugin settings.

## Files to Delete After Migration

- `src/types/providers.ts`
- `src/agent/providers/` (entire directory)

## Key Benefits

1. Single source of truth per provider
2. Type-safe - TypeScript enforces completeness
3. Self-documenting - everything in one place
4. Easy testing - isolated provider logic
5. Supports user-created custom providers
