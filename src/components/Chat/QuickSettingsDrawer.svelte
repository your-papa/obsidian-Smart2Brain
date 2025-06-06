<script lang="ts">
    import { run } from 'svelte/legacy';

    import { setIcon } from 'obsidian';
    import { plugin, data, chatHistory, papaState, papaIndexingProgress, errorState, papaIndexingTimeLeft, isChatInSidebar } from '../../store';
    import { Prompts, type Language, Languages } from 'papa-ts';
    import ProgressBar from '../base/ProgressBar.svelte';
    import { t } from 'svelte-i18n';
    import DropdownComponent from '../base/Dropdown.svelte';
    import ToggleComponent from '../base/Toggle.svelte';
    import LoadingAnimation from '../base/LoadingAnimation.svelte';

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    let isOpen = $state($data.isQuickSettingsOpen);

    function toggleDrawer() {
        isOpen = !isOpen;
        $plugin.saveSettings({ isQuickSettingsOpen: isOpen });
    }

    let similarityThreshold = $state(Math.round($data.embedModelConfigs[$data.selEmbedModel].similarityThreshold * 100));
    run(() => {
        similarityThreshold = Math.min(Math.max(similarityThreshold, 0), 100);
    });
    function setSimilarityThreshold() {
        $data.embedModelConfigs[$data.selEmbedModel].similarityThreshold = similarityThreshold / 100;
        $plugin.s2b.configure({ embedModelConfig: { similarityThreshold: similarityThreshold / 100 } });
        $plugin.saveSettings();
    }

    let temperature = $state(Math.round($data.genModelConfigs[$data.selGenModel].temperature * 100));
    run(() => {
        temperature = Math.min(Math.max(temperature, 0), 100);
    });
    function setTemperature() {
        $data.genModelConfigs[$data.selGenModel].temperature = temperature / 100;
        $plugin.s2b.configure({ genModelConfig: { temperature: temperature / 100 } });
        $plugin.saveSettings();
    }

    const languages: { display: Language; value: Language }[] = Object.values(Languages).map((language: Language) => ({ display: language, value: language }));

    const setAssistantLanguage = (selected: Language) => {
        if ($chatHistory.length === 1) chatHistory.reset();
        $plugin.saveSettings({ assistantLanguage: selected, initialAssistantMessageContent: Prompts[selected].initialAssistantMessage });
    };
    function setChatViewDensity() {
        $plugin.saveSettings({ isChatComfy: !$data.isChatComfy });
    }

    function formatTime(secondsInput: number) {
        const minutes = Math.floor(secondsInput / 60); // Calculate minutes
        const seconds = secondsInput % 60; // Remaining seconds
        return minutes > 0
            ? $t('quick_settings.time_left_minutes', { values: { minutes, seconds } })
            : $t('quick_settings.time_left_seconds', { values: { seconds } });
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class={`relative ${isOpen ? 'h-[33%] min-h-[33%]' : 'h-[--icon-m] min-h-[--icon-m]'} flex justify-center overflow-hidden transition-all duration-300 ease-in-out`}
>
    <div class="flex h-full w-full max-w-[500px] flex-col items-center justify-center">
        {#if isOpen}
            {#if $papaState === 'uninitialized'}
                <h3 class="text-center text-primary">{$t('quick_settings.initialize')}</h3>
                <button
                    aria-label={$t('quick_settings.initialize')}
                    onclick={() => $plugin.s2b.init()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'power'}
                ></button>
            {:else if $papaState === 'loading'}
                <LoadingAnimation />
            {:else if $papaState === 'indexing' || $papaState === 'indexing-pause'}
                <h3 class="m-0 text-primary">{$t('quick_settings.indexing_vault')}</h3>
                <output class={$papaState === 'indexing' && $papaIndexingTimeLeft > 0 ? '' : 'invisible'}>{formatTime($papaIndexingTimeLeft)}</output>
                <ProgressBar progress={$papaIndexingProgress} />
                <div
                    class="flex items-center justify-center rounded-xl shadow {$isChatInSidebar
                        ? 'bg-[--background-secondary-alt]'
                        : 'bg-[--background-primary-alt]'}"
                >
                    {#if $papaState === 'indexing'}
                        <div
                            aria-label={$t('quick_settings.pause_indexing')}
                            onclick={() => ($papaState = 'indexing-pause')}
                            class="h-8 py-2 pl-3 pr-2 transition duration-300 ease-in-out hover:text-[var(--text-accent-hover)]"
                            use:icon={'pause'}
                        ></div>
                    {:else if $papaState === 'indexing-pause'}
                        <div
                            aria-label={$t('quick_settings.resume_indexing')}
                            onclick={() => $plugin.s2b.init()}
                            class="h-8 py-2 pl-3 pr-2 transition duration-300 ease-in-out hover:text-[var(--text-accent-hover)]"
                            use:icon={'play'}
                        ></div>
                    {/if}
                    <div
                        aria-label={$t('quick_settings.cancel_indexing')}
                        onclick={() => $plugin.s2b.cancelIndexing()}
                        class="h-8 py-2 pl-2 pr-3 transition duration-300 ease-in-out hover:text-[var(--text-accent-hover)]"
                        use:icon={'stop-circle'}
                    ></div>
                </div>
            {:else if $papaState === 'error'}
                {#if $errorState === 'ollama-gen-model-not-installed'}
                    <h3 class="text-center text-primary">{$t('quick_settings.error.install_model', { values: { model: $data.selGenModel } })}</h3>
                {:else if $errorState === 'ollama-embed-model-not-installed'}
                    <h3 class="text-center text-primary">{$t('quick_settings.error.install_model', { values: { model: $data.selEmbedModel } })}</h3>
                {:else if $errorState === 'failed-indexing'}
                    <h3 class="text-center">{$t('notice.failed_indexing')}</h3>
                    <button
                        aria-label={$t('quick_settings.retry_indexing')}
                        onclick={() => $plugin.s2b.init()}
                        class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                        use:icon={'refresh-cw'}
                    ></button>
                {:else}
                    <h3 class="text-center text-primary">{$t('quick_settings.error.other')}</h3>
                    <button
                        aria-label={$t('quick_settings.retry_initialization')}
                        onclick={() => $plugin.s2b.init()}
                        class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                        use:icon={'refresh-cw'}
                    ></button>
                {/if}
            {:else if $papaState === 'mode-change'}
                <h3 class="text-center text-primary">{$t('quick_settings.mode_changed')}{$data.selGenProvider}.</h3>
                <button
                    aria-label={$t('quick_settings.reinitialize')}
                    onclick={() => $plugin.s2b.init()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'refresh-cw'}
                ></button>
            {:else if $papaState === 'settings-change'}
                <h3 class="text-center text-primary">{$t('quick_settings.settings_changed')}</h3>
                <button
                    aria-label={$t('quick_settings.reinitialize')}
                    onclick={() => $plugin.s2b.init()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'refresh-cw'}
                ></button>
            {:else}
                <h2 class="mb-0 text-primary">{$data.selGenProvider}</h2>
                <p class="mt-1">
                    {$t('quick_settings.chat_via', { values: { model: $data.selGenModel } })}
                </p>
                <div class="w-full max-w-[300px]">
                    <div class="flex h-8 items-center justify-between">
                        {$t('quick_settings.chatview')}
                        <ToggleComponent isEnabled={$data.isChatComfy} changeFunc={setChatViewDensity} />
                    </div>
                    <div class="flex h-8 items-center justify-between">
                        {$t('quick_settings.assistant_language')}
                        <DropdownComponent selected={$data.assistantLanguage} options={languages} changeFunc={setAssistantLanguage} />
                    </div>
                    <div class="flex h-8 items-center justify-between">
                        {$t('quick_settings.creativity')}
                        <div use:icon={'help'} aria-label={$t('tooltip.creativity')} class="ml-1 mr-auto h-[18px]"></div>
                        <div class="flex items-center">
                            <output>{temperature}%</output>
                            <input class="slider" type="range" bind:value={temperature} onblur={setTemperature} min="0" max="100" />
                        </div>
                    </div>
                    {#if $data.isUsingRag}
                        <div class="flex h-8 items-center justify-between">
                            {$t('quick_settings.similarity_threshold')}
                            <div use:icon={'help'} aria-label={$t('tooltip.similarity')} class="ml-1 mr-auto h-[18px]"></div>
                            <div class="flex items-center">
                                <output>{similarityThreshold}%</output>
                                <input class="slider" type="range" bind:value={similarityThreshold} onblur={setSimilarityThreshold} min="0" max="100" />
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        {/if}
        <div style="height: 1rem"></div>
        <div class="absolute bottom-0 z-10 flex w-full justify-center">
            <div
                aria-label={isOpen ? $t('quick_settings.close') : $t('quick_settings.open')}
                class={`text-[--text-normal] transition-transform duration-300 hover:text-[--text-accent-hover] ${
                    isOpen ? 'rotate-180 transform' : 'rotate-0 transform'
                }`}
                use:icon={'chevron-down'}
                onclick={toggleDrawer}
            ></div>
        </div>
    </div>
</div>
