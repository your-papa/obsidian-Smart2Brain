<script lang="ts">
    import { t } from "svelte-i18n";
    import { registeredProviders, type RegisteredProvider } from "papa-ts";
    import SettingContainer from "../Settings/SettingContainer.svelte";
    import TextComponent from "../base/Text.svelte";
    import DropdownComponent from "../base/Dropdown.svelte";
    import Button from "../base/Button.svelte";
    import type { ProviderSetupModal } from "./ProviderSetup";
    import { getData } from "../../lib/data.svelte";
    import { createQuery, QueryClientProvider } from "@tanstack/svelte-query";
    import Icon from "../icons/Icon.svelte";
    import { getProviderIcon } from "../../lib/providerIcons";
    import type SecondBrainPlugin from "../../main";
    import { mount, onMount } from "svelte";
    import { icon } from "../../utils/utils";

    interface Props {
        modal: ProviderSetupModal;
        plugin: SecondBrainPlugin;
        selectedProvider: RegisteredProvider;
    }

    let { modal, plugin, selectedProvider }: Props = $props();

    const data = getData();

    const query = createQuery(() => ({
        queryKey: ["authState", selectedProvider],
        queryFn: async () =>
            await plugin.papa.providerRegistry
                .getProvider(selectedProvider)
                .setup(data.getProviderAuthParams(selectedProvider)),
    }));

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
            mount(Icon, {
                target: header,
                anchor: title,
                props: {
                    icon: getProviderIcon(selectedProvider),
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
    {#if data.getProviderAuthParams(selectedProvider)}
        {#each Object.entries(data.getProviderAuthParams(selectedProvider)) as [authKey, authValue]}
            <SettingContainer
                name={$t(`settings.provider.${authKey}`)}
                desc={$t(`settings.provider.${authKey}.desc`)}
            >
                <TextComponent
                    inputType="text"
                    value={authValue}
                    styles={authValue === ""
                        ? ""
                        : query.data
                          ? "!border-[--background-modifier-success]"
                          : "!border-[--background-modifier-error]"}
                    blurFunc={async (value: string) => {
                        (data.setProviderAuthParam as any)(
                            selectedProvider,
                            authKey,
                            value,
                        );
                        query.refetch();
                    }}
                />
            </SettingContainer>
        {/each}
    {/if}
</div>

<div class="modal-button-container">
    {query.status}
    {#if query.data !== undefined}
        <div
            class="flex items-center gap-2 rounded px-[--pill-padding-x] mr-auto"
            class:bg-green-100={query.data}
            class:bg-red-100={!query.data}
        >
            <div
                class="h-4 w-4"
                class:text-green-600={query.data}
                class:text-red-600={!query.data}
                use:icon={query.data ? "check" : "x"}
            ></div>
            <span>
                {query.data
                    ? "Provider authentication successful"
                    : "Provider authentication failed"}
            </span>
        </div>
    {/if}
    <Button buttonText="Cancel" onClick={() => modal.close()} />
    <Button
        buttonText="Add Provider"
        cta={true}
        disabled={!query.data}
        onClick={handleAddProvider}
    />
</div>
