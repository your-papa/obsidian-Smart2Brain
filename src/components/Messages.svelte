<script lang="ts">
    import { messages } from '../store';
    import MdContentCopy from 'svelte-icons/md/MdContentCopy.svelte';
    import MdLibraryBooks from 'svelte-icons/md/MdLibraryBooks.svelte';
    import Electron from 'electron';
    import type { MouseEventHandler } from 'svelte/elements';
    import { Keymap, MarkdownRenderer, Notice, htmlToMarkdown } from 'obsidian';
    import { plugin } from '../store';
    import type { Action } from 'svelte/action';

    const getThemeColor = (name: string) => {
        return getComputedStyle(document.body).getPropertyValue(name);
    };

    const AIcolor = getThemeColor('--color-accent');
    const UserColor =  getThemeColor('--color-base-40');

    function toClipboard(messageText: string): MouseEventHandler<HTMLButtonElement> {
        if (!messageText) {
            new Notice('Only for Valid Messages! Implement that you lazy fuck!');
            return;
        }
        Electron.clipboard.writeText(messageText);
        return;
    }

    function test() {
        const link_tfile = $plugin.app.metadataCache.getFirstLinkpathDest('Meetingrollen', "/");
        const mod = Keymap.isModEvent(event);
        const leaf = $plugin.app.workspace.getLeaf(mod);
        leaf.openFile(link_tfile);
    }

   const html:Action<HTMLSpanElement, string> = (node: HTMLSpanElement, content: string) => {
        node.click = () => {          
            const link_tfile = $plugin.app.metadataCache.getFirstLinkpathDest('Meetingrollen#Test', "/");
          
            const leaf = $plugin.app.workspace.getLeaf(mod);
            leaf.openFile(link_tfile);}
        const inhalt = MarkdownRenderer.render($plugin.app, htmlToMarkdown(content), node, '', $plugin);
        return 
    }
    
</script>

<div class="chat-window flex-grow w-full overflow-scroll border-2 border-solid roundedmd border-slate-30 mb-1 p-4">
    {#each $messages as message (message.content)}
        {#if message.role === 'user'}
            <div class="flex justify-end mb-3">
                <button class="p-2 break-words rounded-t-md rounded-bl-md max-w-[80%] text-slate-0" style="background: {UserColor};" on:click={test}></button>
            </div>
        {:else}
            <div class="mb-3">
                <div id="test" class="p-2 break-words rounded-t-md rounded-br-md w-fit max-w-[80%]" style="background: {AIcolor};">
                    <p class="text-slate-0" use:html={message.content}></p>
                    <button style="background-color: transparent;" on:click|preventDefault={toClipboard(message.content)}><MdContentCopy /></button>
                    <button style="background-color: transparent;" on:click|preventDefault={toClipboard(message.context)}><MdLibraryBooks /></button>
                </div>
            </div>
        {/if}
    {/each}
</div>
