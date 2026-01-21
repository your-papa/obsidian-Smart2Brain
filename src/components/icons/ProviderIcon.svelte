<script lang="ts">
import { OpenAILogo, AnthropicLogo, OllamaLogo } from "@selemondev/svgl-svelte";
import type { RegisteredProvider } from "../../types/providers";
import GenericAIIcon from "./GenericAIIcon.svelte";

interface Props {
	size?: { width?: number; height?: number };
	className?: string;
	providerName: RegisteredProvider;
}

const { size, className, providerName }: Props = $props();

const logoMap: Record<RegisteredProvider, any> = {
	OpenAI: OpenAILogo,
	CustomOpenAI: GenericAIIcon,
	Anthropic: AnthropicLogo,
	Ollama: OllamaLogo,
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
