<script lang="ts">
import { AnthropicLogo, OllamaLogo, OpenAILogo } from "@selemondev/svgl-svelte";
import type { Component } from "svelte";
import type { RegisteredProvider } from "../../../types/providers";
import GenericAIIcon from "./GenericAIIcon.svelte";

interface Props {
	size?: { width?: number; height?: number };
	className?: string;
	providerName: RegisteredProvider;
}

const { size, className, providerName }: Props = $props();

// biome-ignore lint/suspicious/noExplicitAny: Logo components have varying prop types
const logoMap: Record<RegisteredProvider, Component<Record<string, unknown>>> = {
	OpenAI: OpenAILogo as Component<Record<string, unknown>>,
	CustomOpenAI: GenericAIIcon as Component<Record<string, unknown>>,
	Anthropic: AnthropicLogo as Component<Record<string, unknown>>,
	Ollama: OllamaLogo as Component<Record<string, unknown>>,
};
</script>

{#if logoMap[providerName]}
    {@const LogoComponent = logoMap[providerName]}
    <LogoComponent
        width={size?.width}
        height={size?.height}
        class={className}
    />
{/if}
