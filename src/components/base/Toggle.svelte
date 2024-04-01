<script lang="ts">
    export let isEnabled: boolean = false;
    export let changeFunc: () => void;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="checkbox-container" class:is-enabled={isEnabled} on:click={changeFunc}>
    <input type="checkbox" tabindex="0" />
</div>
