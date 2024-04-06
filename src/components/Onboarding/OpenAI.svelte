<script lang="ts">
    import { Notice } from 'obsidian';
    import { icon, renderMarkdown } from '../../controller/Messages';
    import TextComponent from '../base/Text.svelte';
    import { plugin, data } from '../../store';
    import InitButtonComponent from './InitButton.svelte';
    import { t } from 'svelte-i18n';
    import { afterUpdate, onMount } from 'svelte';

    export let scrollToBottom = () => {};
    let isValid = false;
    let isKeyTested = false;

    onMount(async () => {
        $data.embedProvider = $data.openAIProvider;
        $data.genProvider = $data.openAIProvider;
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
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">{$t('onboarding.openai.paste_api_key')} </span>
            <TextComponent
                value={$data.openAIProvider.apiKey}
                placeholder="sk-...Lk"
                changeFunc={(value) => {
                    $data.openAIProvider.changeSetup(value);
                }}
            />
        </div>
    </li>
    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">{$t('onboarding.openai.test_api_key')}</span>
            <div class="flex items-center gap-1">
                {#if isKeyTested}
                    {#if isValid}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-success]" use:icon={'check'} />
                        <p class="m-0 text-sm">{$t('onboarding.openai.api_key_valid')}</p>
                    {:else}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-error]" use:icon={'cross'} />
                    {/if}
                {/if}
                {#if !isValid}
                    <button
                        aria-label={$t('onboarding.openai.test_api_key')}
                        on:click={async () => {
                            isValid = await $data.openAIProvider.isSetup();
                            if (!isValid) new Notice($t('notice.api_key_invalid'), 4000);
                            isKeyTested = true;
                        }}>{$t('onboarding.test')}</button
                    >
                {/if}
            </div>
        </div>
    </li>
</ol>
{#if isValid}
    <div class="w-full text-center">
        <InitButtonComponent />
    </div>
{/if}
