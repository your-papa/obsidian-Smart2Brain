<script lang="ts">
    import { setIcon } from 'obsidian';
    import { plugin, data, chatHistory, papaState, papaIndexingProgress, errorState } from '../../store';
    import { Prompts, type Language, Languages } from 'papa-ts';
    import ProgressBar from '../base/ProgressBar.svelte';
    import { t } from 'svelte-i18n';
    import DropdownComponent from '../base/Dropdown.svelte';
    import Toggle from '../base/Toggle.svelte';
    import PullOllamaModel from '../Onboarding/PullOllamaModel.svelte';
    import LoadingAnimation from '../base/LoadingAnimation.svelte';
    import { ConfirmModal } from '../Settings/ConfirmModal';
    import { get } from 'svelte/store';

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    let isOpen = $data.isQuickSettingsOpen;

    function toggleDrawer() {
        isOpen = !isOpen;
        $data.isQuickSettingsOpen = isOpen;
        $plugin.saveSettings();
    }

    let similarityThreshold = Math.round(
        ($data.isIncognitoMode ? $data.ollamaEmbedModel.similarityThreshold : $data.openAIEmbedModel.similarityThreshold) * 100
    );
    $: similarityThreshold = Math.min(Math.max(similarityThreshold, 0), 100);
    function setSimilarityThreshold() {
        if ($data.isIncognitoMode) {
            $data.ollamaEmbedModel.similarityThreshold = similarityThreshold / 100;
        } else {
            $data.openAIEmbedModel.similarityThreshold = similarityThreshold / 100;
        }
        $plugin.s2b.setSimilarityThreshold(similarityThreshold / 100);
        $plugin.saveSettings();
    }
    $: similarityThreshold, setSimilarityThreshold();

    let temperature = Math.round($data.isIncognitoMode ? $data.ollamaGenModel.temperature : $data.openAIGenModel.temperature) * 100;
    $: temperature = Math.min(Math.max(temperature, 0), 100);
    function setTemperature(temperature: number) {
        if ($data.isIncognitoMode) {
            $data.ollamaGenModel.temperature = temperature / 100;
            $plugin.s2b.setGenModel($data.ollamaGenModel);
        } else {
            $data.openAIGenModel.temperature = temperature / 100;
            $plugin.s2b.setGenModel($data.openAIGenModel);
        }
        $plugin.saveSettings();
    }
    $: temperature, setTemperature(temperature);

    const languages: { display: Language; value: Language }[] = Object.values(Languages).map((language: Language) => ({ display: language, value: language }));
    const setAssistantLanguage = (selected: Language) => {
        $data.assistantLanguage = selected;
        $data.initialAssistantMessageContent = Prompts[selected].initialAssistantMessage;
        if ($chatHistory.length === 1) {
            chatHistory.reset;
            $plugin.saveSettings();
        }
    };
    function setChatViewDensity() {
        $data.isChatComfy = !$data.isChatComfy;
        $plugin.saveSettings();
    }

    function initSecondBrain() {
        $data.isIncognitoMode
            ? $plugin.s2b.init()
            : new ConfirmModal(
                  get(plugin).app,
                  'Run via Third-Parties',
                  'Are you sure you want to run via third-parties? Your data will be given to third-party servers.',
                  (result) => {
                      if (result === 'Yes') $plugin.s2b.init();
                  },
                  'hideIncognitoWarning'
              ).activate();
    }
</script>

<div
    class={`relative ${isOpen ? 'h-[33%] min-h-[33%]' : 'h-[--icon-m] min-h-[--icon-m]'} flex justify-center overflow-hidden transition-all duration-300 ease-in-out`}
>
    <div class="flex h-full w-full max-w-[500px] flex-col items-center justify-center">
        {#if isOpen}
            {#if $papaState === 'loading' || $papaState === 'uninitialized'}
                <LoadingAnimation />
            {:else if $papaState === 'indexing'}
                <h2 class="m-0 text-[--text-normal]">Indexing vault</h2>
                <div class="flex w-full items-center gap-2">
                    <ProgressBar progress={$papaIndexingProgress} />
                    <button
                        aria-label="Pause indexing"
                        on:click={() => ($papaState = 'indexing-pause')}
                        class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                        use:icon={'pause'}
                    />
                </div>
            {:else if $papaState === 'indexing-pause'}
                <h2 class="m-0 text-[--text-normal]">Indexing vault</h2>
                <div class="flex w-full items-center gap-2">
                    <ProgressBar progress={$papaIndexingProgress} />
                    <button
                        aria-label="Resume indexing"
                        on:click={() => $plugin.s2b.init()}
                        class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                        use:icon={'play'}
                    />
                </div>
            {:else if $papaState === 'error'}
                {#if $errorState === 'ollama-model-not-installed'}
                    <h2 class="text-center text-[--text-normal]">Install {$data.ollamaGenModel.model} first.</h2>
                    <PullOllamaModel onSuccessfulPull={() => ($papaState = 'settings-change')} />
                {:else}
                    <h2 class="text-center text-[--text-normal]">An error occured.<br /> Please retry initialization...</h2>
                    <button
                        aria-label="Retry initializing"
                        on:click={() => $plugin.s2b.init()}
                        class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                        use:icon={'refresh-cw'}
                    />
                {/if}
            {:else if $papaState === 'mode-change'}
                <h2 class="text-center text-[--text-normal]">Reinitialize Smart Second Brain <br />with {$data.isIncognitoMode ? 'Ollama' : 'OpenAI'}.</h2>
                <button
                    aria-label="Initialize"
                    on:click={() => initSecondBrain()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'play'}
                />
            {:else if $papaState === 'settings-change'}
                <h2 class="text-center text-[--text-normal]">Settings changed.<br />Reinitialize Smart Second Brain.</h2>
                <button
                    aria-label="Reinitialize, Settings changed"
                    on:click={() => $plugin.s2b.init()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'refresh-cw'}
                />
            {:else}
                <div class="loader"></div>
                {#if $data.isIncognitoMode}
                    <h2 class="mb-0 text-center text-[--text-normal]">Ollama</h2>
                    <p class="mt-1 text-center text-[--text-normal]">Chat via {$data.ollamaGenModel.model}</p>
                    <!-- <p class="text-[--text-normal] text-center mt-0"> -->
                    <!--     Embed with {$data.ollamaEmbedModel.model}<br /> -->
                    <!--     Generate with {$data.ollamaGenModel.model} -->
                    <!-- </p> -->
                {:else}
                    <h2 class="mb-0 text-center text-[--text-normal]">OpenAI</h2>
                    <p class="mt-1 text-center text-[--text-normal]">Chat via {$data.openAIGenModel.model}</p>
                    <!-- {#if $data.openAIGenModel.openAIApiKey} -->
                    <!--     <p class="text-[--text-normal] text-center mt-0"> -->
                    <!--         Embed with {$data.openAIEmbedModel.model}<br /> -->
                    <!--         Generate with {$data.openAIGenModel.model} -->
                    <!--     </p> -->
                    <!-- {/if} -->
                {/if}
                <div class="w-full max-w-[220px]">
                    <div class="mb-1 flex w-full items-center justify-between">
                        <p class="m-0 inline-block">Comfy Chatview</p>
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <Toggle isEnabled={$data.isChatComfy} changeFunc={setChatViewDensity} />
                    </div>
                    <div class="flex w-full items-center justify-between">
                        <p class="m-0 inline-block">{$t('assistant_language')}</p>
                        <DropdownComponent selected={$data.assistantLanguage} options={languages} changeFunc={setAssistantLanguage} />
                    </div>
                    <div class="flex w-full items-center justify-between">
                        <p class="m-0 inline-block">Relevancy in %</p>
                        <input type="number" bind:value={similarityThreshold} min="0" max="100" />
                    </div>
                    <div class="flex w-full items-center justify-between">
                        <p class="m-0 inline-block">Creativity in %</p>
                        <input type="number" bind:value={temperature} min="0" max="100" />
                    </div>
                </div>
            {/if}
        {/if}
        <div style="height: 1rem" />
        <div class="absolute bottom-0 z-10 flex w-full justify-center">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                aria-label={`${isOpen ? 'Close' : 'Open'} quick Settings`}
                class={`text-[--text-normal] transition-transform duration-300 hover:text-[--text-accent-hover] ${
                    isOpen ? 'rotate-180 transform' : 'rotate-0 transform'
                }`}
                use:icon={'chevron-down'}
                on:click={toggleDrawer}
            />
        </div>
    </div>
</div>
