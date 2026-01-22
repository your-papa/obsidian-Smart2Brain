# Provider Architecture Refactoring Specification

> **Status**: Draft  
> **Created**: 2026-01-22  
> **Goal**: Unify provider implementations into single-file modules for easier maintenance and extension

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Goals](#goals)
3. [Architecture Overview](#architecture-overview)
4. [Authorization Architecture](#authorization-architecture)
5. [Type Definitions](#type-definitions)
6. [Directory Structure](#directory-structure)
7. [Provider Definitions](#provider-definitions)
8. [Provider Registry](#provider-registry)
9. [Custom Providers](#custom-providers)
10. [Integration Points](#integration-points)
11. [Migration Checklist](#migration-checklist)

---

## Problem Statement

The current codebase has **two separate implementations** for AI providers:

### Current UI/Configuration Layer
- **Location**: `src/types/providers.ts`, `src/stores/dataStore.svelte.ts`
- **Contains**: `RegisteredProvider` type, `providerFieldMeta`, `DEFAULT_PROVIDER_CONFIGS`
- **Purpose**: UI form rendering, default model lists, stored auth configuration

### Current Agent/Runtime Layer
- **Location**: `src/agent/providers/*.ts`
- **Contains**: `ProviderRegistry`, provider factories (openai.ts, anthropic.ts, etc.)
- **Purpose**: LangChain model instantiation, API model discovery, runtime auth

### Problems with Current Architecture

1. **Provider names hardcoded in 4+ places**:
   - `RegisteredProvider` type in `types/providers.ts`
   - `providerFieldMeta` keys in `types/providers.ts`
   - Switch statement in `AgentManager.configureProviderOnRegistry()`
   - `DEFAULT_PROVIDER_CONFIGS` in `dataStore.svelte.ts`

2. **Model lists duplicated**:
   - Static defaults in `DEFAULT_PROVIDER_CONFIGS`
   - Dynamic discovery in `openai.ts`, `anthropic.ts`, etc.
   - No synchronization between sources

3. **Auth types fragmented**:
   - `StoredProviderOptions` (persistence)
   - `BuiltInProviderOptions` (runtime)
   - `ProviderAuth` (alias)
   - Similar structures with slight variations

4. **Adding a new provider requires changes to 6+ files**

---

## Goals

1. **Single source of truth**: One file per provider containing ALL configuration
2. **Type safety**: TypeScript ensures completeness when adding providers
3. **Self-documenting**: Each provider file shows everything about that provider
4. **Easy extension**: Adding a provider = creating one file + one import
5. **Support custom providers**: Users can create OpenAI-compatible providers with custom names/endpoints

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Provider Registry                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   OpenAI    │  │  Anthropic  │  │   Ollama    │  ...         │
│  │  Provider   │  │  Provider   │  │  Provider   │              │
│  │  Definition │  │  Definition │  │  Definition │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ProviderDefinition Interface                  │
│  • id, displayName                                               │
│  • setupInstructions, auth (field definitions)                   │
│  • capabilities (chat, embedding, modelDiscovery)                │
│  • createRuntimeDefinition() → LangChain factories               │
│  • discoverModels(), validateAuth()                              │
│                                                                  │
│  NOTE: Providers are STATELESS. Model configs live in data.json  │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Consumers                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Settings UI    │  │   Data Store    │  │  AgentManager   │  │
│  │  (form fields)  │  │  (persistence)  │  │  (runtime)      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Authorization Architecture

This section defines how providers handle authentication, from UI field rendering to runtime credential resolution.

### Design Principles

1. **Strongly typed auth methods** - Each provider declares its auth requirements via TypeScript interfaces
2. **UI derived from types** - The settings UI is generated from the auth type definition
3. **Primary vs Advanced fields** - Required fields are always visible; optional fields go in "Advanced" section
4. **Mutually exclusive auth methods** - A provider uses EITHER field-based auth OR OAuth, not both
5. **Secrets stored securely** - API keys and tokens use Obsidian's SecretStorage
6. **LangChain integration preserved** - The runtime layer produces LangChain model instances

---

## LangChain Integration

The plugin uses **LangChain** to interact with AI providers. The provider system must produce LangChain-compatible model instances.

### Current Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AgentManager                             │
│                              │                                   │
│                              ▼                                   │
│                     ProviderRegistry                             │
│                              │                                   │
│              ┌───────────────┼───────────────┐                   │
│              ▼               ▼               ▼                   │
│      useOpenAI()      useAnthropic()    useOllama()             │
│              │               │               │                   │
│              ▼               ▼               ▼                   │
│   createOpenAI         createAnthropic    createOllama          │
│   ProviderDef()        ProviderDef()      ProviderDef()         │
│              │               │               │                   │
│              └───────────────┼───────────────┘                   │
│                              ▼                                   │
│                   RuntimeProviderDefinition                      │
│                   {                                              │
│                     chatModels: Record<string, ChatModelFactory> │
│                     embeddingModels: Record<string, EmbeddingModelFactory>
│                     defaultChatModel?: string                    │
│                     defaultEmbeddingModel?: string               │
│                   }                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LangChain Classes                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   ChatOpenAI    │  │  ChatAnthropic  │  │   ChatOllama    │  │
│  │   @langchain/   │  │   @langchain/   │  │   @langchain/   │  │
│  │     openai      │  │    anthropic    │  │     ollama      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐                       ┌─────────────────┐  │
│  │ OpenAIEmbeddings│                       │OllamaEmbeddings │  │
│  └─────────────────┘                       └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Model Configuration Types

Models are stored in `data.json` per provider. The provider only needs to create LangChain instances - it doesn't store model configs itself.

```typescript
// ============================================================================
// Stored Model Configuration (in data.json, per provider)
// ============================================================================

/**
 * Configuration for a chat model.
 * Stored in data.json under provider.chatModels[modelId]
 * 
 * These values are passed to LangChain when creating the model instance.
 * LangChain may ignore unsupported options (e.g., temperature on reasoning models).
 */
interface ChatModelConfig {
  /** 
   * Sampling temperature (0-2). 
   * Optional - some models (o1, o3, gpt-5) don't support temperature.
   * If not set, LangChain uses its default.
   */
  temperature?: number;
  
  /** 
   * Maximum context window in tokens. 
   * REQUIRED - used by LangChain's trimMessages() for context management.
   * Also used by our UI to show context usage.
   */
  contextWindow: number;
}

/**
 * Configuration for an embedding model.
 * Stored in data.json under provider.embedModels[modelId]
 */
interface EmbedModelConfig {
  /** 
   * Similarity threshold for retrieval (0-1).
   * Used by our retrieval logic, NOT passed to LangChain.
   */
  similarityThreshold: number;
}

// ============================================================================
// Stored Provider Models (in data.json)
// ============================================================================

/**
 * How models are stored per provider in data.json.
 * The key is the model ID (e.g., "gpt-4o", "text-embedding-3-small").
 */
interface StoredProviderModels {
  /** Chat models configured for this provider */
  chatModels: Record<string, ChatModelConfig>;
  
  /** Embedding models configured for this provider */
  embedModels: Record<string, EmbedModelConfig>;
}
```

### LangChain Integration

The provider's job is to create LangChain model instances. The stored config is passed to the factory at runtime.

```typescript
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

// ============================================================================
// Model Factory (what the provider exposes)
// ============================================================================

/**
 * Factory function that creates a LangChain chat model instance.
 * 
 * @param modelId - The model ID (e.g., "gpt-4o")
 * @param auth - Resolved authentication (apiKey, baseUrl, etc.)
 * @param options - Model options from stored config (temperature, etc.)
 * @returns LangChain BaseChatModel instance
 */
type CreateChatModel = (
  modelId: string,
  auth: RuntimeAuthState,
  options?: ChatModelConfig
) => Promise<BaseChatModel>;

/**
 * Factory function that creates a LangChain embedding model instance.
 */
type CreateEmbeddingModel = (
  modelId: string,
  auth: RuntimeAuthState,
  options?: EmbedModelConfig
) => Promise<EmbeddingsInterface>;
```

### Model Discovery

Providers that support `modelDiscovery` capability can fetch available models from their API.
Discovery returns just model IDs - the user then configures each model's settings.

```typescript
/**
 * Result of discovering models from a provider's API.
 * Returns model IDs only - config is set by user.
 */
interface DiscoveredModels {
  /** Available chat model IDs */
  chat: string[];
  /** Available embedding model IDs */
  embedding: string[];
}
```

### Key Design Decisions

1. **No `defaultChatModel` / `defaultEmbeddingModel`** - The UI manages model selection, not the provider.

2. **`temperature` is optional** - Some models (o1, o3, gpt-5 reasoning models) don't support it. We don't filter it out - we pass it to LangChain and let it handle/ignore as appropriate.

3. **`contextWindow` is required for chat models** - LangChain's `trimMessages()` needs this for context management.

4. **`similarityThreshold` is for our logic** - Not passed to LangChain, used by our retrieval system.

5. **Provider doesn't store configs** - Provider only knows how to create LangChain instances. Model configs are stored in `data.json` and passed at runtime.

6. **Providers are stateless - no default model configs** - Provider definitions do NOT include `defaultGenModels` or `defaultEmbedModels`. All model configurations live exclusively in `data.json`. This keeps providers as pure factories that only know how to create LangChain instances, while the data layer owns all user-configurable state. When a user adds a model, they configure it in the UI and it's persisted to `data.json`. Model discovery populates model IDs, and the user then sets each model's config (temperature, contextWindow, etc.).

### LangChain Packages Used

| Provider | Package | Chat Class | Embedding Class |
|----------|---------|------------|-----------------|
| OpenAI | `@langchain/openai` | `ChatOpenAI` | `OpenAIEmbeddings` |
| Anthropic | `@langchain/anthropic` | `ChatAnthropic` | (none) |
| Ollama | `@langchain/ollama` | `ChatOllama` | `OllamaEmbeddings` |

### LangChain Context Management

LangChain provides `trimMessages()` for automatic context management:

```typescript
import { trimMessages } from "@langchain/core/messages";

// Trim messages to fit within context window
const trimmedMessages = await trimMessages(messages, {
  maxTokens: modelConfig.contextWindow,  // From stored config
  tokenCounter: chatModel,                // LangChain model has getNumTokens()
  strategy: "last",                       // Keep most recent messages
  includeSystem: true,                    // Always keep system message
});
```

This is why `contextWindow` is required in `ChatModelConfig` - it's used here.

### How Auth Flows to LangChain

```
User enters API key in UI
         │
         ▼
Stored in SecretStorage (apiKeyId reference in data.json)
         │
         ▼
On agent init: resolve apiKeyId → actual apiKey
         │
         ▼
Pass to createRuntimeDefinition(auth)
         │
         ▼
Factory captures auth in closure:
  return async (options) => new ChatOpenAI({
    apiKey: auth.apiKey,        // From resolved auth
    model: modelName,
    ...options                   // Runtime overrides
  });
         │
         ▼
Registry stores factory, calls it when model requested
         │
         ▼
LangChain instance created with credentials
```

### Provider Class Hierarchy

The provider system uses a strongly-typed interface hierarchy that ensures all providers implement the required properties and methods.

```
┌─────────────────────────────────────────────────────────────────┐
│                     BaseProviderDefinition                       │
│  (All providers MUST implement this)                             │
├─────────────────────────────────────────────────────────────────┤
│  • id: string                                                    │
│  • displayName: string                                           │
│  • setupInstructions: ProviderSetupInstructions                  │
│  • auth: AuthMethod                                              │
│  • capabilities: ProviderCapabilities                            │
│  • createRuntimeDefinition(auth): Promise<RuntimeDefinition>     │
│  • validateAuth(auth): Promise<AuthValidationResult>             │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  BuiltInProvider        │     │  CustomProvider         │
│  (extends Base)         │     │  (extends Base)         │
├─────────────────────────┤     ├─────────────────────────┤
│  isBuiltIn: true        │     │  isBuiltIn: false       │
│                         │     │  baseProviderId: string │
│  discoverModels?()      │     │  createdAt: number      │
└─────────────────────────┘     └─────────────────────────┘
```

### Core Interfaces

```typescript
// ============================================================================
// Setup Instructions (Required for all providers)
// ============================================================================

/**
 * Setup instructions shown to users when configuring the provider.
 * This is REQUIRED for all providers to guide users through setup.
 */
interface ProviderSetupInstructions {
  /** 
   * Step-by-step instructions for setting up this provider.
   * Each string is rendered as a list item.
   */
  steps: string[];
  
  /**
   * Optional link to the provider's dashboard or documentation.
   */
  link?: {
    /** URL to the provider's dashboard/docs */
    url: string;
    /** Display text for the link */
    text: string;
  };
}

// ============================================================================
// Provider Capabilities
// ============================================================================

interface ProviderCapabilities {
  /** Whether this provider supports chat/completion models */
  chat: boolean;
  /** Whether this provider supports embedding models */
  embedding: boolean;
  /** Whether this provider can discover models via API */
  modelDiscovery: boolean;
}

// ============================================================================
// Base Provider Definition (All providers implement this)
// ============================================================================

/**
 * Base interface that ALL providers must implement.
 * This ensures type-safety and completeness when adding new providers.
 */
interface BaseProviderDefinition {
  /** Unique identifier for this provider (lowercase, no spaces) */
  id: string;
  
  /** Human-readable display name */
  displayName: string;
  
  /** 
   * Setup instructions shown to users.
   * REQUIRED - guides users through the provider setup process.
   */
  setupInstructions: ProviderSetupInstructions;
  
  /** Authentication configuration for this provider */
  auth: AuthMethod;
  
  /** What this provider supports */
  capabilities: ProviderCapabilities;
  
  /**
   * Creates the runtime provider definition with model factories.
   * Called when initializing the agent with this provider.
   */
  createRuntimeDefinition: (auth: RuntimeAuthState) => Promise<RuntimeProviderDefinition>;
  
  /**
   * Validates the authentication configuration.
   * REQUIRED - used to test credentials before saving.
   */
  validateAuth: (auth: RuntimeAuthState) => Promise<AuthValidationResult>;
}

/**
 * Built-in provider (shipped with the plugin).
 */
interface BuiltInProviderDefinition extends BaseProviderDefinition {
  /** Always true for built-in providers */
  isBuiltIn: true;
  
  /**
   * Discovers available models from the provider's API.
   * Optional - only for providers that support model discovery.
   */
  discoverModels?: (auth: RuntimeAuthState) => Promise<DiscoveredModels>;
}

/**
 * Custom provider (created by the user).
 */
interface CustomProviderDefinition extends BaseProviderDefinition {
  /** Always false for custom providers */
  isBuiltIn: false;
  
  /** The base provider template this is based on (e.g., "openai-compatible") */
  baseProviderId: string;
  
  /** When this custom provider was created */
  createdAt: number;
}

/** Union type for any provider */
type ProviderDefinition = BuiltInProviderDefinition | CustomProviderDefinition;
```

### Auth Method Types

Authentication is defined separately from the base provider interface. Providers can use one of two authentication methods:

#### 1. Field-Based Authentication

Traditional authentication using form fields (API key, base URL, headers, etc.)

```typescript
/**
 * Defines a field-based authentication method.
 * The provider specifies which fields are needed and their properties.
 */
interface FieldBasedAuth {
  type: "field-based";
  
  /**
   * Field definitions for the auth form.
   * At least one field must be marked as `primary: true`.
   */
  fields: Record<string, AuthFieldDefinition>;
}

interface AuthFieldDefinition {
  /** Display label */
  label: string;
  
  /** Field input type - determines UI component and storage */
  kind: "text" | "secret" | "textarea";
  
  /** 
   * Whether this is a primary auth field.
   * At least one primary field must be filled for auth to be valid.
   * Primary fields are always visible in the UI.
   */
  primary: boolean;
  
  /**
   * Whether this field is required (must be filled if visible).
   * Note: A field can be primary but not required (e.g., baseUrl for OpenAI).
   */
  required: boolean;
  
  /** Helper text shown below the field */
  helper?: string;
  
  /** Placeholder text */
  placeholder?: string;
  
  /** Default value */
  defaultValue?: string;
}
```

**Field Kind Behavior:**

| Kind | UI Component | Storage | Example |
|------|-------------|---------|---------|
| `text` | Text input | Plain in data.json | Base URL |
| `secret` | Secret input (masked) + SecretSelect | Obsidian SecretStorage (ID in data.json) | API Key |
| `textarea` | Multi-line text area | Plain in data.json | Headers JSON |

**UI Layout Rules:**

- **Primary fields** (`primary: true`) - Always visible in the main auth section
- **Non-primary fields** (`primary: false`) - Shown in a collapsible "Advanced" section
- **Required indicator** - Fields with `required: true` show a required marker

```
┌─────────────────────────────────────────┐
│ OpenAI                                  │
├─────────────────────────────────────────┤
│ API Key *                    [••••••••] │  ← primary: true, required: true
│ Get your key from platform.openai.com  │
│                                         │
│ ▶ Advanced                              │  ← Collapsed by default
│ ┌─────────────────────────────────────┐ │
│ │ Base URL          [________________]│ │  ← primary: false, required: false
│ │ Leave empty for default endpoint    │ │
│ │                                     │ │
│ │ Custom Headers    [________________]│ │  ← primary: false, required: false
│ │                   [________________]│ │
│ │ JSON format: {"key": "value"}       │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

#### 2. OAuth Authentication

Browser-based authentication flow (e.g., for GitHub Copilot).

```typescript
/**
 * Defines an OAuth authentication method.
 * The provider handles the flow; we just need to know how to trigger and store it.
 */
interface OAuthAuth {
  type: "oauth";
  
  /** Display name for the auth method (e.g., "Sign in with GitHub") */
  buttonLabel: string;
  
  /** 
   * Function to initiate the OAuth flow.
   * Opens browser, handles callback, returns tokens.
   */
  startFlow: () => Promise<OAuthTokens>;
  
  /**
   * Function to refresh tokens if supported.
   * Return null if refresh not supported (user must re-auth).
   */
  refreshTokens?: (tokens: OAuthTokens) => Promise<OAuthTokens | null>;
  
  /**
   * Function to validate if stored tokens are still valid.
   */
  validateTokens?: (tokens: OAuthTokens) => Promise<boolean>;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;  // Unix timestamp
  tokenType?: string;
  scope?: string;
  /** Provider-specific additional data */
  metadata?: Record<string, unknown>;
}
```

**OAuth UI:**

```
┌─────────────────────────────────────────┐
│ GitHub Copilot                          │
├─────────────────────────────────────────┤
│                                         │
│   [  Sign in with GitHub  ]             │  ← Not connected
│                                         │
│   OR                                    │
│                                         │
│   ✓ Connected as @username              │  ← Connected
│   [  Disconnect  ]                      │
│                                         │
└─────────────────────────────────────────┘
```

### Combined Auth Type

The provider definition uses a discriminated union for auth configuration:

```typescript
/**
 * Authentication method definition.
 * A provider uses exactly one auth method.
 */
type AuthMethod = FieldBasedAuth | OAuthAuth;

/**
 * Stored auth state varies by method type.
 */
type StoredAuthState = 
  | { type: "field-based"; values: Record<string, string>; secretIds: Record<string, string> }
  | { type: "oauth"; tokens: OAuthTokens };

/**
 * Runtime auth config (secrets resolved).
 */
type RuntimeAuthState =
  | { type: "field-based"; values: Record<string, string> }  // secrets resolved inline
  | { type: "oauth"; tokens: OAuthTokens };
```

### Provider Definition with Auth

Updated `ProviderDefinition` interface:

```typescript
interface ProviderDefinition {
  // ... identity, capabilities, etc.
  
  /**
   * Authentication method for this provider.
   * Defines both UI rendering and runtime auth handling.
   */
  auth: AuthMethod;
  
  /**
   * Validates the authentication configuration.
   * For field-based: checks if primary fields are filled and credentials work.
   * For OAuth: validates tokens are present and not expired.
   */
  validateAuth: (auth: RuntimeAuthState) => Promise<AuthValidationResult>;
  
  // ... other methods
}
```

### Example: Field-Based Auth (OpenAI)

```typescript
export const openaiProvider: BuiltInProviderDefinition = {
  id: "openai",
  displayName: "OpenAI",
  isBuiltIn: true,
  
  // Setup instructions at provider level (REQUIRED)
  setupInstructions: {
    steps: [
      "Create an API key from OpenAI's Dashboard",
      "Ensure your OpenAI account has credits loaded",
      "Paste the API key below (starts with 'sk-')",
    ],
    link: {
      url: "https://platform.openai.com/api-keys",
      text: "OpenAI Dashboard",
    },
  },
  
  // Auth configuration (separate concern)
  auth: {
    type: "field-based",
    fields: {
      apiKey: {
        label: "API Key",
        kind: "secret",
        primary: true,
        required: true,
        placeholder: "sk-...",
        helper: "Get your API key from platform.openai.com",
      },
      baseUrl: {
        label: "Base URL",
        kind: "text",
        primary: false,
        required: false,
        placeholder: "https://api.openai.com/v1",
        helper: "Leave empty for default OpenAI endpoint",
      },
      headers: {
        label: "Custom Headers",
        kind: "textarea",
        primary: false,
        required: false,
        helper: "JSON format: {\"Header-Name\": \"value\"}",
      },
    },
  },
  
  capabilities: {
    chat: true,
    embedding: true,
    modelDiscovery: true,
  },
  
  createRuntimeDefinition: async (auth) => {
    return createOpenAICompatibleRuntime(auth);
  },
  
  validateAuth: async (auth) => {
    if (auth.type !== "field-based") {
      return { success: false, message: "Invalid auth type" };
    }
    if (!auth.values.apiKey) {
      return { success: false, message: "API key is required" };
    }
    try {
      await fetchOpenAIModels(auth.values);
      return { success: true };
    } catch (e) {
      return { success: false, message: "Invalid API key" };
    }
  },
  
  discoverModels: async (auth) => {
    const result = await fetchOpenAIModels(auth.values);
    return {
      chatModels: Object.keys(result.chatModels),
      embeddingModels: Object.keys(result.embeddingModels),
    };
  },
};
```

### Example: Field-Based Auth (Ollama - No API Key)

```typescript
export const ollamaProvider: BuiltInProviderDefinition = {
  id: "ollama",
  displayName: "Ollama",
  isBuiltIn: true,
  
  // Setup instructions at provider level (REQUIRED)
  setupInstructions: {
    steps: [
      "Install Ollama on your machine",
      "Start the Ollama server (usually runs on localhost:11434)",
      "Enter the base URL below (default: http://localhost:11434)",
    ],
    link: {
      url: "https://ollama.ai",
      text: "Ollama Website",
    },
  },
  
  // Auth configuration - note: no API key, just base URL
  auth: {
    type: "field-based",
    fields: {
      baseUrl: {
        label: "Base URL",
        kind: "text",
        primary: true,      // Primary field for Ollama
        required: true,     // Must be filled
        placeholder: "http://localhost:11434",
        defaultValue: "http://localhost:11434",
        helper: "URL where Ollama is running",
      },
      headers: {
        label: "Custom Headers",
        kind: "textarea",
        primary: false,
        required: false,
        helper: "JSON format (e.g., for tunnel auth)",
      },
    },
  },
  
  capabilities: {
    chat: true,
    embedding: true,
    modelDiscovery: true,
  },
  
  createRuntimeDefinition: async (auth) => {
    return createOllamaRuntime(auth);
  },
  
  validateAuth: async (auth) => {
    if (auth.type !== "field-based") {
      return { success: false, message: "Invalid auth type" };
    }
    if (!auth.values.baseUrl) {
      return { success: false, message: "Base URL is required" };
    }
    try {
      await fetchOllamaModels(auth.values);
      return { success: true };
    } catch (e) {
      return { success: false, message: "Cannot connect to Ollama. Is it running?" };
    }
  },
  
  discoverModels: async (auth) => {
    const result = await fetchOllamaModels(auth.values);
    return {
      chatModels: Object.keys(result.chatModels),
      embeddingModels: Object.keys(result.embeddingModels),
    };
  },
};
```

### Example: OAuth Auth (Future - GitHub Copilot)

```typescript
export const copilotProvider: BuiltInProviderDefinition = {
  id: "github-copilot",
  displayName: "GitHub Copilot",
  isBuiltIn: true,
  
  // Setup instructions at provider level (REQUIRED)
  setupInstructions: {
    steps: [
      "Ensure you have a GitHub account with Copilot access",
      "Click the button below to sign in with GitHub",
      "Authorize the application to access your Copilot subscription",
    ],
    link: {
      url: "https://github.com/features/copilot",
      text: "Learn about GitHub Copilot",
    },
  },
  
  // OAuth auth configuration
  auth: {
    type: "oauth",
    buttonLabel: "Sign in with GitHub",
    
    startFlow: async () => {
      const tokens = await performGitHubOAuthFlow();
      return tokens;
    },
    
    refreshTokens: async (tokens) => {
      if (!tokens.refreshToken) return null;
      return await refreshGitHubTokens(tokens.refreshToken);
    },
    
    validateTokens: async (tokens) => {
      if (tokens.expiresAt && Date.now() > tokens.expiresAt) {
        return false;
      }
      return true;
    },
  },
  
  capabilities: {
    chat: true,
    embedding: false,
    modelDiscovery: false,
  },
  
  createRuntimeDefinition: async (auth) => {
    return createCopilotRuntime(auth);
  },
  
  validateAuth: async (auth) => {
    if (auth.type !== "oauth") {
      return { success: false, message: "Invalid auth type" };
    }
    if (!auth.tokens.accessToken) {
      return { success: false, message: "Not authenticated" };
    }
    if (auth.tokens.expiresAt && Date.now() > auth.tokens.expiresAt) {
      return { success: false, message: "Token expired. Please sign in again." };
    }
    return { success: true };
  },
};
```

### Storage Schema

How auth data is stored in `data.json`:

```typescript
interface StoredProvidersConfig {
  builtIn: {
    [providerId: string]: {
      isConfigured: boolean;
      auth: StoredAuthState;
      genModels: Record<string, GenModelConfig>;
      embedModels: Record<string, EmbedModelConfig>;
    };
  };
  custom: CustomProviderConfig[];
}

// Example stored data:
{
  "builtIn": {
    "openai": {
      "isConfigured": true,
      "auth": {
        "type": "field-based",
        "values": {
          "baseUrl": "",
          "headers": ""
        },
        "secretIds": {
          "apiKey": "openai-api-key-abc123"  // Reference to SecretStorage
        }
      },
      "genModels": { ... },
      "embedModels": { ... }
    },
    "github-copilot": {
      "isConfigured": true,
      "auth": {
        "type": "oauth",
        "tokens": {
          "accessToken": "ghu_xxxx",  // Stored in SecretStorage? Or inline?
          "refreshToken": "ghr_xxxx",
          "expiresAt": 1737590400000
        }
      },
      "genModels": { ... },
      "embedModels": { ... }
    }
  }
}
```

### Auth Resolution Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Stored Auth    │     │  Data Store     │     │  Runtime Auth   │
│  (data.json)    │────▶│  Resolution     │────▶│  (for API)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘

Field-Based:
  secretIds.apiKey: "openai-key-123"  ──▶  SecretStorage.get()  ──▶  apiKey: "sk-actual..."

OAuth:
  tokens.accessToken: "ghu_xxx"       ──▶  (pass through or decrypt) ──▶  accessToken: "ghu_xxx"
```

### Validation Rules

1. **Field-Based Auth Validation:**
   - At least one `primary: true` field must have a value
   - All `required: true` fields must have values
   - Provider's `validateAuth()` is called to test credentials

2. **OAuth Auth Validation:**
   - Tokens must be present
   - If `expiresAt` is set, token must not be expired
   - Provider's `validateAuth()` may make a test API call

### UI Component Mapping

| Auth Type | Field Kind | Component |
|-----------|------------|-----------|
| field-based | `secret` | `SecretSelect` (dropdown of secrets + create new) |
| field-based | `text` | `TextInput` |
| field-based | `textarea` | `Textarea` |
| oauth | - | `OAuthButton` (Connect/Disconnect) |

---

## Type Definitions

### File: `src/providers/types.ts`

```typescript
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

// ============================================================================
// UI Configuration Types
// ============================================================================

/**
 * Metadata for rendering a form field in the provider settings UI.
 */
export interface FieldMeta {
  /** Display label for the field */
  label: string;
  /** Whether this field is required for the provider to function */
  required: boolean;
  /** Input type for rendering */
  kind: "text" | "password" | "textarea";
  /** Optional helper text shown below the field */
  helper?: string;
  /** Placeholder text for empty inputs */
  placeholder?: string;
}

// ============================================================================
// Model Configuration Types
// ============================================================================

/**
 * Configuration for a generative (chat) model.
 */
export interface GenModelConfig {
  /** Default temperature for this model (0-1) */
  temperature: number;
  /** Maximum context window size in tokens */
  contextWindow: number;
}

/**
 * Configuration for an embedding model.
 */
export interface EmbedModelConfig {
  /** Similarity threshold for retrieval (0-1) */
  similarityThreshold: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Authentication configuration as stored in plugin data.json.
 * Uses apiKeyId to reference secrets stored in Obsidian's SecretStorage.
 */
export interface StoredAuthConfig {
  /** Reference to secret in Obsidian's SecretStorage */
  apiKeyId?: string;
  /** Base URL override for the API */
  baseUrl?: string;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
}

/**
 * Authentication configuration at runtime with resolved secrets.
 * This is what gets passed to the LangChain model constructors.
 */
export interface RuntimeAuthConfig {
  /** Actual API key value (resolved from SecretStorage) */
  apiKey?: string;
  /** Base URL for the API */
  baseUrl?: string;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
}

/**
 * Extended runtime auth for providers with additional fields.
 */
export interface ExtendedRuntimeAuthConfig extends RuntimeAuthConfig {
  /** OpenAI organization ID */
  organization?: string;
  /** OpenAI project ID */
  project?: string;
  /** API version (e.g., for Anthropic) */
  apiVersion?: string;
  /** Custom fetch implementation */
  fetchImpl?: typeof fetch;
}

// ============================================================================
// Runtime Types (LangChain Integration)
// ============================================================================

/**
 * Options passed when instantiating a model.
 */
export type ModelOptions = Record<string, unknown>;

/**
 * Factory function that creates a chat model instance.
 */
export type ChatModelFactory = (options?: ModelOptions) => Promise<BaseChatModel>;

/**
 * Factory function that creates an embedding model instance.
 */
export type EmbeddingModelFactory = (options?: ModelOptions) => Promise<EmbeddingsInterface>;

/**
 * Runtime provider definition containing model factories.
 * This is what the agent uses to instantiate models.
 */
export interface RuntimeProviderDefinition {
  /** Map of model name → factory function for chat models */
  chatModels: Record<string, ChatModelFactory>;
  /** Map of model name → factory function for embedding models */
  embeddingModels: Record<string, EmbeddingModelFactory>;
  /** Default chat model to use if none specified */
  defaultChatModel?: string;
  /** Default embedding model to use if none specified */
  defaultEmbeddingModel?: string;
}

/**
 * Result of model discovery from an API.
 */
export interface DiscoveredModels {
  chatModels: string[];
  embeddingModels: string[];
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Result of validating provider authentication.
 */
export type AuthValidationResult = 
  | { success: true }
  | { success: false; message: string };

// ============================================================================
// Provider Definition (Core Interface)
// ============================================================================

/**
 * Provider capabilities flags.
 */
export interface ProviderCapabilities {
  /** Whether this provider supports chat/completion models */
  chat: boolean;
  /** Whether this provider supports embedding models */
  embedding: boolean;
  /** Whether this provider can discover models via API */
  modelDiscovery: boolean;
}

/**
 * Complete provider definition containing everything needed for UI and runtime.
 * 
 * This is the core interface that unifies the UI configuration layer
 * and the agent runtime layer. Each provider exports one of these.
 */
export interface ProviderDefinition<
  TStoredAuth extends StoredAuthConfig = StoredAuthConfig,
  TRuntimeAuth extends RuntimeAuthConfig = RuntimeAuthConfig
> {
  // ─────────────────────────────────────────────────────────────────────────
  // Identity
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Unique identifier for this provider (lowercase, no spaces) */
  id: string;
  
  /** Human-readable display name */
  displayName: string;
  
  /** Whether this is a built-in provider (vs user-created) */
  isBuiltIn: boolean;
  
  /** For custom providers, the base provider template used */
  baseProviderId?: string;
  
  // ─────────────────────────────────────────────────────────────────────────
  // UI Configuration
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Field metadata for rendering the settings form */
  fieldMeta: Record<string, FieldMeta>;
  
  /** Instructions or help text shown in the UI for this provider */
  instructions?: string;
  
  // ─────────────────────────────────────────────────────────────────────────
  // Default Configuration
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Default authentication configuration */
  defaultAuth: TStoredAuth;
  
  // ─────────────────────────────────────────────────────────────────────────
  // Capabilities
  // ─────────────────────────────────────────────────────────────────────────
  
  /** What this provider supports */
  capabilities: ProviderCapabilities;
  
  // ─────────────────────────────────────────────────────────────────────────
  // Runtime Methods
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Creates the runtime provider definition with model factories.
   * Called when initializing the agent with this provider.
   */
  createRuntimeDefinition: (auth: TRuntimeAuth) => Promise<RuntimeProviderDefinition>;
  
  /**
   * Discovers available models from the provider's API.
   * Optional - only implemented for providers with modelDiscovery capability.
   */
  discoverModels?: (auth: TRuntimeAuth) => Promise<DiscoveredModels>;
  
  /**
   * Validates the authentication configuration.
   * Used to test API keys before saving.
   */
  validateAuth?: (auth: TRuntimeAuth) => Promise<AuthValidationResult>;
}

// ============================================================================
// Custom Provider Types
// ============================================================================

/**
 * Configuration for a user-created custom provider.
 * Stored in plugin data.json.
 */
export interface CustomProviderConfig {
  /** User-defined unique identifier */
  id: string;
  /** User-defined display name */
  displayName: string;
  /** The base provider template this is based on */
  baseProviderId: "openai-compatible";
  /** Stored authentication configuration */
  auth: StoredAuthConfig;
  /** User-configured generative models */
  genModels: Record<string, GenModelConfig>;
  /** User-configured embedding models */
  embedModels: Record<string, EmbedModelConfig>;
  /** When this custom provider was created */
  createdAt: number;
}

// ============================================================================
// Stored Provider State (for data.json)
// ============================================================================

/**
 * Complete state for a provider as stored in plugin settings.
 */
export interface StoredProviderState<TAuth extends StoredAuthConfig = StoredAuthConfig> {
  /** Whether this provider is enabled/configured */
  isConfigured: boolean;
  /** Authentication configuration */
  auth: TAuth;
  /** Configured generative models */
  genModels: Record<string, GenModelConfig>;
  /** Configured embedding models */
  embedModels: Record<string, EmbedModelConfig>;
}

/**
 * All provider configurations as stored in data.json.
 */
export interface StoredProvidersConfig {
  /** Built-in provider states, keyed by provider ID */
  builtIn: Record<string, StoredProviderState>;
  /** User-created custom providers */
  custom: CustomProviderConfig[];
}
```

---

## Directory Structure

```
src/providers/
├── index.ts                    # Main exports + registry
├── types.ts                    # All type definitions (above)
├── errors.ts                   # Provider-specific errors
├── helpers.ts                  # Shared utilities
│
├── base/                       # Shared implementation logic
│   └── openaiCompatible.ts     # OpenAI-compatible API implementation
│
├── builtin/                    # Built-in provider definitions
│   ├── index.ts                # Barrel export for built-ins
│   ├── openai.ts               # OpenAI provider
│   ├── anthropic.ts            # Anthropic provider
│   ├── ollama.ts               # Ollama provider
│   └── sapAiCore.ts            # SAP AI Core provider
│
└── custom/                     # Custom provider support
    ├── index.ts                # Custom provider management
    └── openaiCompatible.ts     # Factory for OpenAI-compatible custom providers
```

---

## Provider Definitions

### OpenAI Provider (`src/providers/builtin/openai.ts`)

```typescript
import type { ProviderDefinition, RuntimeAuthConfig, ExtendedRuntimeAuthConfig } from "../types";
import { createOpenAICompatibleRuntime, fetchOpenAIModels } from "../base/openaiCompatible";
import { ProviderAuthError } from "../errors";

export const openaiProvider: ProviderDefinition<
  { apiKeyId?: string; baseUrl?: string; headers?: Record<string, string> },
  ExtendedRuntimeAuthConfig
> = {
  // ─────────────────────────────────────────────────────────────────────────
  // Identity
  // ─────────────────────────────────────────────────────────────────────────
  id: "openai",
  displayName: "OpenAI",
  isBuiltIn: true,

  // ─────────────────────────────────────────────────────────────────────────
  // UI Configuration
  // ─────────────────────────────────────────────────────────────────────────
  fieldMeta: {
    apiKey: {
      label: "API Key",
      required: true,
      kind: "password",
      placeholder: "sk-...",
      helper: "Get your API key from platform.openai.com",
    },
    baseUrl: {
      label: "Base URL",
      required: false,
      kind: "text",
      placeholder: "https://api.openai.com/v1",
      helper: "Leave empty for default OpenAI endpoint",
    },
    headers: {
      label: "Custom Headers",
      required: false,
      kind: "textarea",
      helper: "JSON format: {\"Header-Name\": \"value\"}",
    },
  },

  instructions: `
To use OpenAI:
1. Create an account at [platform.openai.com](https://platform.openai.com)
2. Generate an API key in the API Keys section
3. Paste your API key above
  `.trim(),

  // ─────────────────────────────────────────────────────────────────────────
  // Default Configuration
  // ─────────────────────────────────────────────────────────────────────────
  defaultAuth: {
    apiKeyId: "",
    baseUrl: "",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Capabilities
  // ─────────────────────────────────────────────────────────────────────────
  capabilities: {
    chat: true,
    embedding: true,
    modelDiscovery: true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Runtime Methods
  // ─────────────────────────────────────────────────────────────────────────
  createRuntimeDefinition: async (auth) => {
    return createOpenAICompatibleRuntime(auth, {
      defaultBaseUrl: "https://api.openai.com/v1",
    });
  },

  discoverModels: async (auth) => {
    const result = await fetchOpenAIModels(auth);
    return {
      chatModels: Object.keys(result.chatModels),
      embeddingModels: Object.keys(result.embeddingModels),
    };
  },

  validateAuth: async (auth) => {
    if (!auth.apiKey) {
      return { success: false, message: "API key is required" };
    }
    try {
      await fetchOpenAIModels(auth);
      return { success: true };
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        return { success: false, message: "Invalid API key" };
      }
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Validation failed" 
      };
    }
  },
};
```

### Anthropic Provider (`src/providers/builtin/anthropic.ts`)

```typescript
import type { ProviderDefinition, RuntimeAuthConfig } from "../types";
import { createAnthropicRuntime, fetchAnthropicModels } from "./anthropicRuntime";
import { ProviderAuthError } from "../errors";

export const anthropicProvider: ProviderDefinition = {
  id: "anthropic",
  displayName: "Anthropic",
  isBuiltIn: true,

  fieldMeta: {
    apiKey: {
      label: "API Key",
      required: true,
      kind: "password",
      placeholder: "sk-ant-...",
      helper: "Get your API key from console.anthropic.com",
    },
    baseUrl: {
      label: "Base URL",
      required: false,
      kind: "text",
      placeholder: "https://api.anthropic.com",
      helper: "Leave empty for default Anthropic endpoint",
    },
    headers: {
      label: "Custom Headers",
      required: false,
      kind: "textarea",
      helper: "JSON format: {\"Header-Name\": \"value\"}",
    },
  },

  instructions: `
To use Anthropic Claude:
1. Create an account at [console.anthropic.com](https://console.anthropic.com)
2. Generate an API key in Settings → API Keys
3. Paste your API key above
  `.trim(),

  defaultAuth: {
    apiKeyId: "",
    baseUrl: "",
  },

  capabilities: {
    chat: true,
    embedding: false,
    modelDiscovery: true,
  },

  createRuntimeDefinition: async (auth) => {
    return createAnthropicRuntime(auth);
  },

  discoverModels: async (auth) => {
    const chatModels = await fetchAnthropicModels(auth);
    return {
      chatModels: Object.keys(chatModels),
      embeddingModels: [],
    };
  },

  validateAuth: async (auth) => {
    if (!auth.apiKey) {
      return { success: false, message: "API key is required" };
    }
    try {
      await fetchAnthropicModels(auth);
      return { success: true };
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        return { success: false, message: "Invalid API key" };
      }
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Validation failed" 
      };
    }
  },
};
```

### Ollama Provider (`src/providers/builtin/ollama.ts`)

```typescript
import type { ProviderDefinition, RuntimeAuthConfig } from "../types";
import { createOllamaRuntime, fetchOllamaModels } from "./ollamaRuntime";
import { ProviderEndpointError } from "../errors";

export const ollamaProvider: ProviderDefinition = {
  id: "ollama",
  displayName: "Ollama",
  isBuiltIn: true,

  fieldMeta: {
    baseUrl: {
      label: "Base URL",
      required: true,
      kind: "text",
      placeholder: "http://localhost:11434",
      helper: "URL where Ollama is running",
    },
    headers: {
      label: "Custom Headers",
      required: false,
      kind: "textarea",
      helper: "JSON format: {\"Header-Name\": \"value\"}",
    },
  },

  instructions: `
To use Ollama:
1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Start Ollama (it runs on port 11434 by default)
3. Pull a model: \`ollama pull llama3.1\`
4. Enter the Ollama URL above (default: http://localhost:11434)
  `.trim(),

  defaultAuth: {
    baseUrl: "http://localhost:11434",
  },

  capabilities: {
    chat: true,
    embedding: true,
    modelDiscovery: true,
  },

  createRuntimeDefinition: async (auth) => {
    return createOllamaRuntime(auth);
  },

  discoverModels: async (auth) => {
    const result = await fetchOllamaModels(auth);
    return {
      chatModels: Object.keys(result.chatModels),
      embeddingModels: Object.keys(result.embeddingModels),
    };
  },

  validateAuth: async (auth) => {
    if (!auth.baseUrl) {
      return { success: false, message: "Base URL is required" };
    }
    try {
      await fetchOllamaModels(auth);
      return { success: true };
    } catch (error) {
      if (error instanceof ProviderEndpointError) {
        return { 
          success: false, 
          message: "Cannot connect to Ollama. Is it running?" 
        };
      }
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Validation failed" 
      };
    }
  },
};
```

### SAP AI Core Provider (`src/providers/builtin/sapAiCore.ts`)

```typescript
import type { ProviderDefinition } from "../types";
import { createSapAICoreRuntime } from "./sapAiCoreRuntime";

interface SapAICoreStoredAuth {
  apiKeyId?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  resourceGroup?: string;
  deploymentId?: string;
}

export const sapAiCoreProvider: ProviderDefinition<SapAICoreStoredAuth> = {
  id: "sap-ai-core",
  displayName: "SAP AI Core",
  isBuiltIn: true,

  fieldMeta: {
    apiKey: {
      label: "API Key / Token",
      required: true,
      kind: "password",
      helper: "SAP AI Core service key or bearer token",
    },
    baseUrl: {
      label: "AI Core URL",
      required: true,
      kind: "text",
      placeholder: "https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com",
      helper: "Your SAP AI Core endpoint URL",
    },
    resourceGroup: {
      label: "Resource Group",
      required: false,
      kind: "text",
      helper: "SAP AI Core resource group (if applicable)",
    },
    deploymentId: {
      label: "Deployment ID",
      required: false,
      kind: "text",
      helper: "Specific deployment ID to use",
    },
    headers: {
      label: "Custom Headers",
      required: false,
      kind: "textarea",
      helper: "JSON format: {\"Header-Name\": \"value\"}",
    },
  },

  instructions: `
To use SAP AI Core:
1. Ensure you have access to SAP AI Core
2. Create a service key or obtain a bearer token
3. Enter your AI Core endpoint URL and credentials
  `.trim(),

  defaultAuth: {
    apiKeyId: "",
    baseUrl: "",
    resourceGroup: "",
    deploymentId: "",
  },

  capabilities: {
    chat: true,
    embedding: true,
    modelDiscovery: false, // Requires specific deployment info
  },

  createRuntimeDefinition: async (auth) => {
    return createSapAICoreRuntime(auth);
  },

  // No automatic model discovery for SAP AI Core
  // Users need to configure models manually based on their deployments
};
```

---

## Provider Registry

### Main Registry (`src/providers/index.ts`)

```typescript
import type { ProviderDefinition, CustomProviderConfig, StoredProvidersConfig } from "./types";
import { openaiProvider } from "./builtin/openai";
import { anthropicProvider } from "./builtin/anthropic";
import { ollamaProvider } from "./builtin/ollama";
import { sapAiCoreProvider } from "./builtin/sapAiCore";
import { createCustomOpenAICompatibleProvider } from "./custom/openaiCompatible";

// ============================================================================
// Built-in Providers
// ============================================================================

/**
 * All built-in provider definitions, keyed by ID.
 */
export const builtInProviders = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
  "sap-ai-core": sapAiCoreProvider,
} as const;

export type BuiltInProviderId = keyof typeof builtInProviders;

/**
 * List of all built-in provider IDs.
 */
export const builtInProviderIds = Object.keys(builtInProviders) as BuiltInProviderId[];

// ============================================================================
// Provider Access
// ============================================================================

/**
 * Get a built-in provider by ID.
 */
export function getBuiltInProvider(id: BuiltInProviderId): ProviderDefinition {
  return builtInProviders[id];
}

/**
 * Check if an ID corresponds to a built-in provider.
 */
export function isBuiltInProvider(id: string): id is BuiltInProviderId {
  return id in builtInProviders;
}

/**
 * Get a provider by ID (built-in or custom).
 * Custom providers must be passed in since they're stored in plugin data.
 */
export function getProvider(
  id: string,
  customProviders: CustomProviderConfig[] = []
): ProviderDefinition | undefined {
  // Check built-in first
  if (isBuiltInProvider(id)) {
    return builtInProviders[id];
  }
  
  // Check custom providers
  const customConfig = customProviders.find(p => p.id === id);
  if (customConfig) {
    return createCustomOpenAICompatibleProvider(customConfig);
  }
  
  return undefined;
}

/**
 * List all available provider IDs (built-in + custom).
 */
export function listAllProviderIds(customProviders: CustomProviderConfig[] = []): string[] {
  return [
    ...builtInProviderIds,
    ...customProviders.map(p => p.id),
  ];
}

/**
 * Get all provider definitions (built-in + custom).
 */
export function getAllProviders(
  customProviders: CustomProviderConfig[] = []
): ProviderDefinition[] {
  return [
    ...Object.values(builtInProviders),
    ...customProviders.map(c => createCustomOpenAICompatibleProvider(c)),
  ];
}

// ============================================================================
// Exports
// ============================================================================

export * from "./types";
export * from "./errors";
export { createCustomOpenAICompatibleProvider } from "./custom/openaiCompatible";
```

---

## Custom Providers

### Custom OpenAI-Compatible Factory (`src/providers/custom/openaiCompatible.ts`)

```typescript
import type { ProviderDefinition, CustomProviderConfig, RuntimeAuthConfig } from "../types";
import { createOpenAICompatibleRuntime, fetchOpenAIModels } from "../base/openaiCompatible";
import { openaiProvider } from "../builtin/openai";

/**
 * Creates a provider definition from a custom provider configuration.
 * Custom providers use the OpenAI-compatible API implementation.
 */
export function createCustomOpenAICompatibleProvider(
  config: CustomProviderConfig
): ProviderDefinition {
  return {
    // Identity from user config
    id: config.id,
    displayName: config.displayName,
    isBuiltIn: false,
    baseProviderId: "openai-compatible",
    
    // Inherit UI config from OpenAI
    fieldMeta: openaiProvider.fieldMeta,
    
    instructions: `
Custom OpenAI-compatible provider.
Configure the base URL to point to your API endpoint.
    `.trim(),
    
    // User's configured auth
    defaultAuth: config.auth,
    
    // Same capabilities as OpenAI (user can discover models if API supports it)
    capabilities: {
      chat: true,
      embedding: true,
      modelDiscovery: true,
    },
    
    // Use OpenAI-compatible runtime
    createRuntimeDefinition: async (auth) => {
      return createOpenAICompatibleRuntime(auth, {
        defaultBaseUrl: config.auth.baseUrl || "",
      });
    },
    
    discoverModels: async (auth) => {
      try {
        const result = await fetchOpenAIModels(auth);
        return {
          chatModels: Object.keys(result.chatModels),
          embeddingModels: Object.keys(result.embeddingModels),
        };
      } catch {
        // Model discovery might not be supported
        return { chatModels: [], embeddingModels: [] };
      }
    },
    
    validateAuth: openaiProvider.validateAuth,
  };
}

/**
 * Creates a new custom provider configuration with sensible defaults.
 */
export function createCustomProviderConfig(
  id: string,
  displayName: string,
  baseUrl: string = ""
): CustomProviderConfig {
  return {
    id: id.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    displayName,
    baseProviderId: "openai-compatible",
    auth: {
      apiKeyId: "",
      baseUrl,
    },
    genModels: {},
    embedModels: {},
    createdAt: Date.now(),
  };
}

/**
 * Validates a custom provider ID.
 */
export function validateCustomProviderId(
  id: string,
  existingIds: string[]
): { valid: boolean; error?: string } {
  if (!id) {
    return { valid: false, error: "ID is required" };
  }
  
  if (!/^[a-z0-9-]+$/.test(id)) {
    return { valid: false, error: "ID must be lowercase alphanumeric with dashes only" };
  }
  
  if (id.length > 32) {
    return { valid: false, error: "ID must be 32 characters or less" };
  }
  
  if (existingIds.includes(id)) {
    return { valid: false, error: "A provider with this ID already exists" };
  }
  
  return { valid: true };
}
```

---

## Integration Points

### Data Store Integration

The `PluginDataStore` needs to be updated to use the new provider types:

```typescript
// src/stores/dataStore.svelte.ts

import { 
  builtInProviderIds, 
  getBuiltInProvider,
  type StoredProvidersConfig,
  type CustomProviderConfig,
  type StoredProviderState,
} from "../providers";

// New default settings structure
export function createDefaultProvidersConfig(): StoredProvidersConfig {
  const builtIn: Record<string, StoredProviderState> = {};
  
  for (const id of builtInProviderIds) {
    const provider = getBuiltInProvider(id);
    builtIn[id] = {
      isConfigured: false,
      auth: { ...provider.defaultAuth },
      genModels: {},
      embedModels: {},
    };
  }
  
  return {
    builtIn,
    custom: [],
  };
}
```

### AgentManager Integration

The `AgentManager` switch statement is replaced with registry lookups:

```typescript
// src/agent/AgentManager.ts

import { getProvider, type RuntimeAuthConfig } from "../providers";

private async configureProviderOnRegistry(
  registry: ProviderRegistry,
  providerId: string,
  auth: RuntimeAuthConfig
): Promise<void> {
  const provider = getProvider(providerId, this.getCustomProviders());
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  
  const runtimeDef = await provider.createRuntimeDefinition(auth);
  await registry.registerProvider(providerId, runtimeDef);
}
```

### Settings UI Integration

The settings UI uses `fieldMeta` from the provider definition:

```typescript
// src/components/settings/AuthConfigFields.svelte

<script lang="ts">
  import { getProvider } from "../../providers";
  
  export let providerId: string;
  
  const provider = getProvider(providerId);
  const fields = provider?.fieldMeta ?? {};
</script>

{#each Object.entries(fields) as [key, meta]}
  <FormField label={meta.label} required={meta.required} helper={meta.helper}>
    {#if meta.kind === "password"}
      <SecretInput ... />
    {:else if meta.kind === "textarea"}
      <Textarea ... />
    {:else}
      <TextInput placeholder={meta.placeholder} ... />
    {/if}
  </FormField>
{/each}
```

---

## Migration Checklist

### Phase 1: Create New Provider Structure

- [ ] Create `src/providers/types.ts` with all type definitions
- [ ] Create `src/providers/errors.ts` (move from `src/agent/providers/errors.ts`)
- [ ] Create `src/providers/helpers.ts` (move from `src/agent/providers/helpers.ts`)
- [ ] Create `src/providers/base/openaiCompatible.ts` (extract from `src/agent/providers/openai.ts`)
- [ ] Create `src/providers/builtin/openai.ts`
- [ ] Create `src/providers/builtin/anthropic.ts`
- [ ] Create `src/providers/builtin/ollama.ts`
- [ ] Create `src/providers/builtin/sapAiCore.ts`
- [ ] Create `src/providers/builtin/index.ts`
- [ ] Create `src/providers/custom/openaiCompatible.ts`
- [ ] Create `src/providers/custom/index.ts`
- [ ] Create `src/providers/index.ts` (main registry)

### Phase 2: Update Data Store

- [ ] Update `StoredProvidersConfig` type in plugin data
- [ ] Update `DEFAULT_SETTINGS` to use new structure
- [ ] Update `PluginDataStore` methods to use new types
- [ ] Add methods for custom provider CRUD
- [ ] Update persistence serialization (Map ↔ Object conversion)

### Phase 3: Update AgentManager

- [ ] Remove switch statement in `configureProviderOnRegistry`
- [ ] Use provider registry for runtime definition creation
- [ ] Update `testProviderConfig` to use provider's `validateAuth`
- [ ] Update `getAvailableModels` to support custom providers

### Phase 4: Update UI Components

- [ ] Update `ProvidersSettings.svelte` to list all providers (built-in + custom)
- [ ] Update `ProviderItem.svelte` to use `fieldMeta` from provider
- [ ] Update `AuthConfigFields.svelte` to be provider-agnostic
- [ ] Add "Create Custom Provider" UI
- [ ] Add custom provider management (edit, delete)

### Phase 5: Cleanup

- [ ] Delete `src/types/providers.ts`
- [ ] Delete `src/agent/providers/` (old location)
- [ ] Update all imports throughout codebase
- [ ] Run TypeScript compiler to find any missed references
- [ ] Test all providers (built-in and custom)

---

## Open Questions

1. **Model sync strategy**: When should discovered models override/merge with default models?
   - Option A: Always prefer discovered models
   - Option B: Merge discovered with defaults, user can remove unwanted
   - Option C: Let user choose per-provider

2. **Custom provider limits**: Should we limit the number of custom providers? (Probably not needed)

3. **Provider icons**: Should providers have icons for the UI? Where to store them?

4. **Export/import**: Should users be able to export/import custom provider configurations?
