<script lang="ts">
    import { Notice } from 'obsidian';
    import { icon } from '../../controller/Messages';
    import { pullOllamaModel } from '../../controller/Ollama';
    import { t } from 'svelte-i18n';
    import ProgressBar from '../base/ProgressBar.svelte';
    import { cancelPullModel } from '../../store';
    import InputComponent from '../base/Text.svelte';
    import DotAnimation from '../base/DotAnimation.svelte';

    export let onSuccessfulPull: () => void = () => {};
    export let text = '';
    export let desc = '';
    export let pullModel: string = '';

    let isPullingModel = false;
    let total: number = 0;
    let progress: number = 0;
    let status: string = '';
    let isPullingError = false;
    console.log('pullModel', pullModel);

    async function pullOllamaModelStream() {
        isPullingModel = true;
        try {
            progress = 0;
            total = 0;
            for await (const chunk of pullOllamaModel(pullModel)) {
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
        $cancelPullModel = false;
    }
    function formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'Kb', 'Mb', 'Gb'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
</script>

{#if !isPullingModel}
    <div class="mb-1 flex items-center justify-between">
        <div>
            <div class="setting-item-name">{text}</div>
            <div class="setting-item-description">{desc}</div>
        </div>
        <div class="flex flex-row justify-end gap-2">
            <InputComponent styles="w-4/6" value={pullModel} changeFunc={(v) => (pullModel = v)} />
            <button on:click={() => pullOllamaModelStream()}>{$t('general.install')}</button>
        </div>
    </div>
{:else}
    <div class="flex w-full items-center gap-2">
        <div class="flex w-full flex-col">
            <div class="flex w-full justify-between">
                <div>
                    {status}
                    <DotAnimation />
                </div>
                {progress}% / {formatBytes(total)}
            </div>
            <ProgressBar {progress} />
        </div>
        <button
            use:icon={'x'}
            aria-label={$t('pullModel.cancel')}
            on:click={() => {
                $cancelPullModel = true;
            }}
            class="mb-1 h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
        />
    </div>
{/if}
{#if isPullingError}
    <p>There was an error pulling the recommended model</p>
{/if}
