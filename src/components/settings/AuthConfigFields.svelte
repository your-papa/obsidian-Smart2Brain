<script lang="ts">
import { createAuthStateQuery, invalidateAuthState } from "../../lib/query";
import { type AuthFieldDefinition, getProviderDefinition } from "../../providers/index";
import { getData } from "../../stores/dataStore.svelte";
import Text from "../ui/Text.svelte";
import Toggle from "../ui/Toggle.svelte";
import SecretSelect from "./SecretSelect.svelte";
import SettingItem from "./SettingItem.svelte";

interface Props {
	provider: string;
}

const { provider }: Props = $props();

const data = getData();

// Local state for advanced toggle
let showAdvanced = $state(false);

// Query for provider auth state
const query = createAuthStateQuery(() => provider);

// Get provider definition using the function from providers/index
let providerDefinition = $derived(getProviderDefinition(provider, data.getAllCustomProviderMeta()));

// Get stored auth state for this provider
let storedAuth = $derived(data.getStoredAuthState(provider));

// Get auth fields from provider definition
let authFields = $derived(providerDefinition?.auth ?? null);

// Split fields into required and optional
let requiredFields = $derived((): [string, AuthFieldDefinition][] => {
	if (!authFields) return [];
	return (Object.entries(authFields) as [string, AuthFieldDefinition][]).filter(([_, field]) => field.required);
});

let optionalFields = $derived((): [string, AuthFieldDefinition][] => {
	if (!authFields) return [];
	return (Object.entries(authFields) as [string, AuthFieldDefinition][]).filter(([_, field]) => !field.required);
});

let hasOptionalFields = $derived(optionalFields().length > 0);

// Auto-expand advanced when optional fields have configured values
$effect(() => {
	if (!storedAuth || !authFields) return;

	for (const [fieldKey, field] of Object.entries(authFields) as [string, AuthFieldDefinition][]) {
		if (!field.required) {
			const hasValue = storedAuth.values[fieldKey] || storedAuth.secretIds[fieldKey];
			if (hasValue) {
				showAdvanced = true;
				break;
			}
		}
	}
});

// Get the current value for a field from stored auth
function getFieldValue(fieldKey: string): string {
	if (!storedAuth) return "";

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

{#snippet fieldRenderer(fieldKey: string, field: AuthFieldDefinition)}
	{#if field.kind === "secret"}
		<!-- Secret field using custom dropdown + add button -->
		<SettingItem name={field.label} desc={field.description}>
			<SecretSelect
				value={getFieldValue(fieldKey)}
				onChange={(value) => handleSecretChange(fieldKey, value)}
			/>
		</SettingItem>
	{:else if field.kind === "textarea"}
		<!-- Textarea field (e.g., headers JSON) -->
		<SettingItem name={field.label} desc={field.description}>
			<textarea
				class="setting-textarea w-full min-h-[80px] p-2 font-mono text-sm resize-y {getFieldStyles(fieldKey)}"
				placeholder={field.placeholder ?? ""}
				value={getFieldValue(fieldKey)}
				onblur={(e) => handleFieldChange(fieldKey, e.currentTarget.value)}
			></textarea>
		</SettingItem>
	{:else}
		<!-- Regular text field -->
		<SettingItem name={field.label} desc={field.description}>
			<Text
				inputType="text"
				value={getFieldValue(fieldKey)}
				placeholder={field.placeholder ?? ""}
				styles={getFieldStyles(fieldKey)}
				onblur={(value: string) => handleFieldChange(fieldKey, value)}
			/>
		</SettingItem>
	{/if}
{/snippet}

{#if storedAuth && authFields}
	<!-- Required fields first -->
	{#each requiredFields() as [fieldKey, field]}
		{@render fieldRenderer(fieldKey, field)}
	{/each}

	<!-- Advanced toggle (only if there are optional fields) -->
	{#if hasOptionalFields}
		<SettingItem name="Advanced Options" desc="Show optional configuration fields">
			<Toggle bind:checked={showAdvanced} />
		</SettingItem>
	{/if}

	<!-- Optional fields (only when showAdvanced) -->
	{#if showAdvanced}
		{#each optionalFields() as [fieldKey, field]}
			{@render fieldRenderer(fieldKey, field)}
		{/each}
	{/if}
{/if}
