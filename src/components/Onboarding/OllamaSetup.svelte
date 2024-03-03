<script lang="ts">
    import InitButtonComponent from './InitButton.svelte';
    import { onMount } from 'svelte';
    import { getOllamaGenModels } from '../../controller/Ollama';
    import { icon } from '../../controller/Messages';
    import { plugin, isIncognitoMode } from '../../store';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { isOllamaOriginsSet } from '../../controller/Ollama';
    import PullOllamaModel from './PullOllamaModel.svelte';

    let model: string = '';
    let ollamaModels: string[] = [];
    let ollamaModelComponent: DropdownComponent;
    let pullModel = 'nomic-embed-text';
    let isOriginsTested: boolean = false;
    let isOrigin: boolean = false;

    onMount(() => {
        // TODO redundant with Settings.svelete
        $isIncognitoMode = true;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    });
    $: if (ollamaModelComponent && ollamaModels.some((model) => model === $plugin.data.ollamaEmbedModel.model)) model = $plugin.data.ollamaEmbedModel.model;
</script>

<li>
    <div class="flex flex-wrap items-center justify-between">
        <span class="mr-2">Test if the origins are set correctly:</span>
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
                        ollamaModels = await getOllamaGenModels();
                    }}>Test</button
                >
            {/if}
        </div>
    </div>
</li>
{#if isOrigin}
    <li>
        Install an Ollama Embedding Model. <br />
        <div class="flex flex-wrap items-center justify-between">
            Recomended:
            <input type="text" list="ollama-models" bind:value={pullModel} />
        </div>
        <PullOllamaModel />
    </li>
    {#if ollamaModels.length}
        <li>
            <div class="flex flex-wrap items-center justify-between">
                Set your embed Model:
                <div class="flex items-center gap-1">
                    <button class="clickable-icon mr-1" use:icon={'refresh-ccw'} on:click={async () => (ollamaModels = await getOllamaGenModels())} />
                    <DropdownComponent
                        bind:this={ollamaModelComponent}
                        selected={model}
                        options={ollamaModels.map((model) => ({ display: model, value: model }))}
                        changeFunc={(selected) => (model = selected)}
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
