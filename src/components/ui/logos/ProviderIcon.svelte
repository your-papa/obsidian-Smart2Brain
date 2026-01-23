<script lang="ts">
import { AnthropicLogo, OllamaLogo, OpenAILogo } from "@selemondev/svgl-svelte";
import type { Component } from "svelte";
import GenericAIIcon from "./GenericAIIcon.svelte";

interface Props {
	size?: { width?: number; height?: number };
	className?: string;
	providerName: string;
}

const { size, className, providerName }: Props = $props();

// biome-ignore lint/suspicious/noExplicitAny: Logo components have varying prop types
const logoMap: Record<string, Component<Record<string, unknown>>> = {
	openai: OpenAILogo as Component<Record<string, unknown>>,
	anthropic: AnthropicLogo as Component<Record<string, unknown>>,
	ollama: OllamaLogo as Component<Record<string, unknown>>,
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
