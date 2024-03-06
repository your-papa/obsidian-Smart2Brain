<script lang="ts">
    import { isIncognitoMode } from '../../store';
    import * as os from 'os';
    import SliderComponent from '../base/Slider.svelte';
    import AppComponent from './OllamaApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import DaemonComponent from './OllamaDaemon.svelte';
    import { icon } from '../../controller/Messages';
    import IncognitoToggle from '../Settings/IncognitoToggle.svelte';

    const osType = os.type();

    const options = ['Ollama App', 'Ollama Daemon'];
    let selected: 'Ollama App' | 'Ollama Daemon' = 'Ollama App';
</script>

<div class="flex h-full w-full max-w-[500px] flex-col items-center mx-auto overflow-auto pt-8">
    <div class="w-full text-center *:!h-[--icon-xl] *:!w-[--icon-xl]" use:icon={'brain-circuit'} />
    <h1 class="text-[--text-normal]">Setup</h1>
    <IncognitoToggle />
    {#if $isIncognitoMode}
        <p class="px-10">
            Your assistant is running in privacy mode. That means it is not connected to the internet and is running fully locally by leveraging Ollama.
        </p>
        {#if osType === 'Darwin'}
            <SliderComponent {options} bind:selected />
        {/if}
        {#if selected === 'Ollama App' || osType === 'Windows_NT'}
            <AppComponent {osType} />
        {:else}
            <DaemonComponent {osType} />
        {/if}
    {:else}
        <p class="px-10">
            Your assistant is using third party services to run. That means you will have to share all your personal information with these services and your
            Smart Second Brain needs to be connected to the internet to leverage OpenAIs large language models like ChatGPT.
        </p>
        <OpenAiComponent />
    {/if}
</div>
