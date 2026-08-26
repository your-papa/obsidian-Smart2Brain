<script lang="ts">
import { untrack } from "svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isValidSecretId, setSecret } from "../../lib/secretStorage";
import SettingContainer from "../settings/SettingContainer.svelte";
import Button from "../ui/Button.svelte";
import Text from "../ui/Text.svelte";
import type { AddSecretModal } from "./AddSecretModal";

interface Props {
	modal: AddSecretModal;
	onSecretAdded: (secretId: string) => void;
	/** Pre-filled ID derived from the opening context (provider, tool, ...). Still editable. */
	suggestedId?: string;
}

const { modal, onSecretAdded, suggestedId }: Props = $props();

const plugin = getPlugin();

// Seeded once, then owned by the input: the suggestion is a starting point the
// user is free to edit, not a value to stay in sync with.
let secretId = $state(untrack(() => suggestedId) ?? "");
let secretValue = $state("");
let error = $state("");

// Validate the secret ID in real-time
let isValidId = $derived(secretId.length > 0 && isValidSecretId(secretId));

function handleSave() {
	error = "";

	if (!secretId.trim()) {
		error = "Secret ID is required";
		return;
	}

	if (!isValidSecretId(secretId)) {
		error = "Invalid ID. Use lowercase letters, numbers, and dashes only (max 64 chars)";
		return;
	}

	if (!secretValue.trim()) {
		error = "Secret value is required";
		return;
	}

	try {
		setSecret(plugin.app, secretId, secretValue);
		onSecretAdded(secretId);
		modal.close();
	} catch (e) {
		error = `Failed to save secret: ${e}`;
	}
}

function openKeychainSettings() {
	modal.close();
	// @ts-ignore - Obsidian internal API
	const setting = plugin.app.setting;
	setting.open();
	setting.openTabById("keychain");
}
</script>

<div class="modal-content">
	<!-- Description -->
	<div class="setting-item-description mb-4">
		<p class="mb-2">
			Secrets are stored securely in Obsidian's Keychain, separate from plugin data. This allows you
			to share API keys across multiple plugins without storing them in plaintext.
		</p>
		<p>
			You can also manage your secrets in
			<button class="text-[--text-accent] hover:underline" onclick={openKeychainSettings}>
				Obsidian Settings &rarr; Keychain</button
			>.
		</p>
	</div>

	<SettingContainer
		name="Secret ID"
		desc={suggestedId
			? "Suggested from where you opened this. Edit it to reuse an ID across providers."
			: "Unique identifier for this secret (lowercase letters, numbers, dashes)"}
	>
		<Text
			inputType="text"
			placeholder="my-api-key"
			bind:value={secretId}
			styles={secretId.length > 0 && !isValidId ? "!border-[--background-modifier-error]" : ""}
		/>
	</SettingContainer>

	<SettingContainer name="Secret Value" desc="The API key or secret value to store securely">
		<Text inputType="password" placeholder="sk-..." bind:value={secretValue} />
	</SettingContainer>

	{#if error}
		<div class="setting-item">
			<div class="text-[--text-error] text-sm">{error}</div>
		</div>
	{/if}
</div>

<div class="modal-button-container">
	<Button buttonText="Cancel" onClick={() => modal.close()} />
	<Button buttonText="Save secret" cta={true} disabled={!isValidId || !secretValue} onClick={handleSave} />
</div>
