<script lang="ts">
interface Props {
	value?: number;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	showValue?: boolean;
	class?: string;
	onchange?: (value: number) => void;
	oncommit?: (value: number) => void;
}

let {
	value = $bindable(50),
	min = 0,
	max = 100,
	step = 1,
	disabled = false,
	showValue = false,
	class: className = "",
	onchange,
	oncommit,
}: Props = $props();

function handleInput(e: Event) {
	const target = e.target as HTMLInputElement;
	value = Number(target.value);
	onchange?.(value);
}

function handleChange(e: Event) {
	const target = e.target as HTMLInputElement;
	value = Number(target.value);
	oncommit?.(value);
}

/**
 * How far along the track the value sits, 0–1.
 *
 * Obsidian paints the filled part of the track itself, from a
 * `linear-gradient` on `input[type="range"].slider` that reads this variable —
 * the same way its own `SliderComponent` sets it inline. Without it the
 * gradient resolves to a 0% fill and the control renders as a bare grey rail,
 * which is why this looked hand-rolled next to a native slider.
 */
const fillRatio = $derived.by(() => {
	const span = max - min;
	if (span <= 0) return 0;
	return Math.min(1, Math.max(0, (value - min) / span));
});
</script>

<div class="flex items-center gap-2 {className}">
	{#if showValue}
		<output class="text-ui-small text-text-muted w-8 text-right">{value}</output>
	{/if}
	<!-- `slider` is Obsidian's own class: it is what opts this input into the
	     native filled track (and the theme's thumb sizing) rather than the bare
	     rail the base `input[type="range"]` rule gives. -->
	<input
		type="range"
		class="slider s2b-range w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
		style="--slider-fill-ratio: {fillRatio};"
		{value}
		{min}
		{max}
		{step}
		{disabled}
		oninput={handleInput}
		onchange={handleChange}
	/>
</div>

<style>
	/*
	 * `touch-action: none` is the load-bearing line on mobile.
	 *
	 * Obsidian's mobile CSS leaves range inputs at `touch-action: manipulation`,
	 * which declares "this element does not handle panning" — so a horizontal drag
	 * on the slider is handed to Obsidian's sidebar-swipe gesture instead of moving
	 * the thumb. Dragging the granularity slider opened the sidebar rather than
	 * changing the value. Claiming the gesture here keeps the drag with the
	 * control the finger is actually on.
	 *
	 * `pan-y` rather than `none`: the panel this lives in scrolls vertically and
	 * is taller than a phone screen, so a slider that swallowed both axes would
	 * become a dead zone you cannot scroll past. Horizontal goes to the thumb,
	 * vertical still scrolls the panel.
	 *
	 * Deliberately no track or thumb styling: Obsidian paints both itself off the
	 * `slider` class and the `--slider-fill-ratio` we set inline, and overriding
	 * either here would drop the user's theme for a hand-rolled slider. Only the
	 * touch behaviour changes.
	 */
	.s2b-range {
		touch-action: pan-y;
	}

	/* No transparent border to grow the hit area on mobile.

	   That was added back when this rendered as a bare 6px rail, where the only
	   thing to aim at really was 6px tall. With the native `slider` class the
	   theme's own thumb applies at 24px, which is already a reasonable target,
	   and the border made the control 26px tall — visibly fatter than every
	   native slider next to it, which is what gave it away as non-native. The
	   thumb overflows the track box, so it stays grabbable without it. */
</style>
