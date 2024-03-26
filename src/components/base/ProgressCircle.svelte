<script lang="ts">
    import { isChatInSidebar } from '../../store';
    import { onMount } from 'svelte';
    import { tweened } from 'svelte/motion';
    import { cubicOut } from 'svelte/easing';

    export let progress = 0; // Progress value from 0 to 100
    const radius = 45; // Radius of the circle
    const circumference = 2 * Math.PI * radius; // Circumference of the circle
    const progressValue = tweened(0, {
        duration: 400,
        easing: cubicOut,
    });

    // Watch for changes in progress and update the progressValue accordingly
    $: progress, progressValue.set(progress);

    // Calculate the stroke dashoffset based on the progress
    $: strokeDashoffset = circumference - (progress / 100) * circumference;

    onMount(() => {
        progressValue.set(progress);
    });
</script>

<svg class="h-6 w-6 -rotate-90" viewBox="0 0 100 100">
    <circle
        class="stroke-current {$isChatInSidebar ? 'text-[--background-secondary-alt]' : 'text-[--background-primary-alt]'}"
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
