<script lang="ts">
import type { Component } from "svelte";
import { mount, onMount } from "svelte";
import AuthConfigFields from "../../components/settings/AuthConfigFields.svelte";
import Button from "../../components/ui/Button.svelte";
import GenericAIIcon from "../../components/ui/logos/GenericAIIcon.svelte";
import { createAuthStateQuery, invalidateProviderState } from "../../lib/query";
import type SecondBrainPlugin from "../../main";
import { type LogoProps, getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import { icon } from "../../utils/utils";
import type { ProviderSetupModal } from "./ProviderSetup";

interface Props {
	modal: ProviderSetupModal;
	plugin: SecondBrainPlugin;
	selectedProvider: string;
}

const { modal, plugin, selectedProvider }: Props = $props();

const data = getData();

const query = createAuthStateQuery(() => selectedProvider);

function handleAddProvider() {
	data.setProviderConfigured(selectedProvider, true);
	invalidateProviderState(selectedProvider);
	modal.close();
}

// Get the logo component for the provider
function getProviderLogo(): Component<LogoProps> {
	const provider = getProviderDefinition(selectedProvider, data.getAllCustomProviderMeta());
	if (provider && "logo" in provider && provider.logo) {
		return provider.logo;
	}
	return GenericAIIcon;
}

// Function to create and append the header element
function appendHeaderElement() {
	const title = modal.titleEl;
	const header = title.parentElement;
	title.setCssStyles({
		marginBlock: "0",
	});
	header?.setCssStyles({
		display: "flex",
		flexDirection: "row",
		gap: "0.5rem",
		alignItems: "center",
		justifyItems: "start",
	});

	if (header) {
		const Logo = getProviderLogo();
		mount(Logo, {
			target: header,
			anchor: title,
			props: {
				width: 32,
				height: 32,
			},
		});

		return true;
	}
}

onMount(() => {
	appendHeaderElement();
});
</script>

<div class="modal-content">
    <div class="setting-item">
        <div class="setting-item-description">
            To use S2B with OpenAI, you need to add an API key. You can do this
            as follows.
            <li>
                Create a key by visiting <a
                    href="https://platform.openai.com/api-keys"
                    >OpenAI`s Dashboard</a
                >
            </li>
            <li>Ensure your OpenAI account is loaded up with credtis.</li>
            <li>
                Paste the API key below. It should start with '<strong
                    >sk-</strong
                >'.
            </li>
        </div>
    </div>
    <AuthConfigFields provider={selectedProvider} />
</div>

<div class="modal-button-container">
    {#if query.data !== undefined}
        <div
            class="flex items-center gap-2 rounded px-[--pill-padding-x] mr-auto"
            class:bg-green-100={query.data.success}
            class:bg-red-100={!query.data.success}
        >
            <div
                class="h-4 w-4"
                class:text-green-600={query.data.success}
                class:text-red-600={!query.data.success}
                use:icon={query.data.success ? "check" : "x"}
            ></div>
            <span>
                {#if query.data.success}
                    Provider authentication successful
                {:else}
                    {query.data.message}
                {/if}
            </span>
        </div>
    {/if}
    <Button buttonText="Cancel" onClick={() => modal.close()} />
    <Button
        buttonText="Add Provider"
        cta={true}
        disabled={!query.data?.success}
        onClick={handleAddProvider}
    />
</div>
