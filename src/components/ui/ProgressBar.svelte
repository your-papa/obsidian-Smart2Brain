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
    class="my-2 h-2 w-full rounded-lg border border-solid border-[--background-modifier-border] appearance-none [&::-webkit-progress-bar]:bg-[--dynamic-color] [&::-webkit-progress-bar]:shadow-[0px_0px_0px_0.3px_var(--background-modifier-form-field)_inset] [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-bar]:overflow-hidden [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-value]:bg-[--color-accent] [&::-moz-progress-bar]:bg-[--dynamic-color] [&::-moz-progress-bar]:shadow-[0px_0px_0px_0.3px_var(--background-modifier-form-field)_inset] [&::-moz-progress-bar]:rounded-none [&::-moz-progress-bar]:overflow-hidden"
    value={progress}
    max="100"
></progress>
