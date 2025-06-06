<script lang="ts">
    import { Notice } from 'obsidian';
    import { icon, renderMarkdown } from '../../controller/Messages';
    import TextComponent from '../base/Text.svelte';
    import { plugin, data } from '../../store';
    import { t } from 'svelte-i18n';
    import { afterUpdate, onMount } from 'svelte';
    import SettingContainer from '../Settings/SettingContainer.svelte';
    import { providers, setupStatus } from '../../store';
    import InitButton from './InitButton.svelte';

    export let scrollToBottom = () => {};
    let keyEmpty;
    let isKeyTested = false;
    let selectedProvider: 'OpenAI' | 'Ollama' = 'OpenAI';
    $: provider = $providers[selectedProvider];

    onMount(async () => {
        console.log(provider.getConnectionArgs().apiKey);
        keyEmpty = provider.getConnectionArgs()['api_key'].length == 0;
    });

    afterUpdate(() => {
        scrollToBottom();
    });
</script>

<ol class="w-full pr-10 *:p-1">
    <li>
        {$t('onboarding.openai.create_account')}
        <a href="https://platform.openai.com/signup">{$t('onboarding.openai.create_account_link')}</a>
    </li>
    <li>
        {$t('onboarding.openai.create_api_key')}
        <a href="https://platform.openai.com/account/api-keys">{$t('onboarding.openai.create_api_key_link')}</a>
    </li>
    <div class="" use:renderMarkdown={(this, $t('onboarding.openai.api_key_warning'))} />
    <li>
        {#if provider}
            {#each Object.entries(provider.getConnectionArgs()) as [cArgKey, connectionArgument]}
                <SettingContainer name={$t(`settings.provider.${cArgKey}`)} desc={$t(`settings.provider.${cArgKey}.desc`)}>
                    <TextComponent
                        bind:value={connectionArgument}
                        changeFunc={async (value) => {
                            console.log(value);
                            keyEmpty = value == undefined;
                            let connectionArgs = provider.setConnectionArgs({ [cArgKey]: value });
                            setupStatus.sync(selectedProvider, await provider.isSetuped());
                            await $plugin.syncProviders(selectedProvider, connectionArgs);
                        }}
                    />
                </SettingContainer>
            {/each}
        {/if}
    </li>
    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">{$t('onboarding.openai.test_api_key')}</span>
            <div class="flex items-center gap-1">
                {#if isKeyTested}
                    {#if $setupStatus[selectedProvider]}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-success]" use:icon={'check'} />
                        <p class="m-0 text-sm">{$t('onboarding.openai.api_key_valid')}</p>
                    {:else}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-error]" use:icon={'cross'} />
                    {/if}
                {/if}
                {#if !keyEmpty}
                    <button aria-label={$t('onboarding.openai.test_api_key')} on:click={() => (isKeyTested = true)}
                        >{$t('onboarding.openai.test_api_key')}</button
                    >
                {/if}
            </div>
        </div>
    </li>
</ol>
{#if !keyEmpty && isKeyTested && $setupStatus[selectedProvider]}
    <div class="w-full text-center">
        <InitButton embedProviderName={selectedProvider} />
    </div>
{/if}
