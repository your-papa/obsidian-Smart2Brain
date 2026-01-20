import type {
	BuiltInProviderModelMap,
	BuiltInProviderModelMapEntry,
	ChatModelFactory,
	EmbeddingModelFactory,
} from "./types";

export function firstKey<T extends Record<string, unknown>>(value: T | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const [first] = Object.keys(value);
	return first;
}

export function normalizeDescriptor(value: string | BuiltInProviderModelMapEntry): BuiltInProviderModelMapEntry {
	if (typeof value === "string") {
		return { model: value };
	}
	return value;
}

export function createChatFactories(
	entries: BuiltInProviderModelMap,
	factoryCreator: (descriptor: BuiltInProviderModelMapEntry) => ChatModelFactory,
): Record<string, ChatModelFactory> {
	return Object.entries(entries).reduce<Record<string, ChatModelFactory>>((acc, [alias, descriptor]) => {
		const normalized = normalizeDescriptor(descriptor);
		acc[alias] = factoryCreator(normalized);
		return acc;
	}, {});
}

export function createEmbeddingFactories(
	entries: BuiltInProviderModelMap,
	factoryCreator: (descriptor: BuiltInProviderModelMapEntry) => EmbeddingModelFactory,
): Record<string, EmbeddingModelFactory> {
	return Object.entries(entries).reduce<Record<string, EmbeddingModelFactory>>((acc, [alias, descriptor]) => {
		const normalized = normalizeDescriptor(descriptor);
		acc[alias] = factoryCreator(normalized);
		return acc;
	}, {});
}
