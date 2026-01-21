<script lang="ts">
import { getPlugin } from "../../stores/state.svelte";
import { isValidSecretId, setSecret } from "../../lib/secretStorage";
import Button from "../ui/Button.svelte";
import Text from "../ui/Text.svelte";
import type { AddSecretModal } from "./AddSecretModal";
import SettingContainer from "./SettingContainer.svelte";

interface Props {
	modal: AddSecretModal;
	onSecretAdded: (secretId: string) => void;
}

const { modal, onSecretAdded }: Props = $props();

const plugin = getPlugin();

let secretId = $state("");
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
		desc="Unique identifier for this secret (lowercase letters, numbers, dashes)"
	>
		<Text
			inputType="text"
			placeholder="my-api-key"
			value={secretId}
			styles={secretId.length > 0 && !isValidId ? "!border-[--background-modifier-error]" : ""}
			blurFunc={(value) => (secretId = value)}
		/>
	</SettingContainer>

	<SettingContainer name="Secret Value" desc="The API key or secret value to store securely">
		<Text
			inputType="password"
			placeholder="sk-..."
			value={secretValue}
			blurFunc={(value) => (secretValue = value)}
		/>
	</SettingContainer>

	{#if error}
		<div class="setting-item">
			<div class="text-[--text-error] text-sm">{error}</div>
		</div>
	{/if}
</div>

<div class="modal-button-container">
	<Button buttonText="Cancel" onClick={() => modal.close()} />
	<Button buttonText="Save Secret" cta={true} disabled={!isValidId || !secretValue} onClick={handleSave} />
</div>
