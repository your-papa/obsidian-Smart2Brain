<script lang="ts">
    interface BaseProps {
        placeholder?: string;
        styles?: string;
    }

    interface TextInputProps extends BaseProps {
        inputType: "text" | "password" | "secret";
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

    const {
        inputType = "text",
        placeholder = "",
        styles = "",
        changeFunc,
        focusFunc,
        blurFunc,
        value = $bindable(),
    }: Props = $props();

    // Type-safe callback helpers
    const stringChangeFunc = changeFunc as
        | ((value: string) => void)
        | undefined;
    const stringFocusFunc = focusFunc as ((value: string) => void) | undefined;
    const stringBlurFunc = blurFunc as ((value: string) => void) | undefined;
    const numberChangeFunc = changeFunc as
        | ((value: number) => void)
        | undefined;
    const numberFocusFunc = focusFunc as ((value: number) => void) | undefined;
    const numberBlurFunc = blurFunc as ((value: number) => void) | undefined;

    const isFocused = $state(false);

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
        inputType === "secret" && !isFocused && typeof value === "string"
            ? maskSecret(value)
            : value,
    );
</script>

{#if inputType === "text" || inputType === "password"}
    <input
        bind:value
        class={styles}
        type={inputType}
        spellcheck="false"
        {placeholder}
        onfocus={() => stringFocusFunc?.(value as string)}
        onblur={() => stringBlurFunc?.(value as string)}
        onchange={() => stringChangeFunc?.(value as string)}
    />
{:else if inputType === "secret"}
    <input
        class={styles}
        type="text"
        spellcheck="false"
        {placeholder}
        value={displayValue}
        onfocus={() => {
            isFocused = true;
            stringFocusFunc?.(value as string);
        }}
        onblur={(e) => {
            isFocused = false;
            value = e.currentTarget.value;
            stringBlurFunc?.(value as string);
        }}
        oninput={(e) => {
            value = e.currentTarget.value;
        }}
        onchange={() => stringChangeFunc?.(value as string)}
    />
{:else if inputType === "number"}
    <input
        type="number"
        spellcheck="false"
        {placeholder}
        bind:value
        onblur={() => numberBlurFunc?.((value as number) || 0)}
        onfocus={() => numberFocusFunc?.((value as number) || 0)}
        onchange={() => numberChangeFunc?.((value as number) || 0)}
    />
{/if}
