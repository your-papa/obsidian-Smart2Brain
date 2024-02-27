<script lang="ts">
    import { isIncognitoMode, plugin } from '../../store';
    import { icon } from '../../controller/Messages';
    import * as os from 'os';
    import SliderComponent from '../base/Slider.svelte';
    import MacAppComponent from './OllamaMacApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import DeamonComponent from './OllamaDeamon.svelte';

    const osType = os.type();
    const installOptionsAll = {
        Darwin: ['Ollama App', 'Ollama Deamon', 'OpenAI'],
        Linux: ['Ollama Deamon', 'OpenAI'],
        Windows_NT: ['Ollama Deamon', 'OpenAI'],
    };
    const installOptions: Array<'Ollama App' | 'Ollama Deamon' | 'OpenAI'> = installOptionsAll[osType];

    $: if (selected) {
        $isIncognitoMode = selected === 'Ollama Deamon' || selected === 'Ollama App';
        $plugin.data.isIncognitoMode = $isIncognitoMode;
        $plugin.saveSettings();
    }

    let selected: string;
</script>

<div class="flex h-full flex-col pt-10">
    <div class="flex w-full justify-center *:!h-[--icon-xl] *:!w-[--icon-xl]" use:icon={'brain-circuit'} />
    <h1 class="text-center text-[--text-normal]">Setup</h1>
    <div class="flex w-full justify-center">
        <SliderComponent options={installOptions} bind:selected />
    </div>
    {#if selected === 'Ollama App'}
        <ol>
            <MacAppComponent />
        </ol>
    {:else if selected === 'Ollama Deamon'}
        <DeamonComponent {osType} />
    {:else if selected === 'OpenAI'}
        <OpenAiComponent />
    {/if}
</div>
