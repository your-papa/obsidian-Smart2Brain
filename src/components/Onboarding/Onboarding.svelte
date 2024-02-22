<script lang="ts">
    import { icon, renderMarkdown } from '../../controller/Messages';
    import * as os from 'os';
    import { plugin } from '../../store';
    import TextComponent from '../base/Text.svelte';
    import { isAPIKeyValid } from '../../controller/OpenAI';
    import SliderComponent from '../base/Slider.svelte';
    import DropdownComponent from '../base/Dropdown.svelte';
    import { changeOllamaBaseUrl, getOllamaGenModel, isOllamaRunning, isOriginSet, ollamaEmbedChange } from '../../controller/Ollama';
    import MacAppComponent from './MacApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import DeamonComponent from './Deamon.svelte';

    const osType = os.type();
    const installOptionsAll = {
        Darwin: ['Ollama App', 'Ollama Deamon', 'OpenAI'],
        Linux: ['Ollama Deamon', 'OpenAI'],
        Windows_NT: ['Ollama Deamon', 'OpenAI'],
    };
    const installOptions: Array<'Ollama App' | 'Ollama Deamon' | 'OpenAI'> = installOptionsAll[osType];

    let selected: string;
</script>

<div class="flex h-full flex-col pt-10">
    <div class="flex w-full justify-center *:!h-[--icon-xl] *:!w-[--icon-xl]" use:icon={'brain-circuit'} />
    <h1 class="text-center text-[--text-normal]">Smart Second Brain Setup</h1>
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
