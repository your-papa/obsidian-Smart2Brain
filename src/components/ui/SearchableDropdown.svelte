<script lang="ts" generics="T">
import { Popover } from "bits-ui";
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";

type DropdownOption<T> = {
	label: string;
	value: T;
	disabled?: boolean;
	/** Optional group key - options with same group will be grouped together */
	group?: string;
};

type DropdownGroup<T> = {
	label: string;
	options: DropdownOption<T>[];
};

// Props can either have flat options or grouped options
type BaseProps<T> = {
	selected?: T;
	placeholder?: string;
	searchPlaceholder?: string;
	disabled?: boolean;
	class?: string;
	onSelect?: (value: T) => void;
	/** Custom render snippet for each option. Receives the option and selected state. */
	renderOption?: Snippet<[{ option: DropdownOption<T>; selected: boolean }]>;
	/** Custom render snippet for the selected value in the trigger. */
	renderSelected?: Snippet<[{ option: DropdownOption<T> }]>;
	/** Custom render snippet for group headers. */
	renderGroupHeader?: Snippet<[{ group: string }]>;
};

type FlatProps<T> = BaseProps<T> & {
	options: DropdownOption<T>[];
	groups?: never;
};

type GroupedProps<T> = BaseProps<T> & {
	options?: never;
	groups: DropdownGroup<T>[];
};

type Props<T> = FlatProps<T> | GroupedProps<T>;

let {
	options,
	groups,
	selected = $bindable(),
	placeholder = "Select...",
	searchPlaceholder = "Search...",
	disabled = false,
	class: className = "",
	onSelect,
	renderOption,
	renderSelected,
	renderGroupHeader,
}: Props<T> = $props();

let searchQuery = $state("");
let open = $state(false);
let triggerEl: HTMLButtonElement | undefined = $state();
let searchInputEl: HTMLInputElement | undefined = $state();

// Normalize to groups format - either use provided groups or create from flat options
const normalizedGroups = $derived.by(() => {
	if (groups) {
		return groups;
	}

	if (!options) return [];

	// Check if any options have group property
	const hasGroups = options.some((opt) => opt.group);

	if (!hasGroups) {
		// Return single unnamed group with all options
		return [{ label: "", options }];
	}

	// Group options by their group property
	const groupMap = new Map<string, DropdownOption<T>[]>();
	for (const opt of options) {
		const groupKey = opt.group ?? "";
		const existing = groupMap.get(groupKey);
		if (existing) {
			existing.push(opt);
		} else {
			groupMap.set(groupKey, [opt]);
		}
	}

	return Array.from(groupMap.entries()).map(([label, opts]) => ({
		label,
		options: opts,
	}));
});

// Filter groups and options based on search query
const filteredGroups = $derived.by(() => {
	if (searchQuery.trim() === "") {
		return normalizedGroups;
	}

	const query = searchQuery.toLowerCase();
	return normalizedGroups
		.map((group) => ({
			...group,
			options: group.options.filter((opt) => opt.label.toLowerCase().includes(query)),
		}))
		.filter((group) => group.options.length > 0);
});

// Flatten all options for finding selected
const allOptions = $derived(normalizedGroups.flatMap((g) => g.options));

// Get the currently selected option
const selectedOption = $derived(allOptions.find((opt) => opt.value === selected));

// Check if we have any results
const hasResults = $derived(filteredGroups.some((g) => g.options.length > 0));

function handleSelect(opt: DropdownOption<T>) {
	if (opt.disabled) return;
	selected = opt.value;
	onSelect?.(opt.value);
	open = false;
	searchQuery = "";
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		open = false;
		searchQuery = "";
		triggerEl?.focus();
	}
}

// Focus search input when popover opens
$effect(() => {
	if (open && searchInputEl) {
		requestAnimationFrame(() => {
			searchInputEl?.focus();
		});
	}
});
</script>

<Popover.Root
    bind:open
    onOpenChange={(isOpen) => {
        if (disabled && isOpen) {
            open = false;
            return;
        }
        if (!isOpen) searchQuery = "";
    }}
>
    <Popover.Trigger class={className} aria-label={placeholder}>
        {#snippet child({ props })}
            <button
                {...props}
                bind:this={triggerEl}
                disabled={disabled || undefined}
                class="flex items-center justify-between gap-2 py-1 px-3 rounded-[--input-radius] border border-solid border-[--background-modifier-border] bg-[--background-modifier-form-field] text-[--text-normal] text-ui-small cursor-pointer min-w-[140px] text-left hover:bg-[--background-modifier-form-field-highlighted] focus-visible:shadow-[0_0_0_2px_var(--background-modifier-border-focus)] focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span
                    class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-2"
                >
                    {#if selectedOption}
                        {#if renderSelected}
                            {@render renderSelected({ option: selectedOption })}
                        {:else}
                            {selectedOption.label}
                        {/if}
                    {:else}
                        <span class="text-[--text-muted]">{placeholder}</span>
                    {/if}
                </span>
                <Icon
                    name="chevron-down"
                    size="xs"
                    class="flex-shrink-0 text-[--text-muted] transition-transform duration-150 {open
                        ? 'rotate-180'
                        : ''}"
                />
            </button>
        {/snippet}
    </Popover.Trigger>

    <Popover.Portal>
        <Popover.Content
            class="!bg-[--background-primary] !border !border-solid !border-[--background-modifier-border] !rounded-lg !shadow-md min-w-[--radix-popover-trigger-width] max-w-[400px] overflow-hidden z-[--layer-menu] flex flex-col"
            sideOffset={4}
            align="start"
            onkeydown={handleKeydown}
        >
            <!-- Search input -->
            <div
                class="flex items-center gap-2 py-2 px-3 border-b border-solid ob-border-b border-[--background-modifier-border]"
            >
                <Icon
                    name="search"
                    size="xs"
                    class="flex-shrink-0 text-[--text-muted]"
                />
                <input
                    bind:this={searchInputEl}
                    type="text"
                    class="!flex-1 !border-none !bg-transparent !text-[--text-normal] text-ui-small !outline-none !shadow-none min-w-0 placeholder:text-[--text-faint]"
                    placeholder={searchPlaceholder}
                    bind:value={searchQuery}
                />
                {#if searchQuery}
                    <button
                        type="button"
                        class="clickable-icon flex-shrink-0 !p-0.5"
                        onclick={() => {
                            searchQuery = "";
                            searchInputEl?.focus();
                        }}
                        aria-label="Clear search"
                    >
                        <Icon name="x" size="xs" />
                    </button>
                {/if}
            </div>

            <!-- Options list -->
            <div class="overflow-y-auto max-h-64 py-1 px-1">
                {#if !hasResults}
                    <div
                        class="p-4 text-center text-[--text-muted] text-ui-small"
                    >
                        No results found
                    </div>
                {:else}
                    {#each filteredGroups as group, groupIdx (group.label)}
                        {#if group.options.length > 0}
                            <!-- Group header (only show if group has a label) -->
                            {#if group.label}
                                <div
                                    class="flex items-center gap-2 py-1 px-2 text-ui-smaller font-semibold text-[--text-muted] tracking-wide {groupIdx >
                                    0
                                        ? 'mt-1'
                                        : ''}"
                                >
                                    {#if renderGroupHeader}
                                        {@render renderGroupHeader({
                                            group: group.label,
                                        })}
                                    {:else}
                                        {group.label}
                                    {/if}
                                </div>
                            {/if}

                            <!-- Group options -->
                            {#each group.options as opt (opt.value)}
                                <button
                                    type="button"
                                    class="!flex items-center justify-between gap-2 w-full !py-1.5 !px-2 !border-none !rounded-md !shadow-none cursor-pointer !text-[--text-normal] text-ui-small text-left {selected ===
                                    opt.value
                                        ? '!bg-[--background-modifier-active-hover]'
                                        : '!bg-transparent hover:!bg-[--background-modifier-hover]'} {opt.disabled
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''} {group.label ? '!pl-4' : ''}"
                                    disabled={opt.disabled}
                                    onclick={() => handleSelect(opt)}
                                >
                                    {#if renderOption}
                                        {@render renderOption({
                                            option: opt,
                                            selected: selected === opt.value,
                                        })}
                                    {:else}
                                        <span>{opt.label}</span>
                                        {#if selected === opt.value}
                                            <Icon
                                                name="check"
                                                size="xs"
                                                class="flex-shrink-0 text-[--text-accent]"
                                            />
                                        {/if}
                                    {/if}
                                </button>
                            {/each}
                        {/if}
                    {/each}
                {/if}
            </div>
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>
