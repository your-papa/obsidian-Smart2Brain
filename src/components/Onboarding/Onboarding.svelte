<script lang="ts">
    import { isIncognitoMode, plugin } from '../../store';
    import * as os from 'os';
    import SliderComponent from '../base/Slider.svelte';
    import AppComponent from './OllamaApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import DaemonComponent from './OllamaDaemon.svelte';
    import { icon } from '../../controller/Messages';
    import { afterUpdate } from 'svelte';
    import Button from '../base/Button.svelte';
    import { LogLvl } from 'papa-ts';

    const osType = os.type();
    const installOptionsAll = {
        Darwin: ['Ollama App', 'Ollama Daemon', 'OpenAI'],
        Linux: ['Ollama Daemon', 'OpenAI'],
        Windows_NT: ['Ollama App', 'OpenAI'],
    };
    const installOptions: Array<'Ollama App' | 'Ollama Daemon' | 'OpenAI'> = installOptionsAll[osType];
    let selected: 'Ollama App' | 'Ollama Daemon' | 'OpenAI';

    afterUpdate(() => {
        selected = installOptions[$isIncognitoMode ? 0 : installOptions.length - 1];
    });

    // TODO refactor
    function updateSelected(value: string) {
        $isIncognitoMode = value === 'Ollama Daemon' || value === 'Ollama App';
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    }

    $: if (selected) {
        updateSelected(selected);
    }
</script>

<div class="flex h-full w-full flex-col items-center overflow-auto pt-8">
    <div class="w-full text-center *:!h-[--icon-xl] *:!w-[--icon-xl]" use:icon={'brain-circuit'} />
    <h1 class="text-[--text-normal]">Setup</h1>
    <SliderComponent options={installOptions} bind:selected />
    {#if selected === 'Ollama App'}
        <AppComponent {osType} />
    {:else if selected === 'Ollama Daemon'}
        <DaemonComponent {osType} />
    {:else if selected === 'OpenAI'}
        <OpenAiComponent />
    {/if}
</div>
