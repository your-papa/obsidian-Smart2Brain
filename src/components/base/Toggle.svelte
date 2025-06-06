<script lang="ts">
    interface Props {
        isEnabled?: boolean;
        changeFunc: () => void;
    }

    let { isEnabled = false, changeFunc }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="checkbox-container" class:is-enabled={isEnabled} onclick={changeFunc}>
    <input type="checkbox" tabindex="0" />
</div>
