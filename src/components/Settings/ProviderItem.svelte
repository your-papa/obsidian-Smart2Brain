<script lang="ts">
import { Accordion } from "bits-ui";
import { getData } from "../../stores/dataStore.svelte";
import type { RegisteredProvider } from "../../types/providers";
import { createProviderStateQuery, invalidateProviderState } from "../../utils/query";
import Button from "../base/Button.svelte";
import ProviderIcon from "../icons/ProviderIcon.svelte";
import AuthConfigFields from "./AuthConfigFields.svelte";
import SettingContainer from "./SettingContainer.svelte";

interface Props {
	provider: RegisteredProvider;
	onAccordionClick: (provider: RegisteredProvider) => void;
}

const { provider, onAccordionClick }: Props = $props();

const data = getData();

// Check if provider is configured
let isConfigured = $derived(data.getConfiguredProviders().includes(provider));

const query = createProviderStateQuery(() => provider);

function refetch() {
	invalidateProviderState(provider);
}

function handleToggleProvider() {
	data.toggleProviderIsConfigured(provider);
	invalidateProviderState(provider);
}

// Provider-specific setup instructions
const providerInstructions: Record<RegisteredProvider, { steps: string[]; link?: { url: string; text: string } }> = {
	OpenAI: {
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
	Anthropic: {
		steps: [
			"Create an API key from Anthropic's Console",
			"Ensure your account has credits available",
			"Paste the API key below",
		],
		link: {
			url: "https://console.anthropic.com/settings/keys",
			text: "Anthropic Console",
		},
	},
	Ollama: {
		steps: [
			"Install Ollama on your machine",
			"Start the Ollama server (usually runs on localhost:11434)",
			"Enter the base URL below (default: http://localhost:11434)",
		],
		link: { url: "https://ollama.ai", text: "Ollama Website" },
	},
	CustomOpenAI: {
		steps: [
			"Enter the base URL of your OpenAI-compatible API",
			"Provide the API key if required by your provider",
			"Configure any custom headers if needed",
		],
	},
};

let instructions = $derived(providerInstructions[provider]);
</script>

<Accordion.Item
    value={provider}
    class="setting-group flex-col group [&[data-state=open]_.chev]:rotate-180 !py-0"
>
    <Accordion.Header
        onclick={() => onAccordionClick(provider)}
        class="sync-exclude-folder setting-item-heading w-[-webkit-fill-available] !mr-0"
    >
        <div class="sync-exclude-folder-name flex items-center gap-2">
            <ProviderIcon
                providerName={provider}
                size={{ width: 16, height: 16 }}
            />
            <span>{provider}</span>
            {#if isConfigured}
                {#if query.data?.auth.success}
                    <Button
                        iconId={"check"}
                        styles={"text-[--background-modifier-success]"}
                        tooltip={"Authentication valid - Click to refresh"}
                        onClick={() => refetch()}
                        stopPropagation={true}
                    />
                {:else}
                    <Button
                        iconId={"x"}
                        styles={"text-[--background-modifier-error]"}
                        tooltip={"Authentication failed - Click to refresh"}
                        onClick={() => refetch()}
                        stopPropagation={true}
                    />
                {/if}
            {:else}
                <span
                    class="text-xs text-[--text-muted] px-2 py-0.5 rounded bg-[--background-secondary]"
                >
                    Not configured
                </span>
            {/if}
        </div>
        {#if isConfigured}
            <Button
                iconId="trash"
                styles={"hover:text-[--text-error]"}
                stopPropagation={true}
                tooltip="Remove provider"
                onClick={handleToggleProvider}
            />
        {/if}
        <Button
            styles="chev inline-flex items-center justify-center transition-transform duration-200"
            iconId="chevron-down"
        />
    </Accordion.Header>

    <Accordion.Content
        class="setting-items data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down tracking-[-0.01em] w-[-webkit-fill-available] pb-2"
    >
        {#if !isConfigured}
            <!-- Setup instructions for unconfigured providers -->
            <div class="setting-item">
                <div class="setting-item-info">
                    <div class="setting-item-name">Setup Info</div>
                    <div class="setting-item-description text-sm">
                        <ul class="list-disc pl-4 space-y-1">
                            {#each instructions.steps as step}
                                <li>{step}</li>
                            {/each}
                        </ul>
                        {#if instructions.link}
                            <a
                                href={instructions.link.url}
                                class="mt-2 inline-block"
                                >{instructions.link.text}</a
                            >
                        {/if}
                    </div>
                </div>
            </div>
        {/if}

        <!-- Auth configuration fields -->
        <AuthConfigFields {provider} />

        {#if !isConfigured}
            <!-- Add provider button for unconfigured providers -->
            <SettingContainer name="" desc="">
                <div class="flex items-center gap-2">
                    {#if query.data !== undefined}
                        <div
                            class="flex items-center gap-2 text-sm mr-auto"
                            class:text-[--text-success]={query.data.auth
                                .success}
                            class:text-[--text-error]={!query.data.auth.success}
                        >
                            {#if query.data.auth.success}
                                <span>Authentication successful</span>
                            {:else}
                                <span>{query.data.auth.message}</span>
                            {/if}
                        </div>
                    {/if}
                    <Button
                        buttonText="Add Provider"
                        cta={true}
                        disabled={!query.data?.auth.success}
                        onClick={handleToggleProvider}
                    />
                </div>
            </SettingContainer>
        {/if}
    </Accordion.Content>
</Accordion.Item>
