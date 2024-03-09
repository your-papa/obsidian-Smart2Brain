import { plugin as p, data, chatHistory as history, type ChatMessage, isEditing, chatInput, isEditingAssistantMessage } from '../store';
import { get } from 'svelte/store';
import { MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { canRunSecondBrain, runSecondBrain } from './runSecondBrain';
import { DEFAULT_SETTINGS } from '../main';
import { nanoid } from 'nanoid';

const noBreakSpace = /\u00A0/g;
let temporaryEditingHistory: ChatMessage[] = [];

//TOOD: change sourcePath to sourceFile
export const renderMarkdown = (node: HTMLElement, content: string) => {
    const plugin = get(p);
    MarkdownRenderer.render(plugin.app, content, node, 'Chat view.md', plugin);
    const codeElem = node.querySelector('.copy-code-button');
    if (codeElem) {
        codeElem.className = 'clickable-icon';
        icon(codeElem as HTMLElement, 'copy');
    }
};

export const icon = (node: HTMLElement, iconId: string) => {
    setIcon(node, iconId);
};

export const onClick = async (e: MouseEvent) => {
    const plugin = get(p);
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
        const target = typeof href === 'string' && plugin.chatView.app.metadataCache.getFirstLinkpathDest(normalizedPath.root, plugin.chatView.file.path);

        if (!target) return;
        //@ts-expect-error Find correct type
        plugin.app.openWithDefaultApp(target.path);

        return;
    }

    // Open an internal link in a new pane
    if (closestAnchor.hasClass('internal-link')) {
        e.preventDefault();
        const destination = closestAnchor.getAttr('href');
        const inNewLeaf = e.button === 1 || e.ctrlKey || e.metaKey;

        plugin.app.workspace.openLinkText(destination, 'Chat view.md', inNewLeaf);

        return;
    }

    // Open a tag search
    if (closestAnchor.hasClass('tag')) {
        e.preventDefault();
        //@ts-expect-error Find correct type
        plugin.app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch(`tag:${closestAnchor.getAttr('href')}`);

        return;
    }

    // Open external link
    if (closestAnchor.hasClass('external-link')) {
        e.preventDefault();
        window.open(closestAnchor.getAttr('href'), '_blank');
    }
};

function getNormalizedPath(path: string): { root: string; subpath: string; alias: string } {
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

export const onMouseOver = (e: MouseEvent): void => {
    const plugin = get(p);
    const targetEl = e.target as HTMLElement;
    if (targetEl.tagName !== 'A') return;
    if (targetEl.hasClass('internal-link')) {
        plugin.chatView.app.workspace.trigger('hover-link', {
            event: e,
            hoverParent: plugin.chatView,
            targetEl,
            linktext: targetEl.getAttr('href'),
            sourcePath: plugin.chatView.file.path,
        });
    }
};

export const toClipboard = (messageText: string) => {
    navigator.clipboard.writeText(messageText);
    new Notice(`Copied to clipboard:\n${messageText}`);
};

export const redoGeneration = async (message: ChatMessage) => {
    if (!canRunSecondBrain()) return;
    const d = get(data);
    const chatHistory = get(history);
    const targetIndex = chatHistory.indexOf(message) - 1;
    const userQuery = chatHistory[targetIndex];
    history.set(chatHistory.slice(0, targetIndex));
    await runSecondBrain(d.isUsingRag, userQuery.content);
};

export function editMessage(message: ChatMessage, textarea: HTMLTextAreaElement): string {
    const chatHistory = get(history);
    isEditing.set(true);
    const targetIndex = chatHistory.indexOf(message);
    temporaryEditingHistory = chatHistory.slice(targetIndex);
    history.set(chatHistory.slice(0, targetIndex + 1));
    chatInput.set(message.content);
    textarea.focus();
    return message.id;
}

export function cancelEditing() {
    const chatHistory = get(history);
    chatHistory.pop();
    isEditing.set(false);
    chatInput.set('');
    temporaryEditingHistory[0].id = nanoid();
    history.set(chatHistory.concat(temporaryEditingHistory));
    get(p).chatView.requestSave();
}

export function editInitialAssistantMessage(initialMessage: string, textarea: HTMLTextAreaElement) {
    isEditingAssistantMessage.set(true);
    chatInput.set(initialMessage);
    textarea.focus();
    setTimeout(() => textarea.select(), 0);
}

export function cancelEditingInitialAssistantMessage(initialAssistantMessageSpan: HTMLSpanElement) {
    const plugin = get(p);
    const d = get(data);
    isEditingAssistantMessage.set(false);
    chatInput.set('');
    initialAssistantMessageSpan.innerText = '';
    renderMarkdown(initialAssistantMessageSpan, d.initialAssistantMessageContent);
    plugin.chatView.requestSave();
}

export function resetInitialAssistantMessage(initialAssistantMessageSpan: HTMLSpanElement) {
    const plugin = get(p);
    const d = get(data);
    isEditingAssistantMessage.set(false);
    chatInput.set('');
    initialAssistantMessageSpan.innerText = '';
    const initialAssistantMessageContent = DEFAULT_SETTINGS.initialAssistantMessageContent;
    renderMarkdown(initialAssistantMessageSpan, initialAssistantMessageContent);
    history.set([{ role: 'Assistant', content: initialAssistantMessageContent, id: nanoid() } as ChatMessage]);
    d.initialAssistantMessageContent = DEFAULT_SETTINGS.initialAssistantMessageContent;
    plugin.chatView.requestSave();
    plugin.saveSettings();
}
