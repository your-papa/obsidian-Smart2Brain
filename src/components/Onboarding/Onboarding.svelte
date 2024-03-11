<script lang="ts">
    import { data } from '../../store';
    import * as os from 'os';
    import SliderComponent from '../base/Slider.svelte';
    import AppComponent from './OllamaApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import DaemonComponent from './OllamaDaemon.svelte';
    import { icon } from '../../controller/Messages';
    import IncognitoToggle from '../Settings/IncognitoToggle.svelte';
    import { t } from 'svelte-i18n';

    const osType = os.type();

    const options = ['Ollama App', 'Ollama Daemon'];
    let selected: 'Ollama App' | 'Ollama Daemon' = 'Ollama App';
</script>

<div class="mx-auto flex h-full w-full max-w-[500px] flex-col items-center overflow-auto pt-8">
    <div class="w-full text-center *:!h-[--icon-xl] *:!w-[--icon-xl]" use:icon={'brain-circuit'} />
    <h1 class="text-[--text-normal]">{$t('onboarding.setup')}</h1>
    <!-- TODO add welcoming message -->
    <IncognitoToggle />
    {#if $data.isIncognitoMode}
        <p class="px-10">
            {$t('onboarding.privacy_mode_note')}}
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
            {$t('onboarding.openai_mode_note')}
        </p>
        <OpenAiComponent />
    {/if}
</div>
