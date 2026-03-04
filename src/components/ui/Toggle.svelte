<script lang="ts">
interface Props {
<<<<<<< ours
||||||| ancestor
	isToggled?: boolean;
=======
	id?: string;
>>>>>>> theirs
	checked?: boolean;
	disabled?: boolean;
	onchange?: (checked: boolean) => void;
}

<<<<<<< ours
let { checked = $bindable(false), disabled = false, onchange }: Props = $props();
||||||| ancestor
let { isToggled, checked = $bindable(false), disabled = false, changeFunc, onchange }: Props = $props();

// Support both old API (isToggled/changeFunc) and new API (checked/onchange)
const isChecked = $derived(isToggled ?? checked);
=======
let { id, checked = $bindable(false), disabled = false, onchange }: Props = $props();
>>>>>>> theirs

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
<<<<<<< ours
	class:is-enabled={checked}
	tabindex={disabled ? -1 : 0}
	onkeydown={handleKeydown}
||||||| ancestor
	class:is-enabled={isChecked}
	tabindex={disabled ? -1 : 0}
	onkeydown={handleKeydown}
=======
	class:is-enabled={checked}
>>>>>>> theirs
>
<<<<<<< ours
	<input type="checkbox" tabindex={-1} {checked} {disabled} onchange={handleChange} />
||||||| ancestor
	<input type="checkbox" tabindex={-1} checked={isChecked} {disabled} onchange={handleChange} />
=======
	<input
		{id}
		type="checkbox"
		tabindex={disabled ? -1 : 0}
		checked={checked}
		{disabled}
		onchange={handleChange}
		onkeydown={handleKeydown}
	/>
>>>>>>> theirs
</label>
