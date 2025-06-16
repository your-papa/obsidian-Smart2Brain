<script lang="ts">
interface Props {
	inputType?: "text" | "number";
	placeholder?: string;
	styles?: string;
	changeFunc: (value: string) => void;
	focusFunc?: any;
	blurFunc?: any;
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
        class={styles}
        type="text"
        spellcheck="false"
        {placeholder}
        onfocus={() => focusFunc()}
        onblur={() => blurFunc()}
        bind:value
        onchange={() => changeFunc(value)}
    />
{:else if inputType === 'number'}
    <input
        type="number"
        spellcheck="false"
        {placeholder}
        bind:value
        onblur={() => blurFunc()}
        onfocus={() => focusFunc()}
        onchange={() => changeFunc(value)}
    />
{/if}
