<script lang="ts">
interface Props {
	isToggled?: boolean;
	checked?: boolean;
	disabled?: boolean;
	changeFunc?: () => void;
	onchange?: (checked: boolean) => void;
}

let { isToggled, checked = $bindable(false), disabled = false, changeFunc, onchange }: Props = $props();

// Support both old API (isToggled/changeFunc) and new API (checked/onchange)
const isChecked = $derived(isToggled ?? checked);

function handleChange() {
	const newValue = !isChecked;
	checked = newValue;
	// Call legacy changeFunc if provided (it toggles, doesn't receive value)
	changeFunc?.();
	// Call new onchange if provided
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
  The ::before pseudo-element on .checkbox-container creates the toggle knob
-->
<label
	class="checkbox-container"
	class:is-enabled={isChecked}
	tabindex={disabled ? -1 : 0}
	onkeydown={handleKeydown}
>
	<input type="checkbox" tabindex={-1} checked={isChecked} {disabled} onchange={handleChange} />
</label>
