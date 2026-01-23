<script lang="ts">
import { Accordion } from "bits-ui";
import type { Component } from "svelte";
import { createProviderStateQuery, invalidateProviderState } from "../../lib/query";
import { getProvider } from "../../providers/index";
import type { LogoProps } from "../../providers/types";
import { getData } from "../../stores/dataStore.svelte";
import Button from "../ui/Button.svelte";
import Toggle from "../ui/Toggle.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
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

// Get the logo component for the provider (fallback to GenericAIIcon)
// Logo is only available on BuiltInProviderDefinition, not StoredCustomProviderDefinition
let Logo: Component<LogoProps> = $derived.by(() => {
	if (providerDefinition && "logo" in providerDefinition && providerDefinition.logo) {
		return providerDefinition.logo;
	}
	return GenericAIIcon;
});

// Advanced options state
let showAdvanced = $state(false);

// Check if provider has any optional auth fields
let hasOptionalFields = $derived(() => {
	if (providerDefinition?.auth.type !== "field-based") return false;
	return Object.values(providerDefinition.auth.fields).some((field) => field.required === false);
});

// Check if any optional fields have configured values
let hasOptionalFieldsConfigured = $derived(() => {
	if (!hasOptionalFields()) return false;
	const storedAuth = data.getStoredAuthState(provider);
	if (!storedAuth || storedAuth.type !== "field-based") return false;

	const authFields = providerDefinition?.auth.type === "field-based" ? providerDefinition.auth.fields : null;
	if (!authFields) return false;

	// Check if any optional field has a value in either values or secretIds
	return Object.entries(authFields).some(([fieldKey, field]) => {
		if (field.required !== false) return false;
		const hasValue = storedAuth.values[fieldKey] && storedAuth.values[fieldKey] !== "";
		const hasSecretId = storedAuth.secretIds[fieldKey] && storedAuth.secretIds[fieldKey] !== "";
		return hasValue || hasSecretId;
	});
});

// Auto-expand advanced when optional fields have configured values
$effect(() => {
	if (hasOptionalFieldsConfigured()) {
		showAdvanced = true;
	}
});
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
			<Logo width={16} height={16} />
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

		<!-- Advanced options toggle -->
		{#if hasOptionalFields()}
			<SettingItem name="Advanced Options" desc="Show optional configuration fields">
				<Toggle bind:checked={showAdvanced} />
			</SettingItem>
		{/if}

		<!-- Auth configuration fields -->
		<AuthConfigFields {provider} {showAdvanced} />

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
