<script lang="ts">
    import { isOllamaRunning, isOriginSet } from '../../controller/Ollama';
    import { icon, renderMarkdown } from '../../controller/Messages';
    import { plugin } from '../../store';

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
        <button on:click={async () => (isOrigin = await isOriginSet())}>Check if the origins are set correctly</button>
    </li>
    {#if isOrigin}
        <div class="flex items-center gap-5">
            <p>Origins are correctly set!</p>
            <div class=" *:text-[--background-modifier-success]" use:icon={'check'} />
        </div>
        <button
            class="mod-cta"
            on:click={async () => {
                $plugin.data.isIncognitoMode = true;
                await $plugin.initPapa();
            }}>Initialize your Second Brain</button
        >
        <p>Hurray! Your Smart Second Brain is ready!</p>
    {/if}
{/if}
