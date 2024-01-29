<script lang="ts">
    export let isEnabled: boolean = false;
    export let changeFunc: () => void;
</script>

<div class="checkbox-container {isEnabled ? 'is-enabled' : ''}" on:click={changeFunc}>
    <input type="checkbox" tabindex="0" />
</div>
