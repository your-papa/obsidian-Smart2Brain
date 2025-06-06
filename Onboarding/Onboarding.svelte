<script lang="ts">
    import * as os from 'os';
    import SliderComponent from '../base/Slider.svelte';
    import OllamaAppComponent from './OllamaApp.svelte';
    import OpenAiComponent from './OpenAI.svelte';
    import OllamaDaemonComponent from './OllamaDaemon.svelte';
    import SlideComponent from '../base/Slider.svelte';
    import { t } from 'svelte-i18n';
    import Logo from '../Logos/Logo.svelte';

    const osType = os.type();
    const modes = [$t('incognito_toggle.enable'), $t('incognito_toggle.disable')];
    let mode = $state($t('incognito_toggle.enable'));
    const options = ['Ollama App', 'Ollama Daemon'];
    let selected: 'Ollama App' | 'Ollama Daemon' = $state(osType === 'Linux' ? 'Ollama Daemon' : 'Ollama App');

    let onboardingWindow: HTMLDivElement = $state();
    function scrollToBottom() {
        onboardingWindow.scrollTop = onboardingWindow.scrollHeight;
    }
</script>

<div bind:this={onboardingWindow} class="mx-auto flex h-full w-full max-w-[500px] flex-col items-center overflow-auto p-8">
    <div class="mb-2 h-40 w-40">
        <Logo />
    </div>
    <h1 class="mb-0 text-[--text-normal]">{$t('onboarding.setup')}</h1>
    <p class="px-10">{$t('onboarding.welcome_msg')}</p>
    <SlideComponent options={modes} bind:selected={mode} />
    {#if mode === $t('incognito_toggle.enable')}
        <p class="px-10">
            {$t('onboarding.privacy_mode_note')}
        </p>
        {#if osType === 'Darwin'}
            <SliderComponent {options} bind:selected />
        {/if}
        {#if selected === 'Ollama App'}
            <OllamaAppComponent {osType} {scrollToBottom} />
        {:else}
            <OllamaDaemonComponent {osType} {scrollToBottom} />
        {/if}
    {:else}
        <p class="px-10">
            {$t('onboarding.openai_mode_note')}
        </p>
        <OpenAiComponent {scrollToBottom} />
    {/if}
</div>
