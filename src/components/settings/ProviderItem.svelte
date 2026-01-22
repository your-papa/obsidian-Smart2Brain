<script lang="ts">
import { Accordion } from "bits-ui";
import { createProviderStateQuery, invalidateProviderState } from "../../lib/query";
import { getProvider } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import Button from "../ui/Button.svelte";
import ProviderIcon from "../ui/logos/ProviderIcon.svelte";
import AuthConfigFields from "./AuthConfigFields.svelte";
import SettingItem from "./SettingItem.svelte";

interface Props {
	provider: string;
	onAccordionClick: (provider: string) => void;
}

const { provider, onAccordionClick }: Props = $props();

const data = getData();

// Get custom providers for provider lookup (stored format without runtime methods)
let customProviders = $derived(data.getCustomProviders().map((cp) => cp.definition));

// Get provider definition from registry
let providerDefinition = $derived(getProvider(provider, customProviders));

// Check if provider is configured using new system
let isConfigured = $derived(data.isProviderConfigured(provider));

// Query for provider state (auth + models)
const query = createProviderStateQuery(() => provider);

function refetch() {
	invalidateProviderState(provider);
}

function handleToggleProvider() {
	const newConfiguredState = !isConfigured;
	data.setProviderConfigured(provider, newConfiguredState);
	invalidateProviderState(provider);
}

// Get setup instructions from provider definition
let instructions = $derived(providerDefinition?.setupInstructions);

// Get display name for the provider
let displayName = $derived(providerDefinition?.displayName ?? provider);
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
			<ProviderIcon providerName={provider} size={{ width: 16, height: 16 }} />
			<span>{displayName}</span>
			{#if isConfigured}
				{#if query.data?.auth.success}
					<Button
						iconId="check"
						styles="text-[--background-modifier-success]"
						tooltip="Authentication valid - Click to refresh"
						onClick={() => refetch()}
						stopPropagation={true}
					/>
				{:else}
					<Button
						iconId="x"
						styles="text-[--background-modifier-error]"
						tooltip="Authentication failed - Click to refresh"
						onClick={() => refetch()}
						stopPropagation={true}
					/>
				{/if}
			{:else}
				<span class="text-xs text-[--text-muted] px-2 py-0.5 rounded bg-[--background-secondary]">
					Not configured
				</span>
			{/if}
		</div>
		{#if isConfigured}
			<Button
				iconId="trash"
				styles="hover:text-[--text-error]"
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
			<SettingItem name="Setup Info">
				{#snippet children()}
					<!-- Empty control slot -->
				{/snippet}
			</SettingItem>
			{#if instructions}
			<div class="setting-item-description text-sm px-4 pb-2">
				<ul class="list-disc pl-4 space-y-1">
					{#each instructions.steps as step}
						<li>{step}</li>
					{/each}
				</ul>
				{#if instructions.link}
					<a href={instructions.link.url} class="mt-2 inline-block">{instructions.link.text}</a>
				{/if}
			</div>
		{/if}
		{/if}

		<!-- Auth configuration fields -->
		<AuthConfigFields {provider} />

		{#if !isConfigured}
			<!-- Add provider button for unconfigured providers -->
			<SettingItem name="" desc="">
				<div class="flex items-center gap-2">
					{#if query.data !== undefined}
						<div
							class="flex items-center gap-2 text-sm mr-auto"
							class:text-[--text-success]={query.data.auth.success}
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
			</SettingItem>
		{/if}
	</Accordion.Content>
</Accordion.Item>
