<script lang="ts">
    import { setIcon } from 'obsidian';
    import { plugin, isIncognitoMode, chatHistory, papaState, papaIndexingProgress, errorState } from '../../store';
    import { nanoid } from 'nanoid';
    import { Prompts, type Language, Languages } from 'papa-ts';
    import ProgressBar from '../base/ProgressBar.svelte';
    import { t } from 'svelte-i18n';
    import DropdownComponent from '../base/Dropdown.svelte';
    import Toggle from '../base/Toggle.svelte';
    import PullOllamaModel from '../Onboarding/PullOllamaModel.svelte';

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    let isOpen = $plugin.data.isQuickSettingsOpen;

    function toggleDrawer() {
        isOpen = !isOpen;
        $plugin.data.isQuickSettingsOpen = isOpen;
        $plugin.saveSettings();
    }

    const languages: { display: Language; value: Language }[] = Object.values(Languages).map((language: Language) => ({ display: language, value: language }));
    const setAssistantLanguage = (selected: Language) => {
        $plugin.data.assistantLanguage = selected;
        $plugin.data.initialAssistantMessage = Prompts[selected].initialAssistantMessage;
        if ($chatHistory.length === 1) {
            chatHistory.set([
                {
                    role: 'Assistant',
                    content: $plugin.data.initialAssistantMessage,
                    id: nanoid(),
                },
            ]);
            $plugin.chatView.requestSave();
        }
        $plugin.saveSettings();
    };
    function setChatViewDensity() {
        $plugin.data.isChatComfy = !$plugin.data.isChatComfy;
        $plugin.saveSettings();
    }
</script>

<div
    class={`relative ${isOpen ? 'h-[33%] min-h-[33%]' : 'h-[--icon-m] min-h-[--icon-m]'} flex justify-center overflow-hidden transition-all duration-300 ease-in-out`}
>
    <div class="flex w-full max-w-[500px] h-full flex-col items-center justify-center">
        {#if isOpen}
            {#if $papaState === 'loading' || $papaState === 'uninitialized'}
                <h2 class="text-center text-[--text-normal]">Starting...</h2>
            {:else if $papaState === 'indexing'}
                <h2 class="text-center text-[--text-normal]">Indexing vault...</h2>
                <ProgressBar progress={$papaIndexingProgress} />
                <button
                    aria-label="Pause indexing"
                    on:click={() => ($papaState = 'indexing-pause')}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'pause'}
                />
            {:else if $papaState === 'indexing-pause'}
                <h2 class="text-center text-[--text-normal]">Paused indexing vault</h2>
                <ProgressBar progress={$papaIndexingProgress} />
                <button
                    aria-label="Resume indexing"
                    on:click={() => $plugin.initPapa()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'play'}
                />
            {:else if $papaState === 'error'}
                {#if $errorState === 'ollama-model-not-installed'}
                    <h2 class="text-center text-[--text-normal]">Install {$plugin.data.ollamaGenModel.model} first.</h2>
                    <PullOllamaModel onSuccessfulPull={() => ($papaState = 'settings-change')} />
                {:else}
                    <h2 class="text-center text-[--text-normal]">An error occured.<br /> Please retry initialization...</h2>
                    <button
                        aria-label="Retry initializing"
                        on:click={() => $plugin.initPapa()}
                        class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                        use:icon={'refresh-cw'}
                    />
                {/if}
            {:else if $papaState === 'mode-change'}
                <h2 class="text-center text-[--text-normal]">Reinitialize Smart Second Brain <br />with {$isIncognitoMode ? 'Ollama' : 'OpenAI'}.</h2>
                <button
                    aria-label="Initialize"
                    on:click={() => $plugin.initPapa()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'play'}
                />
            {:else if $papaState === 'settings-change'}
                <h2 class="text-center text-[--text-normal]">Settings changed.<br />Reinitialize Smart Second Brain.</h2>
                <button
                    aria-label="Reinitialize, Settings changed"
                    on:click={() => $plugin.initPapa()}
                    class="h-8 rounded-l-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
                    use:icon={'refresh-cw'}
                />
            {:else}
                {#if $isIncognitoMode}
                    <h2 class="mb-0 text-center text-[--text-normal]">Ollama</h2>
                    <p class="mt-1 text-center text-[--text-normal]">Chat via {$plugin.data.ollamaGenModel.model}</p>
                    <!-- <p class="text-[--text-normal] text-center mt-0"> -->
                    <!--     Embed with {$plugin.data.ollamaEmbedModel.model}<br /> -->
                    <!--     Generate with {$plugin.data.ollamaGenModel.model} -->
                    <!-- </p> -->
                {:else}
                    <h2 class="mb-0 text-center text-[--text-normal]">OpenAI</h2>
                    <p class="mt-1 text-center text-[--text-normal]">Chat via {$plugin.data.openAIGenModel.model}</p>
                    <!-- {#if $plugin.data.openAIGenModel.openAIApiKey} -->
                    <!--     <p class="text-[--text-normal] text-center mt-0"> -->
                    <!--         Embed with {$plugin.data.openAIEmbedModel.model}<br /> -->
                    <!--         Generate with {$plugin.data.openAIGenModel.model} -->
                    <!--     </p> -->
                    <!-- {/if} -->
                {/if}
                <div class="w-full max-w-[220px]">
                    <div class="mb-1 flex w-full items-center justify-between">
                        <p class="m-0 inline-block">Comfy Chatview</p>
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <Toggle isEnabled={$plugin.data.isChatComfy} changeFunc={setChatViewDensity} />
                    </div>
                    <div class="flex w-full items-center justify-between">
                        <p class="m-0 inline-block">{$t('assistant_language')}</p>
                        <DropdownComponent selected={$plugin.data.assistantLanguage} options={languages} changeFunc={setAssistantLanguage} />
                    </div>
                </div>
            {/if}
        {/if}
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
