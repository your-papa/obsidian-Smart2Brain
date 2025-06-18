<script lang="ts">
interface Props {
	inputType?: "text" | "number";
	placeholder?: string;
	styles?: string;
	changeFunc?: (value: string) => void;
	focusFunc?: (value: string) => void;
	blurFunc?: (value: string) => void;
	value?: string;
}

let {
	inputType = "text",
	placeholder = "",
	styles = "",
	changeFunc,
	focusFunc = () => {},
	blurFunc = () => {},
	value = $bindable(""),
}: Props = $props();
</script>

{#if inputType === 'text'}
    <input
        bind:value
        class={styles}
        type="text"
        spellcheck="false"
        {placeholder}
        onfocus={() => focusFunc?.(value)}
        onblur={() => blurFunc?.(value)}
        onchange={() => changeFunc?.(value)}
    />
{:else if inputType === 'number'}
    <input
        type="number"
        spellcheck="false"
        {placeholder}
        bind:value
        onblur={() => blurFunc?.(value)}
        onfocus={() => focusFunc?.(value)}
        onchange={() => changeFunc?.(value)}
    />
{/if}
