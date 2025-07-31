<script lang="ts">
    interface Props {
        chatName: string;
    }

    const { chatName }: Props = $props();
</script>

<div class="mx-2">{chatName}</div>
