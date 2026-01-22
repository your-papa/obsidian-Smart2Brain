<script lang="ts">
import { createAuthStateQuery, invalidateAuthState } from "../../lib/query";
import { getProvider } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import Text from "../ui/Text.svelte";
import SecretSelect from "./SecretSelect.svelte";
import SettingItem from "./SettingItem.svelte";

interface Props {
	provider: string;
	showAdvanced?: boolean;
}

const { provider, showAdvanced = false }: Props = $props();

const data = getData();

// Query for provider auth state
const query = createAuthStateQuery(() => provider);

// Get custom providers for provider lookup (stored format without runtime methods)
let customProviders = $derived(data.getCustomProviders().map((cp) => cp.definition));

// Get provider definition from registry
let providerDefinition = $derived(getProvider(provider, customProviders));

// Get stored auth state for this provider
let storedAuth = $derived(data.getStoredAuthState(provider));

// Get auth fields from provider definition (only for field-based auth)
let authFields = $derived(providerDefinition?.auth.type === "field-based" ? providerDefinition.auth.fields : null);

// Filter fields based on showAdvanced prop
// Required fields are always visible; optional fields only shown when showAdvanced is true
let visibleFields = $derived(() => {
	if (!authFields) return [];
	return Object.entries(authFields).filter(([_, field]) => (showAdvanced ? true : field.required));
});

// Get the current value for a field from stored auth
function getFieldValue(fieldKey: string): string {
	if (!storedAuth || storedAuth.type !== "field-based") return "";

	// For secret fields, return the secret ID (not the actual secret value)
	// The SecretSelect component will use this to show the correct selection
	if (storedAuth.secretIds[fieldKey]) {
		return storedAuth.secretIds[fieldKey];
	}

	// For non-secret fields, return the stored value
	return storedAuth.values[fieldKey] ?? "";
}

// Handle secret selection/change (for secret fields)
function handleSecretChange(fieldKey: string, secretId: string) {
	// Use the new unified method that handles both legacy and custom providers
	data.assignSecretIdToProviderField(provider, fieldKey, secretId);
	invalidateAuthState(provider);
}

// Handle text/textarea field changes (for non-secret fields)
function handleFieldChange(fieldKey: string, value: string) {
	data.setProviderAuthField(provider, fieldKey, value, false);
	invalidateAuthState(provider);
}

// Get validation state styling for a field
function getFieldStyles(fieldKey: string): string {
	const value = getFieldValue(fieldKey);
	if (value === "") return "";
	return query.data?.success ? "!border-[--background-modifier-success]" : "!border-[--background-modifier-error]";
}
</script>

{#if storedAuth && authFields}
	{#each visibleFields() as [fieldKey, field]}
		{#if field.kind === "secret"}
			<!-- Secret field using custom dropdown + add button -->
			<SettingItem name={field.label} desc="">
				<SecretSelect
					value={getFieldValue(fieldKey)}
					onChange={(value) => handleSecretChange(fieldKey, value)}
				/>
			</SettingItem>
		{:else if field.kind === "textarea"}
			<!-- Textarea field (e.g., headers JSON) -->
			<SettingItem name={field.label} desc="">
				<textarea
					class="setting-textarea w-full min-h-[80px] p-2 font-mono text-sm resize-y {getFieldStyles(fieldKey)}"
					placeholder={field.placeholder ?? ""}
					value={getFieldValue(fieldKey)}
					onblur={(e) => handleFieldChange(fieldKey, e.currentTarget.value)}
				></textarea>
			</SettingItem>
		{:else}
			<!-- Regular text field -->
			<SettingItem name={field.label} desc="">
				<Text
					inputType="text"
					value={getFieldValue(fieldKey)}
					placeholder={field.placeholder ?? ""}
					styles={getFieldStyles(fieldKey)}
					onblur={(value: string) => handleFieldChange(fieldKey, value)}
				/>
			</SettingItem>
		{/if}
	{/each}
{:else if providerDefinition?.auth.type === "oauth"}
	<!-- OAuth provider - show sign-in button -->
	<SettingItem name="Authentication" desc="Sign in to authenticate with this provider">
		<button
			class="mod-cta"
			onclick={() => {
				if (providerDefinition?.auth.type === "oauth") {
					providerDefinition.auth.startFlow().then(() => {
						invalidateAuthState(provider);
					});
				}
			}}
		>
			{providerDefinition.auth.buttonLabel}
		</button>
	</SettingItem>
{/if}
