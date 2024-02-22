<script lang="ts">
    import { setIcon } from 'obsidian';
    import { plugin, isIncognitoMode, chatHistory } from '../../store';
    import { nanoid } from 'nanoid';
    import { Prompts, type Language, Languages } from 'papa-ts';
    import { t } from 'svelte-i18n';
    import DropdownComponent from '../base/Dropdown.svelte';
    import Toggle from '../base/Toggle.svelte';

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

<div class={`relative ${isOpen ? 'h-[33%] min-h-[33%]' : 'h-[--icon-m] min-h-[--icon-m]'} overflow-hidden transition-all duration-300 ease-in-out`}>
    <div class="h-full flex flex-col justify-center items-center">
        <div use:icon={'brain-circuit'} class="w-[--icon-xl] h-[--icon-xl] *:!w-[--icon-xl] *:!h-[--icon-xl]" />
        {#if $isIncognitoMode}
            <h2 class="text-[--text-normal] text-center mb-0">Incognito Mode</h2>
            <p class="text-[--text-normal] text-center mt-1">Chat via {$plugin.data.ollamaGenModel.model}</p>
            <!-- <p class="text-[--text-normal] text-center mt-0"> -->
            <!--     Embed with {$plugin.data.ollamaEmbedModel.model}<br /> -->
            <!--     Generate with {$plugin.data.ollamaGenModel.model} -->
            <!-- </p> -->
        {:else}
            <h2 class="text-[--text-normal] text-center mb-0">Publicly</h2>
            <p class="text-[--text-normal] text-center mt-1">Chat via {$plugin.data.openAIGenModel.modelName}</p>
            <!-- {#if $plugin.data.openAIGenModel.openAIApiKey} -->
            <!--     <p class="text-[--text-normal] text-center mt-0"> -->
            <!--         Embed with {$plugin.data.openAIEmbedModel.modelName}<br /> -->
            <!--         Generate with {$plugin.data.openAIGenModel.modelName} -->
            <!--     </p> -->
            <!-- {/if} -->
        {/if}
        <div class="w-full max-w-[220px]">
            <div class="w-full flex justify-between items-center mb-1">
                <p class="inline-block m-0">Comfy Chatview</p>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <Toggle isEnabled={$plugin.data.isChatComfy} changeFunc={setChatViewDensity} />
            </div>
            <div class="w-full flex justify-between items-center">
                <p class="inline-block m-0">{$t('assistant_language')}</p>
                <DropdownComponent selected={$plugin.data.assistantLanguage} options={languages} changeFunc={setAssistantLanguage} />
            </div>
        </div>
    </div>
    <div class="absolute bottom-0 z-10 flex justify-center w-full bg-[--background-secondary]">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            aria-label={`${isOpen ? 'Close' : 'Open'} quick Settings`}
            class={`text-[--text-normal] hover:text-[--text-accent-hover] transition-transform duration-300 ${
                isOpen ? 'transform rotate-180' : 'transform rotate-0'
            }`}
            use:icon={'chevron-down'}
            on:click={toggleDrawer}
        />
    </div>
</div>
