<script lang="ts">
import { chatLayout } from "../../stores/state.svelte";

interface Props {
	progress?: number; // Progress value from 0 to 100
}

let { progress = 0 }: Props = $props();
</script>

<progress
    style="--dynamic-color: {chatLayout.isSidebar
        ? 'var(--background-secondary-alt)'
        : 'var(--background-primary-alt)'};"
    class="custom-progress border-1 my-2 h-2 w-full rounded-lg border border-solid border-[--background-modifier-border]"
    value={progress}
    max="100"
></progress>

<style>
    .custom-progress {
        -webkit-appearance: none;
        appearance: none;
    }
    .custom-progress::-webkit-progress-bar {
        background: var(--dynamic-color);
        box-shadow: 0px 0px 0px 0.3px var(--background-modifier-form-field)
            inset;
        border-radius: 8px;
        overflow: hidden;
    }

    .custom-progress::-webkit-progress-value {
        border-radius: 8px;
        background: var(--color-accent);
    }

    .custom-progress::-moz-progress-bar {
        background: var(--dynamic-color);
        box-shadow: 0px 0px 0px 0.3px var(--background-modifier-form-field)
            inset;
        border-radius: 0px;
        overflow: hidden;
    }
</style>
