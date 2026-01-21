<script lang="ts">
import { Tooltip } from "bits-ui";
import { Notice } from "obsidian";
import { listSecrets } from "../../lib/secretStorage";
import { getPlugin } from "../../stores/state.svelte";
import { AddSecretModal } from "../settings/AddSecretModal";
import Button from "./Button.svelte";
import Dropdown from "./Dropdown.svelte";

interface Props {
	value: string;
	onChange: (secretId: string) => void;
}

const { value, onChange }: Props = $props();

const plugin = getPlugin();

// Get list of available secrets
let secrets = $state<string[]>([]);
let hasNotifiedMissing = $state(false);

function refreshSecrets() {
	try {
		secrets = listSecrets(plugin.app);
	} catch (e) {
		console.error("Failed to list secrets:", e);
		secrets = [];
	}
}

// Initial load
refreshSecrets();

// Check if configured secret is missing and notify user
let secretMissing = $derived(value && value.length > 0 && secrets.length > 0 && !secrets.includes(value));

$effect(() => {
	if (secretMissing && !hasNotifiedMissing) {
		new Notice(`Secret "${value}" not found in Obsidian Keychain. Please select or create a new secret.`);
		hasNotifiedMissing = true;
	}
});

// Handle dropdown selection
function handleSelect(secretId: string) {
	hasNotifiedMissing = false;
	onChange(secretId);
}

// Open modal to add a new secret
function handleAddSecret() {
	new AddSecretModal(plugin, (newSecretId) => {
		refreshSecrets();
		hasNotifiedMissing = false;
		onChange(newSecretId);
	}).open();
}

// Dropdown options
let dropdownOptions = $derived(
	secrets.map((secretId) => ({
		display: secretId,
		value: secretId,
	})),
);

// Selected value - fallback to first secret if configured one is missing
let selectedValue = $derived(secrets.includes(value) ? value : (secrets[0] ?? ""));
</script>

<div class="flex items-center gap-2">
	<Tooltip.Provider>
		<Tooltip.Root delayDuration={300}>
			<Tooltip.Trigger class="clickable-icon" onclick={handleAddSecret}>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					side="top"
					sideOffset={5}
					class="z-50 rounded bg-[--background-modifier-hover] px-2 py-1 text-xs shadow-md"
				>
					Add new secret
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>

	{#if secrets.length > 0}
		<Dropdown
			type="options"
			dropdown={dropdownOptions}
			selected={selectedValue}
			onSelect={handleSelect}
			class="flex-1"
		/>
	{:else}
		<span class="text-[--text-muted] text-sm">No secrets available</span>
	{/if}
</div>
