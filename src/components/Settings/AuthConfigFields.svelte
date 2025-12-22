<script lang="ts">
    import SettingContainer from "./SettingContainer.svelte";
    import TextComponent from "../base/Text.svelte";
    import { getData } from "../../stores/dataStore.svelte";
    import {
        createAuthStateQuery,
        invalidateAuthState,
    } from "../../utils/query";
    import {
        providerFieldMeta,
        type RegisteredProvider,
    } from "../../types/providers";

    interface Props {
        provider: RegisteredProvider;
        showAdvanced?: boolean;
    }

    const { provider, showAdvanced = false }: Props = $props();

    const data = getData();
    const query = createAuthStateQuery(() => provider);

    const fieldMeta = providerFieldMeta[provider];
    const authParams = data.getProviderAuthParams(provider);
</script>

{#if authParams}
    {#each Object.entries(fieldMeta).filter( ([_, meta]) => (showAdvanced ? true : meta.required), ) as [fieldKey, meta]}
        <SettingContainer name={meta.label} desc={meta.helper ?? ""}>
            <TextComponent
                inputType={meta.kind === "password" ? "secret" : "text"}
                value={(authParams as any)[fieldKey] ?? ""}
                styles={((authParams as any)[fieldKey] ?? "") === ""
                    ? ""
                    : query.data?.success
                      ? "!border-[--background-modifier-success]"
                      : "!border-[--background-modifier-error]"}
                blurFunc={async (value: string) => {
                    (data.setProviderAuthParam as any)(
                        provider,
                        fieldKey,
                        value,
                    );
                    invalidateAuthState(provider);
                }}
            />
        </SettingContainer>
    {/each}
{/if}
