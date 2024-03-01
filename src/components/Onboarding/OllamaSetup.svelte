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

    let isClickedOrigin: boolean = false;

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

<li>Test if Ollama is running and the origins are set correctly</li>
<div class="w-full !pr-10 text-center">
    <button
        on:click={async () => {
            isOrigin = await isOllamaOriginsSet();
            isClickedOrigin = true;
            ollamaModels = await getOllamaGenModels();
        }}>Test</button
    >
</div>
{#if !isOrigin && isClickedOrigin}
    <div class="flex items-center gap-5">
        <div class="h-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] *:text-[--background-modifier-error]" use:icon={'cross'} />
        <p class="m-0 text-sm">Origins are not set correctly!</p>
    </div>
{/if}
{#if isOrigin}
    <div class="flex items-center gap-5">
        <div class="h-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] *:text-[--background-modifier-success]" use:icon={'check'} />
        <p class="m-0 text-sm">Origins are set correctly!</p>
    </div>
    <li>Install an Ollama Model. <br /> Recomended:</li>
    <div class="w-full !pr-10 text-center">
        <input type="text" list="ollama-models" bind:value={pullModel} />
        <button
            on:click={() => {
                isPullingRecommendedModel = true;
                consumeStream();
            }}>Install</button
        >
    </div>
    {#if isPullingRecommendedModel}
        <div class="flex justify-between">
            <div class="flex">
                <span>{status}</span>
                {#each ['', '.', '..', '...'] as sequence, i}
                    {#if i === index}
                        <span>
                            {sequence}
                        </span>
                    {/if}
                {/each}
            </div>
            <span>{progress}% / {formatBytes(total)}</span>
        </div>
        <div>
            <ProgressBarComponent {progress} />
        </div>
    {:else if isPullingError}
        <p>There was an error pulling the recommended model</p>
    {/if}
    <li>
        Set your embed Model:
        <div class="flex w-full justify-center !pr-10 pt-1">
            <button class="clickable-icon mr-1" use:icon={'refresh-ccw'} on:click={async () => (ollamaModels = await getOllamaGenModels())} />
            <DropdownComponent bind:this={ollamaModelComponent} selected={model} options={ollamaModels} changeFunc={ollamaEmbedChange} />
            <div class="h–[--icon-m] w-[--icon-m] bg-transparent" />
        </div>
    </li>
    {#if model !== ''}
        <div class="w-full !pr-10 !pt-5 text-center">
            <InitButtonComponent />
        </div>
    {/if}
{/if}
