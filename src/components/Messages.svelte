<script lang="ts">
    import { MdContentCopy, MdAutorenew, MdEdit, MdCancel, MdRefresh } from 'svelte-icons/md';
    import Electron from 'electron';
    import type { MouseEventHandler } from 'svelte/elements';
    import { MarkdownRenderer, Notice } from 'obsidian';
    import runSecondBrainFromChat from '../runSecondBrain';
    import { type ChatMessage, plugin, chatHistory, DEFAULT_SETTINGS } from '../main';
    import { isAssistantMessage } from 'openai/lib/chatCompletionUtils';

    export let messageText = '';
    export let isEditing: boolean;
    export let isEditingAssistantMessage: boolean;
    export let textarea: HTMLTextAreaElement;

    let editElem: HTMLSpanElement;
    let initialAssistantMessageSpan: HTMLSpanElement;

    let temporaryEditingHistory: ChatMessage[] = [];
    function toClipboard(messageText: string): MouseEventHandler<HTMLDivElement> {
        if (!messageText) {
            new Notice('Only for Valid Messages! Implement that you lazy fuck!');
            return;
        }
        Electron.clipboard.writeText(messageText);
        return;
    }

    const renderMarkdown = (node: HTMLElement, content: string) => {
        MarkdownRenderer.render($plugin.app, content, node, 'Chat view.md', $plugin);
    };

    const onMouseOver = (e: MouseEvent) => {
        const targetEl = e.target as HTMLElement;
        if (targetEl.tagName !== 'A') return;
        if (targetEl.hasClass('internal-link')) {
            $plugin.chatView.app.workspace.trigger('hover-link', {
                event: e,
                hoverParent: $plugin.chatView,
                targetEl,
                linktext: targetEl.getAttr('href'),
                sourcePath: $plugin.chatView.file.path,
            });
        }
    };

    interface NormalizedPath {
        root: string;
        subpath: string;
        alias: string;
    }
    const noBreakSpace = /\u00A0/g;

    export function getNormalizedPath(path: string): NormalizedPath {
        const stripped = path.replace(noBreakSpace, ' ').normalize('NFC');

        // split on first occurrence of '|'
        // "root#subpath##subsubpath|alias with |# chars"
        //             0            ^        1
        const splitOnAlias = stripped.split(/\|(.*)/);

        // split on first occurrence of '#' (in substring)
        // "root#subpath##subsubpath"
        //   0  ^        1
        const splitOnHash = splitOnAlias[0].split(/#(.*)/);

        return {
            root: splitOnHash[0],
            subpath: splitOnHash[1] ? '#' + splitOnHash[1] : '',
            alias: splitOnAlias[1] || '',
        };
    }

    const onClick = async (e: MouseEvent) => {
        if (e.type === 'auxclick' || e.button === 2) {
            return;
        }

        const targetEl = e.target as HTMLElement;
        const closestAnchor = targetEl.tagName === 'A' ? targetEl : targetEl.closest('a');

        if (!closestAnchor) return;

        if (closestAnchor.hasClass('file-link')) {
            e.preventDefault();
            const href = closestAnchor.getAttribute('href');
            const normalizedPath = getNormalizedPath(href);
            const target = typeof href === 'string' && $plugin.chatView.app.metadataCache.getFirstLinkpathDest(normalizedPath.root, $plugin.chatView.file.path);

            if (!target) return;

            ($plugin.app as any).openWithDefaultApp(target.path);

            return;
        }

        // Open an internal link in a new pane
        if (closestAnchor.hasClass('internal-link')) {
            e.preventDefault();
            const destination = closestAnchor.getAttr('href');
            const inNewLeaf = e.button === 1 || e.ctrlKey || e.metaKey;

            $plugin.app.workspace.openLinkText(destination, 'Chat view.md', inNewLeaf);

            return;
        }

        // Open a tag search
        if (closestAnchor.hasClass('tag')) {
            e.preventDefault();
            ($plugin.app as any).internalPlugins.getPluginById('global-search').instance.openGlobalSearch(`tag:${closestAnchor.getAttr('href')}`);

            return;
        }

        // Open external link
        if (closestAnchor.hasClass('external-link')) {
            e.preventDefault();
            window.open(closestAnchor.getAttr('href'), '_blank');
        }
    };

    async function redoGeneration(message: ChatMessage) {
        const targetIndex = $chatHistory.indexOf(message);
        $chatHistory = $chatHistory.slice(0, targetIndex);
        await runSecondBrainFromChat($plugin.data.isUsingRag, message.content);
    }

    function editMessage(message: ChatMessage) {
        isEditing = true;
        const targetIndex = $chatHistory.indexOf(message);
        temporaryEditingHistory = $chatHistory.slice(targetIndex);
        $chatHistory = $chatHistory.slice(0, targetIndex);
        messageText = message.content + " ";
        textarea.focus();
    }

    $: if (editElem != null) {
        editElem.innerText = "";
        renderMarkdown(editElem, messageText);
    }

    $: if(isEditingAssistantMessage){
        initialAssistantMessageSpan.innerText = "";
        renderMarkdown(initialAssistantMessageSpan, messageText);
    }

    function cancelEditing() {
        isEditing = false;
        messageText = "";
        $chatHistory = $chatHistory.concat(temporaryEditingHistory);
        $plugin.chatView.requestSave();
    }

    function editInitialAssistantMessage(initialMessage: string){
        isEditingAssistantMessage = true;
        messageText = initialMessage;
        textarea.focus();
        //TODO: make it work
        textarea.select();
    }

    function cancelEditingInitialAssistantMessage(){
        isEditingAssistantMessage = false;
        messageText = "";
        initialAssistantMessageSpan.innerText = "";
        renderMarkdown(initialAssistantMessageSpan, $plugin.data.initialAssistantMessage.replace('Assistant\n', '')
            .replace('\n- - - - -', ''));
        $plugin.chatView.requestSave();
    }

    function resetInitialAssistantMessage(){
        isEditingAssistantMessage = false;
        messageText = "";
        initialAssistantMessageSpan.innerText = "";
        const initialAssistantMessage = DEFAULT_SETTINGS.initialAssistantMessage.replace('Assistant\n', '')
            .replace('\n- - - - -', '');
        renderMarkdown(initialAssistantMessageSpan, initialAssistantMessage);
        $chatHistory[0].content = initialAssistantMessage;
        $plugin.data.initialAssistantMessage = DEFAULT_SETTINGS.initialAssistantMessage;
        $plugin.chatView.requestSave();
        $plugin.saveSettings();
    }
</script>

<div class="chat-window select-text flex-grow w-full overflow-y-scroll rounded-md mb-1 p-4">
    {#each $chatHistory as message (message.id)}
        {#if message.role === 'User'}
            <div class="flex justify-end mb-3">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="pl-4 pr-4 rounded-t-lg rounded-bl-lg max-w-[80%]" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                    <span class="break-words text-[--text-normal] p-0" on:mouseover={onMouseOver}
                          use:renderMarkdown='{message.content}' on:click={onClick} />
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="flex justify-end">
                        <div
                            title="Deletes all following Messages and regenerates the answer to the current query"
                            class="text-[--text-normal] hover:text-[--text-accent-hover] w-6"
                            on:click|preventDefault={() => redoGeneration(message)}
                        >
                            <MdAutorenew />
                        </div>
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div
                            title="Edit query and regenerate the answer"
                            class="text-[--text-normal] hover:text-[--text-accent-hover] w-5"
                            on:click|preventDefault={() => editMessage(message)}
                        >
                            <MdEdit />
                        </div>
                    </div>
                </div>
            </div>
        {:else}
            <div class="bg-[--background-primary-alt] mb-3 p-1 pl-4 pr-4 rounded-t-lg rounded-br-lg w-fit max-w-[80%]">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                <span
                    id='test'
                    class="break-words text-[--text-normal]"
                    on:mouseover={onMouseOver}
                    use:renderMarkdown={message.content}
                    style="background: transparent;"
                    on:click={onClick}
                    bind:this={initialAssistantMessageSpan}
                />
                <div class="flex justify-start mb-3">
                    {#if (!isEditingAssistantMessage)}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div title="Copy Text" class="text-[--text-normal] hover:text-[--text-accent-hover] w-6" on:click|preventDefault={toClipboard(message.content)}>
                            <MdContentCopy />
                        </div>
                        {#if $chatHistory.length === 1}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div
                                title="Change the initial assistant message"
                                class="text-[--text-normal] hover:text-[--text-accent-hover] w-5"
                                on:click|preventDefault={() => editInitialAssistantMessage(message.content)}>
                                    <MdEdit />
                            </div>
                        {/if}
                    {/if}
                    {#if isEditingAssistantMessage}
                        <div title="Copy Text" class="text-[--text-normal] hover:text-[--text-accent-hover] w-6" on:click|preventDefault={cancelEditingInitialAssistantMessage}>
                            <MdCancel />
                        </div>
                        <div title="Reset to default" class="text-[--text-normal] hover:text-[--text-accent-hover] w-6" on:click={resetInitialAssistantMessage}>
                            <MdRefresh/>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
    {/each}
    {#if isEditing}
    <div class="flex justify-end mb-3">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div class="pl-4 pr-4 rounded-t-lg rounded-bl-lg max-w-[80%]" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <!-- svelte-ignore a11y-mouse-events-have-key-events -->
            <span class="break-words text-[--text-normal] p-0" on:mouseover={onMouseOver} bind:this={editElem} />
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div title="Copy Text" class="text-[--text-normal] hover:text-[--text-accent-hover] w-6" on:click|preventDefault={cancelEditing}>
                <MdCancel />
            </div>
        </div>
    </div>
    {/if}
</div>
