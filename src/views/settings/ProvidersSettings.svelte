<script lang="ts">
import { Accordion } from "bits-ui";
import ProviderItem from "../../components/settings/ProviderItem.svelte";
import { getProvider, listAllProviderIds } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";

const data = getData();

// Get configured provider IDs from the data store
let configuredProviderIds = $derived(data.getConfiguredProviderIds());

// Get all custom providers from the data store
let customProviders = $derived(data.getCustomProviders());

// Get custom provider definitions (stored format without runtime methods)
let customProviderDefinitions = $derived(customProviders.map((cp) => cp.definition));

// Active provider for accordion - now using string ID
let activeProvider: string | undefined = $state(undefined);

const onAccordionClick = (providerId: string) => {
	activeProvider = activeProvider === providerId ? undefined : providerId;
};

// Sort providers: configured first, then unconfigured
let sortedProviders = $derived(
	listAllProviderIds(customProviderDefinitions).sort((a, b) => {
		const aConfigured = configuredProviderIds.includes(a);
		const bConfigured = configuredProviderIds.includes(b);
		if (aConfigured && !bConfigured) return -1;
		if (!aConfigured && bConfigured) return 1;
		return 0;
	}),
);
</script>

<Accordion.Root type="single" bind:value={activeProvider}>
	{#each sortedProviders as provider (provider)}
		<ProviderItem {provider} {onAccordionClick} />
	{/each}
</Accordion.Root>
