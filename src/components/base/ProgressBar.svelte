<script lang="ts">
    import { isChatInSidebar } from '../../store';
    export let progress = 0; // Progress value from 0 to 100
</script>

<progress
    style="--dynamic-color: {$isChatInSidebar ? 'var(--background-secondary-alt)' : 'var(--background-primary-alt)'};"
    class="custom-progress w-full"
    value={progress}
    max="100"
/>

<style>
    .custom-progress {
        -webkit-appearance: none;
        appearance: none;
    }
    .custom-progress::-webkit-progress-bar {
        background: var(--dynamic-color);
        box-shadow: 0px 0px 0px 0.3px var(--background-modifier-form-field) inset;
        border-radius: 8px;
        overflow: hidden;
    }

    .custom-progress::-webkit-progress-value {
        border-radius: 8px;
        background: var(--color-accent);
    }

    .custom-progress::-moz-progress-bar {
        background: var(--dynamic-color);
        box-shadow: 0px 0px 0px 0.3px var(--background-modifier-form-field) inset;
        border-radius: 0px;
        overflow: hidden;
    }
</style>
