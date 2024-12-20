<!-- <script lang="ts">
    import InitButtonComponent from './InitButton.svelte';
    import { afterUpdate, onMount } from 'svelte';
    import { icon } from '../../controller/Messages';
    import { data } from '../../store';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { t } from 'svelte-i18n';
    import PullOllamaModel from './PullOllamaModel.svelte';
    export let scrollToBottom = () => {};

    afterUpdate(() => {
        scrollToBottom();
    });

    let ollamaModels: string[] = [];
    let model: string = '';
    let ollamaModelComponent: DropdownComponent;
    let pullModel = 'nomic-embed-text';
    let isOriginsTested: boolean = false;
    let isOrigin: boolean = false;

    onMount(async () => {
        $data.embedProvider = $data.ollamaProvider;
    });

    $: if (ollamaModelComponent && ollamaModels.some((model) => model === $data.embedModel)) model = $data.embedModel;
</script>

<li>
    <div class="flex flex-wrap items-center justify-between">
        <span class="mr-2">{$t('onboarding.ollama.test_origins')}</span>
        <div class="flex items-center gap-1">
            {#if isOriginsTested}
                {#if isOrigin}
                    <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-success]" use:icon={'check'} />
                {:else}
                    <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-error]" use:icon={'cross'} />
                {/if}
            {/if}
            {#if !isOrigin}
                <button
                    aria-label="Test if origins are set correctly"
                    on:click={async () => {
                        isOrigin = await $data.ollamaProvider.isSetup();
                        isOriginsTested = true;
                        ollamaModels = await $data.ollamaProvider.getModels();
                    }}>{$t('onboarding.test')}</button
                >
            {/if}
        </div>
    </div>
</li>
{#if isOrigin}
    <li>
        {$t('onboarding.ollama.install_model')}<br />
        <PullOllamaModel
            {pullModel}
            text={$t('onboarding.ollama.recommended')}
            onSuccessfulPull={async () => (ollamaModels = await $data.ollamaProvider.getModels())}
        />
    </li>
    {#if ollamaModels.length > 0}
        <li>
            <div class="flex flex-wrap items-center justify-between">
                {$t('onboarding.ollama.set_model')}
                <div class="flex items-center gap-1">
                    <button class="clickable-icon" use:icon={'refresh-ccw'} on:click={async () => (ollamaModels = await $data.ollamaProvider.getModels())} />
                    <DropdownComponent
                        bind:this={ollamaModelComponent}
                        selected={model}
                        options={ollamaModels.map((model) => ({ display: model, value: model }))}
                        changeFunc={(selected) => ($data.embedModel = selected)}
                    />
                </div>
            </div>
        </li>
    {/if}
    {#if model !== ''}
        <div class="my-4 w-full text-center">
            <InitButtonComponent />
        </div>
    {/if}
{/if} -->
