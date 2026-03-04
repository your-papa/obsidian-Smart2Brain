<script lang="ts">
interface Props {
	id?: string;
	checked?: boolean;
	disabled?: boolean;
	onchange?: (checked: boolean) => void;
}

let { id, checked = $bindable(false), disabled = false, onchange }: Props = $props();

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
  The ::before pseudo-element on .checkbox-container creates the toggle knob
-->
<label
	class="checkbox-container"
	class:is-enabled={checked}
>
	<input
		{id}
		type="checkbox"
		tabindex={disabled ? -1 : 0}
		checked={checked}
		{disabled}
		onchange={handleChange}
		onkeydown={handleKeydown}
	/>
</label>
