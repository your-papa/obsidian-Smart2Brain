<script lang="ts">
    import { renderMarkdown, icon } from '../../controller/Messages';
    import { isOllamaRunning } from '../../controller/Ollama';
    import OllamaSetup from './OllamaSetup.svelte';
    export let osType: string;

    let isRunning: boolean = false;
    let isClicked: boolean = false;
</script>

<ol class="max-w-fit *:p-1">
    <li>
        Download the App
        <a href="https://ollama.ai/download">here</a>
    </li>
    {#if osType === 'Darwin'}
        <li>Extract the .zip and start Ollama</li>
    {:else}
        <li>Run the setup.exe</li>
    {/if}
    <li>Test if Ollama is running:</li>
    <div class="w-full !pr-10 text-center">
        <button
            on:click={async () => {
                isClicked = true;
                isRunning = await isOllamaRunning();
            }}>Test</button
        >
    </div>
    {#if !isRunning && isClicked}
        <div class="flex items-center gap-5">
            <div class="h-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] *:text-[--background-modifier-error]" use:icon={'cross'} />
            <p class="m-0 text-sm">Ollama is not working!</p>
        </div>
    {/if}
    {#if isRunning}
        <div class="flex items-center gap-5">
            <div class="h-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] *:text-[--background-modifier-success]" use:icon={'check'} />
            <p class="m-0 text-sm">Ollama is running!</p>
        </div>
        {#if osType === 'Darwin'}
            <li>Set Ollama origins to enable streaming responses</li>
            <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$ launchctl setenv OLLAMA_ORIGINS "*"\n```')} />
            <li>
                Restart the Ollama service <span aria-label="click menu bar icon and then quit" use:icon={'help-circle'} />
            </li>
        {:else}
            <li>Quit Ollama <span aria-label="click on it in the task bar" use:icon={'help-circle'} /></li>
            <li>Start the Ollama service with origins</li>
            <div class="w-max max-w-full text-xs *:flex *:rounded *:pr-1" use:renderMarkdown={(this, '```bash\n$ env:OLLAMA_ORIGINS="*"; ollama serve\n```')} />
        {/if}
        <OllamaSetup />
    {/if}
</ol>
