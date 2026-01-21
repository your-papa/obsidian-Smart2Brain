<script lang="ts">
import { Accordion } from "bits-ui";
import ProviderItem from "../../components/Settings/ProviderItem.svelte";
import SettingContainer from "../../components/Settings/SettingContainer.svelte";
import { getData } from "../../stores/dataStore.svelte";
import { type RegisteredProvider, registeredProviders } from "../../types/providers";

const data = getData();

let configuredProviders = $derived(data.getConfiguredProviders());

let activeProvider: RegisteredProvider | undefined = $state(undefined);

const onAccordionClick = (provider: RegisteredProvider) => {
	activeProvider = activeProvider === provider ? undefined : provider;
};

// Sort providers: configured first, then unconfigured
let sortedProviders = $derived(
	[...registeredProviders].sort((a, b) => {
		const aConfigured = configuredProviders.includes(a);
		const bConfigured = configuredProviders.includes(b);
		if (aConfigured && !bConfigured) return -1;
		if (!aConfigured && bConfigured) return 1;
		return 0;
	}),
);
</script>

<Accordion.Root type="single" bind:value={activeProvider}>
	<SettingContainer isHeading={true} name="Provider Configuration" />

	{#each sortedProviders as provider (provider)}
		<ProviderItem {provider} {onAccordionClick} />
	{/each}
</Accordion.Root>
