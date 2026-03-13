<script lang="ts">
import { Notice } from "obsidian";
import type { Component } from "svelte";
import { createProviderStateQuery, invalidateProviderState } from "../../lib/query";
import { type LogoProps, getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import GenericAIIcon from "../ui/logos/GenericAIIcon.svelte";
import Button from "../ui/Button.svelte";
import CircularLoader from "../ui/CircularLoader.svelte";
import { ProviderSetupModal } from "../../views/provider-setup/ProviderSetup";

interface Props {
	provider: string;
}

const { provider }: Props = $props();

const data = getData();
const plugin = getPlugin();
let providerDefinition = $derived(getProviderDefinition(provider, data.getAllProviderMeta()));

const query = createProviderStateQuery(() => provider);
let isCheckingAuth = $derived(query.isPending || query.isFetching);
let displayName = $derived(providerDefinition?.displayName ?? provider);
let Logo: Component<LogoProps> = $derived.by(() => {
	if (providerDefinition?.logo) {
		return providerDefinition.logo;
	}
	return GenericAIIcon;
});

function refetch() {
	invalidateProviderState(provider);
}

function handleOpenSettings() {
	new ProviderSetupModal(plugin, provider).open();
}

async function handleRemoveProvider() {
	try {
		await data.deleteProvider(provider);
		invalidateProviderState(provider);
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Failed to remove provider");
	}
}
</script>

<div class="setting-item provider-row">
	<div class="setting-item-info">
		<div class="setting-item-name flex items-center gap-2">
			<Logo width={16} height={16} />
			<span>{displayName}</span>
			{#if isCheckingAuth}
				<div class="flex items-center gap-1 text-[--text-muted]" title="Checking authentication">
					<CircularLoader size={12} color="var(--text-muted)" />
				</div>
			{:else if query.data?.auth.success}
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
		</div>
	</div>
	<div class="setting-item-control flex items-center gap-1">
		<Button
			iconId="settings"
			tooltip="Configure provider"
			onClick={handleOpenSettings}
			stopPropagation={true}
		/>
		<Button
			iconId="trash"
			styles="hover:text-[--text-error]"
			tooltip="Remove provider"
			onClick={() => void handleRemoveProvider()}
			stopPropagation={true}
		/>
	</div>
</div>
