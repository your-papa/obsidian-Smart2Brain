<!-- <script lang="ts">
import { onMount } from "svelte";
import { t } from "svelte-i18n";
import DropdownComponent from "../base/Dropdown.svelte";
import DotAnimation from "../base/DotAnimation.svelte";
import { data } from "../../store";
import type { Ollama } from "../../Providers/Ollama";

let model = "";
let isOllama: boolean;
let installedOllamaModels: string[] = [];
let ollama: Ollama;

onMount(async () => {
	ollama = $data.ollamaProvider;
	isOllama = await ollama.isSetup();
	installedOllamaModels = await ollama.getModels();
});
</script> -->

<!-- <div class="modal-title">{$t('cmd.remove_model')}</div>
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
                        await ollama.deleteOllamaModel(model);
                        installedOllamaModels = await ollama.getModels();
                    }}>{$t('general.delete')}</button
                >
            </div>
        </div>
    {/if}
</div> -->
