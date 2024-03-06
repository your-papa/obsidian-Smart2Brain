<script lang="ts">
    import { onMount } from 'svelte';
    import TextComponent from '../base/Text.svelte';
    import { renderMarkdown } from '../../controller/Messages';
    import { plugin, isIncognitoMode } from '../../store';
    import { changeOllamaBaseUrl } from '../../controller/Ollama';
    import OllamaSetup from './OllamaSetup.svelte';

    export let osType: string;

    onMount(() => {
        $isIncognitoMode = true;
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    });
</script>

<ol class="w-full pr-10 *:p-1">
    <li>Install Ollama</li>
    {#if osType === 'Darwin'}
        <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\nbrew install ollama\n```')} />
    {:else if osType === 'Linux'}
        <div
            class="w-max max-w-full text-xs *:flex *:rounded *:pr-1"
            use:renderMarkdown={(this, '```bash\n$ curl -fsSL https://ollama.ai/install.sh | sh\n```')}
        />
    {/if}

    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">Set the BaseUrl</span>
            <TextComponent value={$plugin.data.ollamaEmbedModel.baseUrl} placeholder="http://localhost:11434" changeFunc={changeOllamaBaseUrl} />
        </div>
    </li>
    <li>Start the Ollama service with origins</li>
    <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\nOLLAMA_ORIGINS="*" ollama serve\n```')} />
    <OllamaSetup />
</ol>
