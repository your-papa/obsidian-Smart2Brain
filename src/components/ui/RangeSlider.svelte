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
</script>

<div class="flex items-center gap-2 {className}">
	{#if showValue}
		<output class="text-ui-small text-text-muted w-8 text-right">{value}</output>
	{/if}
	<input
		type="range"
		class="s2b-range w-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
	 * Deliberately no track or thumb styling: Obsidian paints the track through
	 * `background` on the input itself, and overriding it here would drop the
	 * user's theme for a hand-rolled slider. Only the touch behaviour changes.
	 */
	.s2b-range {
		touch-action: pan-y;
	}

	/* A 6px-tall element is thinner than a fingertip, so most taps missed it
	   outright. A transparent border enlarges the hit area without entering the
	   background painting area, so Obsidian's track keeps drawing exactly as the
	   theme intended — `padding` + `background-clip: content-box` was tried first
	   and erased the rail, leaving a thumb floating over nothing. Mobile only: a
	   mouse is precise enough, and the extra height would loosen the desktop
	   panel's rhythm. */
	:global(.is-mobile) .s2b-range {
		border-top: 10px solid transparent;
		border-bottom: 10px solid transparent;
		box-sizing: content-box;
	}
</style>
