<script lang="ts">
    import { onMount } from 'svelte';
    import TextComponent from '../base/Text.svelte';
    import { renderMarkdown } from '../../controller/Messages';
    import { plugin, data } from '../../store';
    import { changeOllamaBaseUrl } from '../../controller/Ollama';
    import OllamaSetup from './OllamaSetup.svelte';
    import { t } from 'svelte-i18n';

    export let osType: string;
    export let scrollToBottom = () => {};

    onMount(() => {
        $data.isIncognitoMode = true;
        $plugin.saveSettings();
    });
</script>

<ol class="w-full pr-10 *:p-1">
    <li>{$t('onboarding.ollama.deamon.install')}</li>
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
            <span class="mr-2">{$t('onboarding.ollama.deamon.set_baseurl')}</span>
            <TextComponent value={$data.ollamaEmbedModel.baseUrl} placeholder="http://localhost:11434" changeFunc={changeOllamaBaseUrl} />
        </div>
    </li>
    <li>{$t('onboarding.ollama.deamon.start')}</li>
    <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\OLLAMA_ORIGINS="app://obsidian.md*" ollama serve\n```')} />
    <OllamaSetup {scrollToBottom} />
</ol>
