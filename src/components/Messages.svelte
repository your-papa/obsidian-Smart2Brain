<script lang="ts">
    import { messages } from '../store';
    import { MdContentCopy, MdEdit } from 'svelte-icons/md';
    import Electron from 'electron';
    import type { MouseEventHandler } from 'svelte/elements';
    import { MarkdownRenderer, Notice } from 'obsidian';
    import { plugin } from '../store';

    function toClipboard(messageText: string): MouseEventHandler<HTMLDivElement> {
        if (!messageText) {
            new Notice('Only for Valid Messages! Implement that you lazy fuck!');
            return;
        }
        Electron.clipboard.writeText(messageText);
        return;
    }

    const html = (node: HTMLElement, content: string) => {
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

        // split on first occurance of '|'
        // "root#subpath##subsubpath|alias with |# chars"
        //             0            ^        1
        const splitOnAlias = stripped.split(/\|(.*)/);

        // split on first occurance of '#' (in substring)
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
</script>

<div class="chat-window select-text flex-grow w-full overflow-scroll border-2 border-solid rounded-md border-[--background-secondary] mb-1 p-4">
    {#each $messages as message (message.content)}
        {#if message.role === 'user'}
            <div class="flex justify-end mb-3">
                <div class="pl-4 pr-4 rounded-t-lg rounded-bl-lg max-w-[80%]" style="background-color: hsla(var(--color-accent-hsl), 0.4);">
                    <span class="break-words text-[--text-normal] p-0" use:html={message.content} on:mouseover={onMouseOver} on:click={onClick} />
                    <!-- <div class="flex justify-end"> -->
                    <!-- <div class="text-[--text-normal] hover:text-[--text-accent-hover] w-6" on:click|preventDefault={toClipboard(message.content)}> -->
                    <!--     <MdEdit /> -->
                    <!-- </div> -->
                    <!-- </div> -->
                </div>
            </div>
        {:else}
            <div class="bg-[--background-secondary] mb-3 p-1 pl-4 pr-4 rounded-t-lg rounded-br-lg w-fit max-w-[80%]">
                <span
                    class="break-words text-[--text-normal]"
                    use:html={message.content}
                    style="background: transparent;"
                    on:mouseover={onMouseOver}
                    on:click={onClick}
                />
                <div class="text-[--text-normal] hover:text-[--text-accent-hover] w-6" on:click|preventDefault={toClipboard(message.content)}>
                    <MdContentCopy />
                </div>
            </div>
        {/if}
    {/each}
</div>
