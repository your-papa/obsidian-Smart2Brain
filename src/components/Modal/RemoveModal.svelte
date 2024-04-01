<script lang="ts">
    import { onMount } from 'svelte';
    import { deleteOllamaModels, isOllamaRunning } from '../../controller/Ollama';
    import { t } from 'svelte-i18n';
    import { getOllamaModels } from '../../controller/Ollama';
    import DropdownComponent from '../base/Dropdown.svelte';
    import DotAnimation from '../base/DotAnimation.svelte';

    let model = '';
    let isOllama: boolean;
    let installedOllamaModels: string[] = [];

    onMount(async () => {
        installedOllamaModels = await getOllamaModels();
        isOllama = await isOllamaRunning();
    });
</script>

<div class="modal-title">{$t('cmd.remove_model')}</div>
<div class="modal-content">
    {#if isOllama === false}
        Ollama is Not Running
    {:else if isOllama === undefined}
        Loading
        <DotAnimation />
    {:else}
        <div class="mb-1 flex items-center justify-between">
            <div>
                <div class="setting-item-name">{$t('modal.remove.name')}</div>
                <div class="setting-item-description">{$t('modal.remove.desc')}</div>
            </div>
            <div class="flex flex-row justify-end gap-2">
                <DropdownComponent
                    options={installedOllamaModels.map((model) => ({ display: model, value: model }))}
                    selected={model}
                    changeFunc={(e) => (model = e)}
                />
                <button
                    class="mod-warning"
                    on:click={async () => {
                        await deleteOllamaModels(model);
                        installedOllamaModels = await getOllamaModels();
                    }}>{$t('general.delete')}</button
                >
            </div>
        </div>
    {/if}
</div>
