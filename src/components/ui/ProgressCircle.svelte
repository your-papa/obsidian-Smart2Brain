<script lang="ts">
import { onMount } from "svelte";
import { cubicOut } from "svelte/easing";
import { tweened } from "svelte/motion";
import { chatLayout } from "../../stores/state.svelte";

interface Props {
	progress?: number; // Progress value from 0 to 100
}

let { progress = 0 }: Props = $props();
const radius = 45; // Radius of the circle
const circumference = 2 * Math.PI * radius; // Circumference of the circle
const progressValue = tweened(0, {
	duration: 400,
	easing: cubicOut,
});

// Watch for changes in progress and update the progressValue accordingly
$effect(() => {
	progressValue.set(progress);
});

// Calculate the stroke dashoffset based on the progress
let strokeDashoffset = $derived(circumference - (progress / 100) * circumference);

onMount(() => {
	progressValue.set(progress);
});
</script>

<svg class="h-6 w-6 -rotate-90" viewBox="0 0 100 100">
    <circle
        class="stroke-current {chatLayout.isSidebar
            ? 'text-[--background-secondary-alt]'
            : 'text-[--background-primary-alt]'}"
        fill="none"
        stroke-width="10"
        cx="50"
        cy="50"
        r={radius}
    />
    <circle
        class="stroke-current text-[--color-accent]"
        fill="none"
        stroke-width="10"
        cx="50"
        cy="50"
        r={radius}
        stroke-dasharray={circumference}
        style="stroke-dashoffset: {strokeDashoffset};"
    />
</svg>
