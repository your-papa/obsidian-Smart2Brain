<script lang="ts">
    import { Select } from "bits-ui";
    import Icon from "../base/Icon.svelte";

    const themes = [
        { value: "light-monochrome", label: "Light Monochrome" },
        { value: "dark-green", label: "Dark Green" },
        { value: "svelte-orange", label: "Svelte Orange" },
        { value: "punk-pink", label: "Punk Pink" },
        { value: "ocean-blue", label: "Ocean Blue", disabled: true },
        { value: "sunset-orange", label: "Sunset Orange" },
        { value: "sunset-red", label: "Sunset Red" },
        { value: "forest-green", label: "Forest Green" },
        { value: "lavender-purple", label: "Lavender Purple", disabled: true },
        { value: "mustard-yellow", label: "Mustard Yellow" },
        { value: "slate-gray", label: "Slate Gray" },
        { value: "neon-green", label: "Neon Green" },
        { value: "coral-reef", label: "Coral Reef" },
        { value: "midnight-blue", label: "Midnight Blue" },
        { value: "crimson-red", label: "Crimson Red" },
        { value: "mint-green", label: "Mint Green" },
        { value: "pastel-pink", label: "Pastel Pink" },
        { value: "golden-yellow", label: "Golden Yellow" },
        { value: "deep-purple", label: "Deep Purple" },
        { value: "turquoise-blue", label: "Turquoise Blue" },
        { value: "burnt-orange", label: "Burnt Orange" },
    ];

    let value = $state<string>("");
    const selectedLabel = $derived(
        value
            ? themes.find((theme) => theme.value === value)?.label
            : "Select a theme",
    );
</script>

<Select.Root type="single" onValueChange={(v) => (value = v)} items={themes}>
    <Select.Trigger class="!pr-[6px] !pl-3 items-center h-30">
        <div class="flex h-4">{selectedLabel}</div>
        <div class="flex items-center h-4 pl-2 ml-auto">
            <Icon name="chevrons-up-down" size="14px" class="text-gray-400" />
        </div>
    </Select.Trigger>
    <Select.Portal>
        <Select.Content
            class="bg-[--background-secondary] select-none max-h-[--popover-height] z-[--layer-menu] rounded-xl border border-solid border-[--background-secondary-alt]"
            sideOffset={10}
        >
            <Select.ScrollUpButton
                class="flex w-full items-center justify-center"
            >
                <Icon name="chevron-up" />
            </Select.ScrollUpButton>
            <Select.Viewport class="p-1">
                {#each themes as theme, i (i + theme.value)}
                    <Select.Item
                        class="rounded-button data-highlighted:bg-muted outline-hidden data-disabled:opacity-50 flex h-10 w-full select-none items-center py-3 pl-5 pr-1.5 text-sm capitalize"
                        value={theme.value}
                        label={theme.label}
                        disabled={theme.disabled}
                    >
                        {#snippet children({ selected })}
                            {theme.label}
                        {/snippet}
                    </Select.Item>
                {/each}
            </Select.Viewport>
            <Select.ScrollDownButton
                class="flex w-full items-center justify-center"
            >
                <Icon name="chevron-down" />
            </Select.ScrollDownButton>
        </Select.Content>
    </Select.Portal>
</Select.Root>
