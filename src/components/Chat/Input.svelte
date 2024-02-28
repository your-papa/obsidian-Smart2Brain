<script lang="ts">
    import { Notice, setIcon } from 'obsidian';
    import type { KeyboardEventHandler } from 'svelte/elements';
    import { runSecondBrain, canRunSecondBrain } from '../../controller/runSecondBrain';
    import { nanoid } from 'nanoid';
    import { plugin, chatHistory, chatInput, isEditingAssistantMessage, papaState, papaIndexingProgress, isChatInSidebar } from '../../store';
    import ProgressCircle from '../base/ProgressCircle.svelte';

    export let textarea: HTMLTextAreaElement;

    const icon = (node: HTMLElement, iconId: string) => {
        setIcon(node, iconId);
    };

    async function runSecondBrainFromInput() {
        if (!canRunSecondBrain()) return;

        if ($isEditingAssistantMessage) {
            $chatHistory[0].content = $chatInput;
            $plugin.data.initialAssistantMessage = $chatInput;
            $chatInput = '';
            $isEditingAssistantMessage = false;
            $plugin.chatView.requestSave();
            await $plugin.saveSettings();
            return;
        }

        if ($chatInput.trim() !== '') {
            let userQuery = $chatInput;
            $chatInput = '';
            await runSecondBrain($plugin.data.isUsingRag, userQuery);
        }
    }
    function injectContext(event: KeyboardEvent): KeyboardEventHandler<HTMLInputElement> {
        if (event.key !== '[') return;
        new Notice('Injecting context...');
    }
    function handleRAGToggle() {
        $plugin.data.isUsingRag = !$plugin.data.isUsingRag;
        $plugin.saveSettings();
        new Notice($plugin.data.isUsingRag ? 'Now chatting with your Second Brain' : 'Now chatting with the LLM');
    }

    function handleDelete() {
        // delete everything except the first message
        $chatHistory = [];
        $chatHistory.push({
            role: 'Assistant',
            content: $plugin.data.initialAssistantMessage,
            id: nanoid(),
        });
        $plugin.chatView.requestSave();
    }

    function handelEnter(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            runSecondBrainFromInput();
        }
    }

    $: if ($chatInput) {
        updateHeight();
    }

    function updateHeight() {
        textarea.style.height = '2rem';
        if (textarea.scrollHeight == 42) textarea.style.height = '2rem';
        else textarea.style.height = textarea.scrollHeight + 'px';
    }
</script>

<!-- save delete and rag settings slightly above input field -->
<div class="relative">
    <div
        class="absolute -top-[54px] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-t-2xl border border-solid border-x-[--background-modifier-border] border-b-transparent border-t-[--background-modifier-border] {$isChatInSidebar
            ? 'bg-[--background-secondary]'
            : 'bg-[--background-primary]'} p-2"
    >
        {#if $chatHistory.length > 1}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                aria-label="Save the Chat to a file"
                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                use:icon={'save'}
                on:click={() => $plugin.saveChat()}
                hidden={$papaState === 'running'}
            />
        {/if}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            aria-label="Toggle between chatting with your Notes or the LLM"
            on:click={handleRAGToggle}
            use:icon={'brain-circuit'}
            class={`h-[--icon-xl] w-[--icon-xl] *:!h-[--icon-xl] *:!w-[--icon-xl] hover:text-[--text-accent-hover] ${
                $plugin.data.isUsingRag ? 'text-[--color-accent]' : 'text-[--text-normal]'
            }`}
        />
        {#if $chatHistory.length > 1}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                aria-label="Delete Chat History"
                class="text-[--text-normal] hover:text-[--text-accent-hover]"
                on:click|preventDefault={handleDelete}
                use:icon={'trash-2'}
                hidden={$papaState === 'running'}
            />
        {/if}
    </div>
</div>
<div class="sticky flex w-full gap-1">
    <textarea
        bind:this={textarea}
        id="chat-view-user-input-element"
        class="h-8 max-h-40 flex-1 resize-none"
        placeholder={'Chat with your second Brain...'}
        bind:value={$chatInput}
        on:keydown={handelEnter}
        on:keyup={injectContext}
    />
    {#if $papaState === 'running'}
        <button
            aria-label="Stop your Smart Second Brain"
            on:click={() => ($papaState = 'running-stopped')}
            class="h-8 rounded-r-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
            use:icon={'stop-circle'}
        />
    {:else if $papaState === 'idle'}
        <button
            aria-label="Run your Smart Second Brain"
            on:click={runSecondBrainFromInput}
            class="h-8 rounded-r-md px-4 py-2 transition duration-300 ease-in-out hover:bg-[--text-accent-hover]"
            use:icon={'send-horizontal'}
        />
    {:else}
        <div class="flex h-8 items-center px-4 py-2">
            <ProgressCircle bind:progress={$papaIndexingProgress} />
        </div>
    {/if}
</div>
