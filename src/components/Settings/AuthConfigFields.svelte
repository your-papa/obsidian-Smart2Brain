<script lang="ts">
import { getData } from "../../stores/dataStore.svelte";
import { type RegisteredProvider, providerFieldMeta } from "../../types/providers";
import { createAuthStateQuery, invalidateAuthState } from "../../utils/query";
import SecretSelect from "../base/SecretSelect.svelte";
import TextComponent from "../base/Text.svelte";
import SettingContainer from "./SettingContainer.svelte";

interface Props {
	provider: RegisteredProvider;
	showAdvanced?: boolean;
}

const { provider, showAdvanced = false }: Props = $props();

const data = getData();
const query = createAuthStateQuery(() => provider);

// Use $derived to properly react to provider changes
const fieldMeta = $derived(providerFieldMeta[provider]);
const storedAuth = $derived(data.getStoredProviderAuthParams(provider));

// Get the mapped field key for storage (apiKey -> apiKeyId)
function getStoredFieldKey(fieldKey: string): string {
	if (fieldKey === "apiKey") return "apiKeyId";
	return fieldKey;
}

// Handle secret selection/change
function handleSecretChange(fieldKey: string, secretId: string) {
	if (fieldKey === "apiKey") {
		data.assignSecretToProvider(provider, secretId);
		invalidateAuthState(provider);
	}
}
</script>

{#if storedAuth}
	{#each Object.entries(fieldMeta).filter(([_, meta]) => (showAdvanced ? true : meta.required)) as [fieldKey, meta]}
		{#if meta.kind === "password"}
			<!-- Secret field using custom dropdown + add button -->
			<SettingContainer name={meta.label} desc={meta.helper ?? "Select or add a secret"}>
				<SecretSelect
					value={(storedAuth as Record<string, string>)[getStoredFieldKey(fieldKey)] ?? ""}
					onChange={(value) => handleSecretChange(fieldKey, value)}
				/>
			</SettingContainer>
		{:else}
			<!-- Regular text field -->
			<SettingContainer name={meta.label} desc={meta.helper ?? ""}>
				<TextComponent
					inputType="text"
					value={(storedAuth as Record<string, string>)[fieldKey] ?? ""}
					styles={((storedAuth as Record<string, string>)[fieldKey] ?? "") === ""
						? ""
						: query.data?.success
							? "!border-[--background-modifier-success]"
							: "!border-[--background-modifier-error]"}
					blurFunc={(value: string) => {
						data.setStoredAuthParam(provider, fieldKey as keyof typeof storedAuth, value as never);
						invalidateAuthState(provider);
					}}
				/>
			</SettingContainer>
		{/if}
	{/each}
{/if}
