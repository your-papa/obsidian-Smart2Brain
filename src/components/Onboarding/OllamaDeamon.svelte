<script lang="ts">
    import { onMount } from 'svelte';
    import SliderComponent from '../base/Slider.svelte';
    import InitButtonComponent from './InitButton.svelte';
    import TextComponent from '../base/Text.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { renderMarkdown, icon } from '../../controller/Messages';
    import { plugin, isIncognitoMode } from '../../store';
    import { getOllamaGenModel, changeOllamaBaseUrl, isOriginSet, ollamaEmbedChange } from '../../controller/Ollama';

    export let osType: 'Linux' | 'Darwin' | 'Windows_NT';
    let ollamaModels: { display: string; value: string }[] = [];
    let selected: 'brew' | 'curl' | 'binaries';
    let componentBaseUrl: TextComponent;
    let isOrigin: boolean = false;
    let model: string;
    let ollamaModelComponent: DropdownComponent;

    onMount(() => {
        $isIncognitoMode = true;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    });

    $: if (componentBaseUrl) componentBaseUrl.setInputValue($plugin.data.ollamaEmbedModel.baseUrl);
    $: if (ollamaModelComponent) model = $plugin.data.ollamaEmbedModel.model;
</script>

<ol>
    <li>Install Ollama through one of these options:</li>
    {#if osType === 'Darwin'}
        <SliderComponent options={['brew', 'curl', 'binaries']} bind:selected />
    {:else if osType === 'Linux'}
        <SliderComponent options={['curl', 'binaries']} bind:selected />
    {:else if osType === 'Windows_NT'}
        <p>Currently only available for WSL check the <a href="https://github.com/ollama/ollama">Ollama Pages</a></p>
    {/if}
    {#if selected === 'brew'}
        <p class="m-0 w-max *:m-0 *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$ brew install ollama\n```')} />
    {:else if selected === 'curl'}
        <p class=" m-0 w-max *:m-0 *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$ curl -fsSL https://ollama.ai/install.sh | sh\n```')} />
    {:else if selected === 'binaries'}
        <p
            class="m-0 flex w-max rounded bg-[--code-background] *:*:p-4"
            use:renderMarkdown={(this, "[Follow these instructions]('https://github.com/ollama/ollama/blob/main/docs/linux.md')")}
        />
    {/if}
    <li>
        Set the BaseUrl if it deviates from the default
        <TextComponent bind:this={componentBaseUrl} placeholder="http://localhost:11434" changeFunc={changeOllamaBaseUrl} />
    </li>
    <li class="w-max *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$ OLLAMA_ORIGINS="*" ollama serve\n```')}>
        Start the Ollama service with origins.
    </li>
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
</ol>
