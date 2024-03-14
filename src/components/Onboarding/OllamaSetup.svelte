<script lang="ts">
    import InitButtonComponent from './InitButton.svelte';
    import { onMount } from 'svelte';
    import { getOllamaModels } from '../../controller/Ollama';
    import { icon } from '../../controller/Messages';
    import { plugin, data } from '../../store';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { isOllamaOriginsSet } from '../../controller/Ollama';
    import { t } from 'svelte-i18n';
    import PullOllamaModel from './PullOllamaModel.svelte';

    let ollamaModels: string[] = [];
    let model: string = '';
    let ollamaModelComponent: DropdownComponent;
    let pullModel = 'nomic-embed-text';
    let isOriginsTested: boolean = false;
    let isOrigin: boolean = false;

    onMount(async () => {
        $data.isIncognitoMode = true;
        $plugin.saveSettings();
    });

    $: if (ollamaModelComponent && ollamaModels.some((model) => model === $data.ollamaEmbedModel.model)) model = $data.ollamaEmbedModel.model;
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
                        isOrigin = await isOllamaOriginsSet();
                        isOriginsTested = true;
                        ollamaModels = await getOllamaModels();
                    }}>{$t('onboarding.test')}</button
                >
            {/if}
        </div>
    </div>
</li>
{#if isOrigin}
    <li>
        {$t('onboarding.ollama.install_model')}<br />
        <div class="flex flex-wrap items-center justify-between">
            {$t('onboarding.ollama.recommended_models')}
            <input type="text" list="ollama-models" bind:value={pullModel} />
        </div>
        <PullOllamaModel {pullModel} onSuccessfulPull={async () => (ollamaModels = await getOllamaModels())} />
    </li>
    {#if ollamaModels.length > 0}
        <li>
            <div class="flex flex-wrap items-center justify-between">
                {$t('onboarding.ollama.set_model')}
                <div class="flex items-center gap-1">
                    <button class="clickable-icon mr-1" use:icon={'refresh-ccw'} on:click={async () => (ollamaModels = await getOllamaModels())} />
                    <DropdownComponent
                        bind:this={ollamaModelComponent}
                        selected={model}
                        options={ollamaModels.map((model) => ({ display: model, value: model }))}
                        changeFunc={(selected) => ($data.ollamaEmbedModel.model = selected)}
                    />
                </div>
            </div>
        </li>
    {/if}
    {#if model !== ''}
        <div class="mt-4 w-full text-center">
            <InitButtonComponent />
        </div>
    {/if}
{/if}
