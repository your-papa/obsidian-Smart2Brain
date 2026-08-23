<script lang="ts">
import { Tooltip } from "bits-ui";
import { listSecrets } from "../../lib/secretStorage";
import { showActionNotice } from "../../utils/actionNotice";
import { getPlugin } from "../../stores/state.svelte";
import { Logger } from "../../utils/logging";
import { AddSecretModal } from "../settings/AddSecretModal";
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
let refreshAttempt = $state(0);

function refreshSecrets() {
	try {
		secrets = listSecrets(plugin.app);
	} catch (e) {
		Logger.error("Failed to list secrets:", e);
		secrets = [];
	}
}

// Initial load
refreshSecrets();

$effect(() => {
	value;
	refreshSecrets();
});

// Check if configured secret is missing and notify user
let secretMissing = $derived(value && value.length > 0 && secrets.length > 0 && !secrets.includes(value));

$effect(() => {
	if (secretMissing && !hasNotifiedMissing) {
		// Reuse the local handler rather than opening AddSecretModal directly: it also
		// refreshes the list and clears the notified/attempt flags on success.
		showActionNotice(
			`Secret "${value}" not found in Obsidian Keychain.`,
			{ label: "Add a secret", run: handleAddSecret },
			10000,
		);
		hasNotifiedMissing = true;
	}
});

$effect(() => {
	if (!value || !value.length || secrets.includes(value) || refreshAttempt >= 10) {
		return;
	}

	const timeout = window.setTimeout(() => {
		refreshSecrets();
		refreshAttempt += 1;
	}, 300);

	return () => window.clearTimeout(timeout);
});

// Handle dropdown selection
function handleSelect(secretId: string) {
	hasNotifiedMissing = false;
	refreshAttempt = 0;
	onChange(secretId);
}

// Open modal to add a new secret
function handleAddSecret() {
	new AddSecretModal(plugin, (newSecretId) => {
		refreshSecrets();
		hasNotifiedMissing = false;
		refreshAttempt = 0;
		onChange(newSecretId);
	}).open();
}

// Dropdown options
let dropdownOptions = $derived([
	{ display: "(Nothing selected)", value: "" },
	...secrets.map((secretId) => ({
		display: secretId,
		value: secretId,
	})),
]);

// Selected value - never auto-fallback to first secret
let selectedValue = $derived(secrets.includes(value) ? value : "");
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

  {#key `${selectedValue}:${dropdownOptions.length}:${refreshAttempt}`}
    <Dropdown
      type="options"
      dropdown={dropdownOptions}
      selected={selectedValue}
      onchange={handleSelect}
      class="flex-1"
    />
  {/key}
</div>
