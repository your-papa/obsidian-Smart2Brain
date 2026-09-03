import type { HydratedChatModelMetadata } from "../types/modelMetadata";

/**
 * Icon + label for each chat-model capability flag, shared by the desktop
 * card (ModelSelectionModal.svelte) and the mobile row (ModelSuggestModal.ts)
 * so both surfaces stay in sync. `structuredOutput` reads as "JSON" in the
 * underlying flag name, but that's the wire format, not something a user
 * asked for — the label spells out what it actually buys them (constrained,
 * schema-valid output), since an icon alone can't carry that.
 */
export const MODEL_CAPABILITY_ICONS: Record<
	keyof HydratedChatModelMetadata["capabilities"],
	{ icon: string; label: string }
> = {
	toolCalls: { icon: "wrench", label: "Tool calling" },
	reasoning: { icon: "brain", label: "Extended reasoning" },
	vision: { icon: "eye", label: "Vision / file attachments" },
	structuredOutput: { icon: "braces", label: "Structured output (JSON schema)" },
};
