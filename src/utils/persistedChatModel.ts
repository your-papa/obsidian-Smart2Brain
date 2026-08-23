import type { ChatModel } from "../stores/chatStore.svelte";
import { useAvailableModels } from "../hooks/useAvailableModels.svelte";

/**
 * Build the `ChatModel` record persisted on an agent when a model is picked.
 *
 * Hydrated catalogue metadata wins where available; otherwise the previously stored
 * config is preserved so a re-pick of the same model doesn't silently drop a tuned
 * context window or temperature.
 *
 * Shared by every model picker (composer pill, agent editor, onboarding, and the
 * "select a model" notice action) so a model selected from any of them persists
 * identically — these were four byte-identical copies before.
 */
export function buildPersistedChatModel(provider: string, model: string, existing?: ChatModel | null): ChatModel {
	const models = useAvailableModels();
	const hydrated = models.hydratedChatModelsByKey.get(`${provider}:${model}`);
	return {
		provider,
		model,
		modelConfig: {
			contextWindow: hydrated?.contextWindow ?? existing?.modelConfig?.contextWindow ?? 128000,
			supportsVision: hydrated?.capabilities.vision ?? existing?.modelConfig?.supportsVision,
			temperature: existing?.modelConfig?.temperature,
		},
	};
}
