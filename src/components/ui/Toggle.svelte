<script lang="ts">
interface Props {
	checked?: boolean;
	disabled?: boolean;
	onchange?: (checked: boolean) => void;
}

let { checked = $bindable(false), disabled = false, onchange }: Props = $props();

function handleChange() {
	const newValue = !checked;
	checked = newValue;
	onchange?.(newValue);
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		handleChange();
	}
}
</script>

<!--
  Obsidian's native toggle structure:
  <label class="checkbox-container is-enabled">
    <input type="checkbox">
  </label>
  The ::before pseudo-element on .checkbox-container creates the toggle knob.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<label
	class="checkbox-container"
	class:is-enabled={checked}
	tabindex={disabled ? -1 : 0}
	onkeydown={handleKeydown}
>
	<input type="checkbox" tabindex={-1} {checked} {disabled} onchange={handleChange} />
</label>

<style>
	/* The toggle usually sits in a crowded flex row (ManagedEntityItem's action
	   cluster: delete / settings / duplicate / toggle). Those icon buttons are
	   pinned to a 44px touch floor on mobile, so the row overflows a phone's
	   width and flexbox looks for something to compress — and the toggle, with no
	   shrink guard of its own, is the only thing that gives. The track squashes
	   horizontally and core's round knob is squeezed into an ellipse with it.

	   Pinning the basis to the track's own width keeps it circular. Sized from
	   Obsidian's toggle variables rather than literals so themes that restyle the
	   switch still get an accurate reservation. */
	.checkbox-container {
		flex-shrink: 0;
		width: var(--toggle-width, 40px);
	}
</style>
