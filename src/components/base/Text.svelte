<script lang="ts">
interface BaseProps {
	placeholder?: string;
	styles?: string;
}

interface TextInputProps extends BaseProps {
	inputType: "text";
	value: string;
	changeFunc?: (value: string) => void;
	focusFunc?: (value: string) => void;
	blurFunc?: (value: string) => void;
}

interface NumberInputProps extends BaseProps {
	inputType: "number";
	value: number;
	changeFunc?: (value: number) => void;
	focusFunc?: (value: number) => void;
	blurFunc?: (value: number) => void;
}

type Props = TextInputProps | NumberInputProps;

let {
	inputType = "text",
	placeholder = "",
	styles = "",
	changeFunc,
	focusFunc,
	blurFunc,
	value = $bindable(),
}: Props = $props();
</script>

{#if inputType === 'text'}
    <input
        bind:value
        class={styles}
        type="text"
        spellcheck="false"
        {placeholder}
        onfocus={() => focusFunc?.(value!)}
        onblur={() => blurFunc?.(value!)}
        onchange={() => changeFunc?.(value!)}
    />
{:else if inputType === 'number'}
    <input
        type="number"
        spellcheck="false"
        {placeholder}
        bind:value
        onblur={() => blurFunc?.(value || 0)}
        onfocus={() => focusFunc?.(value || 0)}
        onchange={() => changeFunc?.(value || 0)}
    />
{/if}
