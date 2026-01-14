<script lang="ts">
import AuthConfigFields from "../../components/Settings/AuthConfigFields.svelte";
import Button from "../../components/base/Button.svelte";
import type { ProviderSetupModal } from "./ProviderSetup";
import { getData } from "../../stores/dataStore.svelte";
import type SecondBrainPlugin from "../../main";
import ProviderIcon from "../../components/icons/ProviderIcon.svelte";
import { mount, onMount } from "svelte";
import { icon } from "../../utils/utils";
import type { RegisteredProvider } from "../../types/providers";
import { createAuthStateQuery } from "../../utils/query";

interface Props {
	modal: ProviderSetupModal;
	plugin: SecondBrainPlugin;
	selectedProvider: RegisteredProvider;
}

const { modal, plugin, selectedProvider }: Props = $props();

const data = getData();

const query = createAuthStateQuery(() => selectedProvider);

function handleAddProvider() {
	data.toggleProviderIsConfigured(selectedProvider);
	modal.close();
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
		mount(ProviderIcon, {
			target: header,
			anchor: title,
			props: {
				providerName: selectedProvider,
				size: {
					height: 32,
					width: 32,
				},
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
