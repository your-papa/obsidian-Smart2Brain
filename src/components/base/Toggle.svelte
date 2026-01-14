<script lang="ts">
interface Props {
	isToggled: boolean;
	changeFunc: () => void;
}

const { isToggled = false, changeFunc }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="checkbox-container" class:is-enabled={isToggled} onclick={changeFunc}>
    <input type="checkbox" tabindex="0" />
</div>
