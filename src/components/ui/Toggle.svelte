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

<!--
  Deliberately unstyled: core sizes `.checkbox-container` from the `--toggle-s-*`
  set (`width: var(--toggle-s-width)`, height derived from
  `--toggle-s-thumb-height`) and already sets `flex-shrink: 0` itself. Overriding
  only the width — e.g. with the larger `--toggle-width` — stretches the track
  while the knob and height stay on the small-variant values, which is what
  turns the switch into a flat lozenge. Let core own the geometry.
-->
