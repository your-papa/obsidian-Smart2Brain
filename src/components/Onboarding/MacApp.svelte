<script lang="ts">
    import { getOllamaGenModel, isOllamaRunning, isOriginSet, ollamaEmbedChange } from '../../controller/Ollama';
    import { icon, renderMarkdown } from '../../controller/Messages';
    import { plugin } from '../../store';
    import DropdownComponent from '../base/Dropdown.svelte';
    import InitButtonComponent from './InitButton.svelte';

    let ollamaModels: { display: string; value: string }[] = [];
    let ollamaModelComponent: DropdownComponent;
    let model: string = '';

    let isRunning: boolean = false;
    let isOrigin: boolean = false;
</script>

<li>
    Download the MacOS App
    <a href="https://ollama.ai/download">here</a>
</li>
<li>Extract the .zip and start Ollama</li>
<li>
    <button
        disabled={isRunning}
        on:click={async () => {
            isRunning = await isOllamaRunning();
        }}>Test if ollama is running</button
    >
</li>
{#if isRunning}
    <div class="flex items-center gap-5">
        <p>Ollama is running!</p>
        <div class=" *:text-[--background-modifier-success]" use:icon={'check'} />
    </div>
    <li>Set Ollama origins to enable streaming responses</li>
    <p class="w-max *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$ launchctl setenv OLLAMA_ORIGINS "*"\n```')} />
    <li>Restart the Ollama service (click menu bar icon and then quit)</li>
    <li>
        <button
            on:click={async () => {
                isOrigin = await isOriginSet();
                ollamaModels = await getOllamaGenModel();
            }}>Check if Ollama is running and the origins are set correctly</button
        >
    </li>
    {#if isOrigin}
        <div class="flex items-center gap-5">
            <p>Origins are correctly set!</p>
            <div class=" *:text-[--background-modifier-success]" use:icon={'check'} />
        </div>
        <li>
            Install an Ollama Model and set it
            <div class="flex items-center gap-1">
                <button class="clickable-icon" use:icon={'refresh-ccw'} on:click={async () => (ollamaModels = await getOllamaGenModel())} />
                <DropdownComponent bind:this={ollamaModelComponent} selected={model} options={ollamaModels} changeFunc={ollamaEmbedChange} />
            </div>
        </li>
        {#if $plugin.data.ollamaEmbedModel.model}
            <InitButtonComponent />
        {/if}
    {/if}
{/if}
