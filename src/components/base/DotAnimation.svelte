<script lang="ts">
    let index = 0;
    setInterval(() => {
        index = (index + 1) % 4;
    }, 300);
</script>

{#each ['', '.', '..', '...'] as sequence, i}
    {#if i === index}
        {sequence}
    {/if}
{/each}
