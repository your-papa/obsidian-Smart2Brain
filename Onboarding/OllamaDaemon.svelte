<script lang="ts">
    import TextComponent from '../base/Text.svelte';
    import { renderMarkdown } from '../../controller/Messages';
    import { plugin, data } from '../../store';
    import OllamaSetup from './OllamaSetup.svelte';
    import { t } from 'svelte-i18n';

    interface Props {
        osType: string;
        scrollToBottom?: any;
    }

    let { osType, scrollToBottom = () => {} }: Props = $props();

    onMount(() => {
        $plugin.saveSettings();
    });
</script>

<ol class="w-full pr-10 *:p-1">
    <li>{$t('onboarding.ollama.deamon.install')}</li>
    {#if osType === 'Darwin'}
        <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\nbrew install ollama\n```')}></div>
    {:else if osType === 'Linux'}
        <div
            class="w-max max-w-full text-xs *:flex *:rounded *:pr-1"
            use:renderMarkdown={(this, '```bash\n$ curl -fsSL https://ollama.ai/install.sh | sh\n```')}
></div>
    {/if}

    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">{$t('onboarding.ollama.deamon.set_baseurl')}</span>
            <TextComponent value={$data.ollamaProvider.baseUrl} placeholder="http://localhost:11434" changeFunc={$data.ollamaProvider.changeSetup} />
        </div>
    </li>
    <li>{$t('onboarding.ollama.deamon.start')}</li>
    <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\nOLLAMA_ORIGINS="*" ollama serve\n```')}></div>
    <OllamaSetup {scrollToBottom} />
</ol>
