<script lang="ts">
import SettingItem from "../../components/settings/SettingItem.svelte";
import Button from "../../components/ui/Button.svelte";
import Text from "../../components/ui/Text.svelte";
import Toggle from "../../components/ui/Toggle.svelte";
import type SecondBrainPlugin from "../../main";
import type { CustomProviderMeta } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import type { CustomProviderSetupModal } from "./CustomProviderSetup";

interface Props {
	modal: CustomProviderSetupModal;
	plugin: SecondBrainPlugin;
}

const { modal, plugin }: Props = $props();

const data = getData();

// Form state
let displayName = $state("");
let supportsEmbeddings = $state(false);
let baseUrl = $state("");
let apiKey = $state("");

// Validation
let isValid = $derived(displayName.trim() !== "" && baseUrl.trim() !== "");

// Generate a UUID for the custom provider
function generateId(): string {
	return crypto.randomUUID();
}

async function handleAddProvider() {
	if (!isValid) return;

	const providerId = generateId();
	console.log("[CustomProviderSetup] Adding provider:", {
		providerId,
		displayName,
		baseUrl,
		hasApiKey: !!apiKey.trim(),
		supportsEmbeddings,
	});

	// Create the custom provider metadata
	const meta: CustomProviderMeta = {
		displayName: displayName.trim(),
		supportsEmbeddings,
	};

	// Add the custom provider (creates both meta and state)
	await data.addCustomProvider(providerId, meta);

	// Set the base URL
	data.setProviderAuthField(providerId, "baseUrl", baseUrl.trim(), false);

	// If API key provided, store it as a secret
	if (apiKey.trim()) {
		data.setProviderAuthField(providerId, "apiKey", apiKey.trim(), true);
	}

	modal.close();
}
</script>

<div class="modal-content">
	<div class="setting-item">
		<div class="setting-item-description">
			Add a custom provider that uses an OpenAI-compatible API endpoint.
			This allows you to connect to local LLMs (like Ollama, LM Studio) or
			other API providers that implement the OpenAI API format.
		</div>
	</div>

	<SettingItem name="Display Name" desc="A name to identify this provider">
		<Text
			inputType="text"
			bind:value={displayName}
			placeholder="My Local LLM"
		/>
	</SettingItem>

	<SettingItem name="Base URL" desc="The OpenAI-compatible API endpoint (required)">
		<Text
			inputType="text"
			bind:value={baseUrl}
			placeholder="http://localhost:11434"
		/>
	</SettingItem>

	<SettingItem name="API Key" desc="API key for authentication (optional)">
		<Text
			inputType="password"
			bind:value={apiKey}
			placeholder="sk-..."
		/>
	</SettingItem>

	<SettingItem name="Supports Embeddings" desc="Enable if this provider supports embedding models">
		<Toggle bind:checked={supportsEmbeddings} />
	</SettingItem>
</div>

<div class="modal-button-container">
	<Button buttonText="Cancel" onClick={() => modal.close()} />
	<Button
		buttonText="Add Provider"
		cta={true}
		disabled={!isValid}
		onClick={handleAddProvider}
	/>
</div>
