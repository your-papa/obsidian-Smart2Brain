<script lang="ts">
    import { Notice } from 'obsidian';
    import { renderMarkdown, icon } from '../../controller/Messages';
    import { isOllamaRunning } from '../../controller/Ollama';
    import OllamaSetup from './OllamaSetup.svelte';
    export let osType: string;

    let isRunning: boolean = false;
    let isOllamaTested: boolean = false;
</script>

<ol class="w-full max-w-[500px] *:p-1 pr-10">
    <li>
        Download the App
        <a href="https://ollama.ai/download">here</a>
    </li>
    {#if osType === 'Darwin'}
        <li>Extract the .zip and start Ollama</li>
    {:else}
        <li>Run the setup.exe</li>
    {/if}
    <li>
        <div class="flex flex-wrap justify-between items-center">
            Test if Ollama is running:
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
                        aria-label="Test if Ollama is running"
                        on:click={async () => {
                            isRunning = await isOllamaRunning();
                            isOllamaTested = true;
                            if (!isRunning) new Notice('Ollama is not running!', 4000);
                        }}>Test</button
                    >
                {/if}
            </div>
        </div>
    </li>
    {#if isRunning}
        {#if osType === 'Darwin'}
            <li>Set Ollama origins to enable streaming responses</li>
            <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\nlaunchctl setenv OLLAMA_ORIGINS "*"\n```')} />
            <li>
                Restart the Ollama service <span aria-label="click menu bar icon and then quit" use:icon={'help-circle'} />
            </li>
        {:else}
            <li>Quit Ollama <span aria-label="click on it in the task bar" use:icon={'help-circle'} /></li>
            <li>Start the Ollama service with origins</li>
            <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$env:OLLAMA_ORIGINS="*"; ollama serve\n```')} />
        {/if}
        <OllamaSetup />
    {/if}
</ol>
