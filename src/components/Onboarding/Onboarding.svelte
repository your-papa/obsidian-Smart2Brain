<script lang="ts">
    import { data } from '../../store';
    import * as os from 'os';
    import SliderComponent from '../base/Slider.svelte';
    import AppComponent from './OllamaApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import DaemonComponent from './OllamaDaemon.svelte';
    import IncognitoToggle from '../Settings/IncognitoToggle.svelte';
    import { t } from 'svelte-i18n';
    import Logo from '../Logos/LogoDetailed.svelte';

    const osType = os.type();

    const options = ['Ollama App', 'Ollama Daemon'];
    let selected: 'Ollama App' | 'Ollama Daemon' = 'Ollama App';
</script>

<div class="mx-auto flex h-full w-full max-w-[500px] flex-col items-center overflow-auto pt-8">
    <div class="mb-2 h-40 w-40">
        <Logo />
    </div>
    <h1 class="mb-0 text-[--text-normal]">{$t('onboarding.setup')}</h1>
    <p class="px-10">{$t('onboarding.welcome_msg')}</p>
    <IncognitoToggle />
    {#if $data.isIncognitoMode}
        <p class="px-10">
            {$t('onboarding.privacy_mode_note')}
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
