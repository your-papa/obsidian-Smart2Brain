<script lang="ts">
    import InitButtonComponent from './InitButton.svelte';
    import ProgressBarComponent from '../base/ProgressBar.svelte';
    import { onMount } from 'svelte';
    import { getOllamaGenModels, pullOllamaModel } from '../../controller/Ollama';
    import { icon } from '../../controller/Messages';
    import { plugin, isIncognitoMode } from '../../store';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { Notice } from 'obsidian';
    import { isOllamaOriginsSet, ollamaEmbedChange } from '../../controller/Ollama';

    let model: string = '';
    let ollamaModels: { display: string; value: string }[] = [];
    let ollamaModelComponent: DropdownComponent;
    let pullModel = 'nomic-embed-text';
    let total: number = 0;
    let progress: number = 0;
    let status: string = '';
    let isPullingRecommendedModel = false;

    let isPullingError = false;
    let isProcessing = false;

    let isOriginsTested: boolean = false;

    let isOrigin: boolean = false;
    let index = 0;

    onMount(() => {
        // TODO redundant with Settings.svelete
        $isIncognitoMode = true;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    });
    $: if (ollamaModelComponent && ollamaModels.some((item) => item.value === $plugin.data.ollamaEmbedModel.model)) model = $plugin.data.ollamaEmbedModel.model;

    async function consumeStream() {
        console.log(pullModel);
        isProcessing = true;
        try {
            for await (const chunk of pullOllamaModel()) {
                status = chunk.status;
                if (chunk.total) total = chunk.total;
                console.log('total', total);
                if (chunk.completed) progress = Math.floor((chunk.completed / total) * 100);
            }
            isProcessing = false;
            ollamaModels = await getOllamaGenModels();
        } catch (e) {
            isPullingError = true;
            new Notice(e);
        }
    }
    function formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'Kb', 'Mb', 'Gb'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    $: if (isPullingRecommendedModel) {
        setTimeout(() => {
            index = (index + 1) % 4;
        }, 300);
        if (!isProcessing) index = 0;
    }
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
            <div>
                <input type="text" list="ollama-models" bind:value={pullModel} />
                <button
                    on:click={() => {
                        isPullingRecommendedModel = true;
                        consumeStream();
                    }}>Install</button
                >
            </div>
        </div>
    </li>
    {#if isPullingRecommendedModel}
        <div class="flex justify-between">
            <div>
                {status}
                {#each ['', '.', '..', '...'] as sequence, i}
                    {#if i === index}
                        {sequence}
                    {/if}
                {/each}
            </div>
            {progress}% / {formatBytes(total)}
        </div>
        <div>
            <ProgressBarComponent {progress} />
        </div>
    {:else if isPullingError}
        <p>There was an error pulling the recommended model</p>
    {/if}
    {#if ollamaModels.length}
        <li>
            <div class="flex flex-wrap items-center justify-between">
                Set your embed Model:
                <div class="flex items-center gap-1">
                    <button class="clickable-icon mr-1" use:icon={'refresh-ccw'} on:click={async () => (ollamaModels = await getOllamaGenModels())} />
                    <DropdownComponent bind:this={ollamaModelComponent} selected={model} options={ollamaModels} changeFunc={ollamaEmbedChange} />
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
