<script lang="ts">
    import Button from "../base/Button.svelte";
    import type { CurrentSession, Messenger } from "./chatState.svelte";

    interface Props {
        messenger: Messenger;
        currentSession: CurrentSession;
    }

    const { messenger, currentSession }: Props = $props();

    function updateChatTitle() {
        if (
            currentSession.session &&
            currentSession.session.getTitle() !== title
        ) {
            currentSession.session.setTitle(title);
        }
    }

    let title = $derived(currentSession.session?.getTitle() ?? "New Thread");

    function openMenu() {
        currentSession.session = null;
    }
</script>

<div
    class="flex flex-row gap-1 w-full sticky top-0 bg-[--background-primary] pt-[var(--size-2-3)]"
>
    <input
        class="flex-1 border-solid border-[--background-modifier-border] rounded-lg px-2 py-1 !text-sm"
        bind:value={title}
        onblur={() => updateChatTitle()}
        type="text"
        spellcheck="false"
    />
    {#if currentSession.session}
        <Button iconId="menu" onClick={() => openMenu()} />
    {/if}
</div>
