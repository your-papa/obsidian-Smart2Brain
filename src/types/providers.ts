import type { BuiltInProviderOptions } from "../agent/providers/types";

// Re-export for convenience
export type { BuiltInProviderOptions };

// Define these locally since they're not exported from the current papa-ts version
export type RegisteredProvider =
	| "OpenAI"
	| "Ollama"
	| "CustomOpenAI"
	| "Anthropic";

export type RegisteredGenProvider = RegisteredProvider;

export type RegisteredEmbedProvider = RegisteredProvider;

export const registeredProviders = [
	"OpenAI",
	"Ollama",
	"CustomOpenAI",
	"Anthropic",
] as const;

// Provider auth is stored as BuiltInProviderOptions (apiKey, baseUrl, headers, etc.)
export type ProviderAuth = BuiltInProviderOptions;

type FieldKind = "text" | "password" | "textarea";

export type FieldMeta = {
	label: string;
	required: boolean;
	kind: FieldKind;
	helper?: string;
};

export const providerFieldMeta: Record<
	RegisteredProvider,
	Record<string, FieldMeta>
> = {
	OpenAI: {
		apiKey: { label: "API Key", required: true, kind: "password" },
		baseUrl: {
			label: "Base URL",
			required: false,
			kind: "text",
			helper: "Override for custom endpoints",
		},
		headers: {
			label: "Headers (JSON)",
			required: false,
			kind: "textarea",
		},
	},
	Anthropic: {
		apiKey: { label: "API Key", required: true, kind: "password" },
		baseUrl: {
			label: "Base URL",
			required: false,
			kind: "text",
		},
		headers: {
			label: "Headers (JSON)",
			required: false,
			kind: "textarea",
		},
	},
	CustomOpenAI: {
		apiKey: { label: "API Key", required: true, kind: "password" },
		baseUrl: {
			label: "Base URL",
			required: false,
			kind: "text",
		},
		headers: {
			label: "Headers (JSON)",
			required: false,
			kind: "textarea",
		},
	},
	Ollama: {
		baseUrl: { label: "Base URL", required: true, kind: "text" },
		headers: {
			label: "Headers (JSON)",
			required: false,
			kind: "textarea",
		},
	},
};

export interface EmbedModelConfig {
	similarityThreshold: number;
}

export interface GenModelConfig {
	temperature: number;
	contextWindow: number;
}

// Helper types for model settings
type EmbedModelSettings = {
	embedModels: Map<string, EmbedModelConfig>;
};

type GenModelSettings = {
	genModels: Map<string, GenModelConfig>;
};

// All providers use BuiltInProviderOptions for auth storage
type ProviderAuthMap = {
	[K in RegisteredProvider]: BuiltInProviderOptions;
};

type ConfigurationState = {
	isConfigured: boolean;
};

// Helper type to determine if a provider supports embedding
type SupportsEmbedding<T extends RegisteredProvider> =
	T extends RegisteredEmbedProvider ? true : false;

// Helper type to determine if a provider supports generation
type SupportsGeneration<T extends RegisteredProvider> =
	T extends RegisteredGenProvider ? true : false;

// Create the configuration type for each provider based on its capabilities
type ProviderConfiguration<T extends RegisteredProvider> =
	ConfigurationState & {
		providerAuth: ProviderAuthMap[T];
	} & (T extends RegisteredEmbedProvider ? EmbedModelSettings : {}) &
		(T extends RegisteredGenProvider ? GenModelSettings : {});

// Generate a mapped type that includes all registered providers
export type AllProviderConfigs = {
	[K in RegisteredProvider]: ProviderConfiguration<K>;
};

// Utility type to ensure completeness - this will cause a TypeScript error
// if any registered provider is missing from our configuration
type EnsureAllProvidersIncluded = {
	[K in (typeof registeredProviders)[number]]: K extends keyof AllProviderConfigs
		? true
		: false;
};

// Type guard to check if all providers are properly configured
type ValidateProviderConfigs<T> = T extends AllProviderConfigs ? T : never;

// Export the main type for use in PluginData
export type ProviderConfigs = ValidateProviderConfigs<AllProviderConfigs>;

// Utility types for accessing specific provider configurations
export type GetProviderConfig<T extends RegisteredProvider> =
	AllProviderConfigs[T];

export type GetProviderAuth<T extends RegisteredProvider> = ProviderAuthMap[T];

// Type to get all providers that support embedding
export type EmbedProviders = {
	[K in RegisteredProvider]: SupportsEmbedding<K> extends true ? K : never;
}[RegisteredProvider];

// Type to get all providers that support generation
export type GenProviders = {
	[K in RegisteredProvider]: SupportsGeneration<K> extends true ? K : never;
}[RegisteredProvider];

// Example usage types for validation
export type EmbedProvidersConfig = {
	[K in EmbedProviders]: GetProviderConfig<K>;
};

export type GenProvidersConfig = {
	[K in GenProviders]: GetProviderConfig<K>;
};

// Utility function type for runtime validation
export type ProviderConfigValidator = {
	[K in RegisteredProvider]: (
		config: unknown,
	) => config is GetProviderConfig<K>;
};

export class SetEmbedModelError extends Error {
	constructor(model: string, provider: string) {
		super(
			`Model "${model}" does not exist in embedModels for provider "${provider}".`,
		);
		this.name = "SetEmbedModelError";
	}
}

export class AddEmbedModelError extends Error {
	constructor(model: string, provider: string) {
		super(
			`Model "${model}" already exist in embedModels for provider "${provider}".`,
		);
		this.name = "AddEmbedModelError";
	}
}

export class SetGenModelError extends Error {
	constructor(model: string, provider: string) {
		super(
			`Model "${model}" does not exist in genModels for provider "${provider}".`,
		);
		this.name = "SetGEnModelError";
	}
}

export class AddGenModelError extends Error {
	constructor(model: string, provider: string) {
		super(
			`Model "${model}" already exist in genModels for provider "${provider}".`,
		);
		this.name = "AddGenModelError";
	}
}
