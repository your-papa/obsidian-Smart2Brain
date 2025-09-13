<script lang="ts">
    interface Props {
        chatName: string;
    }

    const { chatName }: Props = $props();
</script>

<div
    class="border-solid border-[--background-modifier-border] rounded-lg px-2 py-1π"
>
    {chatName}
</div>
