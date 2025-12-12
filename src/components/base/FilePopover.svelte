<script lang="ts">
    import { Combobox } from "bits-ui";
    import type { TFile } from "obsidian";

    interface Props {
        customAnchor: HTMLElement;
        isOpen: boolean;
        files: TFile[];
        searchQuery: string;
        comboInputRef?: HTMLInputElement | null;
        onFileSelect: (fileName: string) => void;
    }

    let {
        customAnchor,
        isOpen = $bindable(false),
        files,
        searchQuery,
        comboInputRef = $bindable<HTMLInputElement | null>(null),
        onFileSelect,
    }: Props = $props();

    let searchValue = $state("");

    function handleValueChange(newVal: string) {
        if (newVal) {
            onFileSelect(newVal);
        }
    }

    const filteredFiles = $derived(
        searchQuery === ""
            ? files
            : files.filter((file) =>
                  file.basename
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase()),
              ),
    );
</script>

<Combobox.Root
    type="single"
    bind:open={isOpen}
    onValueChange={handleValueChange}
>
    <!-- Hidden input to receive key handling from Bits UI -->
    <Combobox.Input
        bind:ref={comboInputRef}
        oninput={(e) => console.log(e.currentTarget.value)}
        class="sr-only"
    />
    <Combobox.Portal>
        <Combobox.Content
            {customAnchor}
            class="suggestion-container !relative"
            sideOffset={2}
            side={"top"}
            align="start"
        >
            {#each filteredFiles as file, i (i + file.basename)}
                <Combobox.Item
                    class="suggestion-item mod-complex data-[highlighted]:bg-[--background-modifier-hover]"
                    value={file.basename}
                    label={file.basename}
                >
                    {#snippet children({ selected })}
                        <div class="suggestion-content">
                            <div class="suggestion-title">
                                {file.basename}
                            </div>
                            <div class="suggestion-note">
                                {file.parent?.path}
                            </div>
                        </div>
                    {/snippet}
                </Combobox.Item>
            {:else}
                <span class="block px-5 py-2 text-sm"> No match found. </span>
            {/each}
        </Combobox.Content>
    </Combobox.Portal>
</Combobox.Root>
