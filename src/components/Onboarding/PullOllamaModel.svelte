<script lang="ts">
    import { Notice } from 'obsidian';
    import { data } from '../../store';
    import { pullOllamaModel } from '../../controller/Ollama';
    import { t } from 'svelte-i18n';
    import ProgressBar from '../base/ProgressBar.svelte';

    export let onSuccessfulPull: () => void = () => {};

    let isPullingModel = false;
    let total: number = 0;
    let progress: number = 0;
    let status: string = '';
    let isPullingError = false;

    async function pullOllamaModelStream() {
        isPullingModel = true;
        try {
            for await (const chunk of pullOllamaModel($data.ollamaGenModel.model)) {
                status = chunk.status;
                if (chunk.total) total = chunk.total;
                if (chunk.completed) progress = Math.floor((chunk.completed / total) * 100);
            }
            if (progress === 100) onSuccessfulPull();
            isPullingModel = false;
        } catch (e) {
            isPullingError = true;
            new Notice($t('notice.error_pulling_model', { values: { error: e.message } }));
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
    let index = 0;
    $: if (isPullingModel) {
        setTimeout(() => {
            index = (index + 1) % 4;
        }, 300);
    }
</script>

{#if !isPullingModel}
    <button on:click={() => pullOllamaModelStream()}>Install</button>
{:else}
    <div class="flex w-full justify-between">
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
    <ProgressBar {progress} />
{/if}
{#if isPullingError}
    <p>There was an error pulling the recommended model</p>
{/if}
