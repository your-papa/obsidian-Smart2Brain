<script lang="ts">
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
            currentSession.session.setTitle(messenger, title);
        }
    }

    let title = $derived(currentSession.session?.getTitle() ?? "New Thread");
</script>

<input
    class="border-solid border-[--background-modifier-border] rounded-lg px-2 py-1 !text-sm"
    bind:value={title}
    onblur={() => updateChatTitle()}
    type="text"
    spellcheck="false"
/>
