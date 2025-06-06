<!-- @migration-task Error while migrating Svelte code: Can't migrate code with afterUpdate. Please migrate by hand. -->
<script lang="ts">
    import { Notice } from 'obsidian';
    import { renderMarkdown, icon } from '../../controller/Messages';
    import OllamaSetup from './OllamaSetup.svelte';
    import { date, t } from 'svelte-i18n';
    import { afterUpdate } from 'svelte';
    import { data } from '../../store';

    export let osType: string;
    export let scrollToBottom = () => {};

    afterUpdate(() => {
        scrollToBottom();
    });

    let isRunning: boolean = false;
    let isOllamaTested: boolean = false;
</script>

<ol class="w-full pr-10 *:p-1">
    <li>
        {$t('onboarding.ollama.app.download')}
        <a href="https://ollama.ai/download">{$t('onboarding.ollama.app.download_link')} </a>
    </li>
    {#if osType === 'Darwin'}
        <li>{$t('onboarding.ollama.app.extract')}</li>
    {:else}
        <li>{$t('onboarding.ollama.app.run')}</li>
    {/if}
    <li>
        <div class="flex flex-wrap items-center justify-between">
            <span class="mr-2">{$t('onboarding.ollama.app.test_label')}</span>
            <div class="flex items-center gap-1">
                {#if isOllamaTested}
                    {#if isRunning}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-success]" use:icon={'check'} />
                    {:else}
                        <div class="h-[28px] *:!h-[28px] *:!w-[28px] *:text-[--background-modifier-error]" use:icon={'cross'} />
                    {/if}
                {/if}
                {#if !isRunning}
                    <button
                        aria-label={$t('onboarding.ollama.app.test_label')}
                        on:click={async () => {
                            isRunning = await $data.ollamaProvider.isSetup();
                            isOllamaTested = true;
                            if (!isRunning) new Notice($t('notice.ollama_not_running'), 4000);
                        }}>{$t('onboarding.test')}</button
                    >
                {/if}
            </div>
        </div>
    </li>
    {#if isRunning}
        {#if osType === 'Darwin'}
            <li>{$t('onboarding.ollama.app.set_origins')}</li>
            <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\nlaunchctl setenv OLLAMA_ORIGINS "*"\n```')} />
            <li>
                {$t('onboarding.ollama.app.restart')}<span aria-label={$t('onboarding.ollama.app.restart_label')} use:icon={'help-circle'} />
            </li>
        {:else if osType === 'Windows_NT'}
            <li>{$t('onboarding.ollama.app.quit')}<span aria-label={$t('onboarding.ollama.app.quit_label')} use:icon={'help-circle'} /></li>
            <li>{$t('onboarding.ollama.app.start_origins')}</li>
            <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$env:OLLAMA_ORIGINS="*"; ollama serve\n```')} />
        {/if}
        <OllamaSetup {scrollToBottom} />
    {/if}
</ol>
