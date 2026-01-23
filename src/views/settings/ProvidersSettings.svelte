<script lang="ts">
import { Accordion } from "bits-ui";
import ProviderItem from "../../components/settings/ProviderItem.svelte";
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { CustomProviderSetupModal } from "../custom-provider-setup/CustomProviderSetup";

const data = getData();
const plugin = getPlugin();

// Get configured provider IDs from the data store
let configuredProviderIds = $derived(data.getConfiguredProviders());

// Active provider for accordion - now using string ID
let activeProvider: string | undefined = $state(undefined);

const onAccordionClick = (providerId: string) => {
	activeProvider = activeProvider === providerId ? undefined : providerId;
};

// Sort providers: configured first, then unconfigured
// All provider IDs = Object.keys(providerConfig)
let sortedProviders = $derived(
	data.getAllProviderIds().sort((a: string, b: string) => {
		const aConfigured = configuredProviderIds.includes(a);
		const bConfigured = configuredProviderIds.includes(b);
		if (aConfigured && !bConfigured) return -1;
		if (!aConfigured && bConfigured) return 1;
		return 0;
	}),
);

function handleAddCustomProvider() {
	new CustomProviderSetupModal(plugin).open();
}
</script>

<Accordion.Root type="single" bind:value={activeProvider}>
	{#each sortedProviders as provider (provider)}
		<ProviderItem {provider} {onAccordionClick} />
	{/each}
</Accordion.Root>

<SettingItem name="Custom Provider" desc="Add an OpenAI-compatible API endpoint">
	<Button
		buttonText="Add Custom Provider"
		onClick={handleAddCustomProvider}
	/>
</SettingItem>
