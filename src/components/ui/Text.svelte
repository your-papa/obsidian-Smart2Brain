<script lang="ts">
interface BaseProps {
	placeholder?: string;
	styles?: string;
	class?: string;
	disabled?: boolean;
}

interface TextInputProps extends BaseProps {
	inputType: "text" | "password" | "secret";
	value: string;
	changeFunc?: (value: string) => void;
	focusFunc?: (value: string) => void;
	blurFunc?: (value: string) => void;
	onchange?: (value: string) => void;
	onfocus?: (value: string) => void;
	onblur?: (value: string) => void;
}

interface NumberInputProps extends BaseProps {
	inputType: "number";
	value: number;
	changeFunc?: (value: number) => void;
	focusFunc?: (value: number) => void;
	blurFunc?: (value: number) => void;
	onchange?: (value: number) => void;
	onfocus?: (value: number) => void;
	onblur?: (value: number) => void;
}

type Props = TextInputProps | NumberInputProps;

let {
	inputType = "text",
	placeholder = "",
	styles = "",
	class: className = "",
	disabled = false,
	changeFunc,
	focusFunc,
	blurFunc,
	onchange,
	onfocus,
	onblur,
	value = $bindable(),
}: Props = $props();

// Combined class
const inputClass = $derived(`${styles} ${className}`.trim());

// Type-safe callback helpers - support both old and new API
function handleStringChange(val: string) {
	(changeFunc as ((v: string) => void) | undefined)?.(val);
	(onchange as ((v: string) => void) | undefined)?.(val);
}
function handleStringFocus(val: string) {
	(focusFunc as ((v: string) => void) | undefined)?.(val);
	(onfocus as ((v: string) => void) | undefined)?.(val);
}
function handleStringBlur(val: string) {
	(blurFunc as ((v: string) => void) | undefined)?.(val);
	(onblur as ((v: string) => void) | undefined)?.(val);
}
function handleNumberChange(val: number) {
	(changeFunc as ((v: number) => void) | undefined)?.(val);
	(onchange as ((v: number) => void) | undefined)?.(val);
}
function handleNumberFocus(val: number) {
	(focusFunc as ((v: number) => void) | undefined)?.(val);
	(onfocus as ((v: number) => void) | undefined)?.(val);
}
function handleNumberBlur(val: number) {
	(blurFunc as ((v: number) => void) | undefined)?.(val);
	(onblur as ((v: number) => void) | undefined)?.(val);
}

let isFocused = $state(false);

/**
 * Masks a secret value for display.
 * Shows first 3 chars + "..." + last 3 chars for longer values.
 * e.g., "sk-abc123xyz" -> "sk-...xyz"
 */
function maskSecret(val: string): string {
	if (!val || val.length <= 9) return val;
	const prefix = val.slice(0, 3);
	const suffix = val.slice(-4);
	return `${prefix}...${suffix}`;
}

const displayValue = $derived(
	inputType === "secret" && !isFocused && typeof value === "string" ? maskSecret(value) : value,
);
</script>

{#if inputType === "text" || inputType === "password"}
	<input
		bind:value
		class={inputClass}
		type={inputType}
		spellcheck="false"
		{placeholder}
		{disabled}
		onfocus={() => handleStringFocus(value as string)}
		onblur={() => handleStringBlur(value as string)}
		onchange={() => handleStringChange(value as string)}
	/>
{:else if inputType === "secret"}
	<input
		class={inputClass}
		type="text"
		spellcheck="false"
		{placeholder}
		{disabled}
		value={displayValue}
		onfocus={() => {
			isFocused = true;
			handleStringFocus(value as string);
		}}
		onblur={(e) => {
			isFocused = false;
			value = e.currentTarget.value;
			handleStringBlur(value as string);
		}}
		oninput={(e) => {
			value = e.currentTarget.value;
		}}
		onchange={() => handleStringChange(value as string)}
	/>
{:else if inputType === "number"}
	<input
		type="number"
		class={inputClass}
		spellcheck="false"
		{placeholder}
		{disabled}
		bind:value
		onblur={() => handleNumberBlur((value as number) || 0)}
		onfocus={() => handleNumberFocus((value as number) || 0)}
		onchange={() => handleNumberChange((value as number) || 0)}
	/>
{/if}
