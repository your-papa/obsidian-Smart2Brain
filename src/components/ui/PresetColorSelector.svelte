<script lang="ts" module>
export interface PresetColorOption {
	value: string;
	label: string;
	previewColor?: string;
	isEmpty?: boolean;
}
</script>

<script lang="ts">
  import { Popover } from "bits-ui";
  import Icon from "./Icon.svelte";

  interface Props {
    value: string;
    options: PresetColorOption[];
    popoverLabel: string;
    triggerLabel: string;
    onSelect: (value: string) => void;
  }

  let { value, options, popoverLabel, triggerLabel, onSelect }: Props = $props();

  let isOpen = $state(false);
  let customAnchor = $state<HTMLElement | undefined>();

  const selectedOption = $derived(options.find((option) => option.value === value) ?? options[0]);

  const triggerStyle =
    "width: 22px; height: 22px; min-width: 22px; min-height: 22px; max-width: 22px; max-height: 22px; border-radius: 999px; padding: 0; margin: 0; border: 0; outline: none; line-height: 0; font-size: 0; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 22px; background: transparent; background-color: transparent; box-shadow: none;";

  function resolvePreviewColor(previewColor: string | undefined): string | undefined {
    if (!previewColor) return undefined;
    const match = /^var\((--[^)]+)\)$/.exec(previewColor.trim());
    if (!match || typeof document === "undefined") return previewColor;
    const resolved = getComputedStyle(document.body).getPropertyValue(match[1]).trim();
    return resolved || previewColor;
  }

  function getCircleBackground(option: PresetColorOption | undefined): string | undefined {
    if (!option?.isEmpty) return undefined;
    return "linear-gradient(135deg, var(--background-secondary) 45%, var(--background-modifier-border) 45%, var(--background-modifier-border) 55%, var(--background-secondary) 55%)";
  }

  function getCircleBackgroundColor(option: PresetColorOption | undefined): string {
    if (option?.isEmpty) return "transparent";
    return resolvePreviewColor(option?.previewColor) ?? "transparent";
  }

  function getCircleBoxShadow(option: PresetColorOption | undefined): string {
    if (option?.isEmpty) {
      return "inset 0 0 0 1px var(--background-modifier-border)";
    }

    const previewColor = resolvePreviewColor(option?.previewColor);
    if (previewColor) {
      return `inset 0 0 0 1px color-mix(in srgb, ${previewColor} 40%, var(--background-modifier-border))`;
    }

    return "inset 0 0 0 1px var(--background-modifier-border)";
  }

  function getCircleStrokeColor(option: PresetColorOption | undefined): string {
    if (option?.isEmpty) return "var(--background-modifier-border)";
    const previewColor = resolvePreviewColor(option?.previewColor);
    return previewColor
      ? `color-mix(in srgb, ${previewColor} 40%, var(--background-modifier-border))`
      : "var(--background-modifier-border)";
  }

  function applyCircleStyle(node: HTMLElement, option: PresetColorOption | undefined) {
    function updateStyle(nextOption: PresetColorOption | undefined) {
      const background = getCircleBackground(nextOption);
      const backgroundColor = getCircleBackgroundColor(nextOption);
      const boxShadow = getCircleBoxShadow(nextOption);

      if (background) {
        node.style.setProperty("background", background);
      } else {
        node.style.removeProperty("background");
      }

      node.style.setProperty("background-color", backgroundColor);
      node.style.setProperty("box-shadow", boxShadow);
    }

    updateStyle(option);

    return {
      update(nextOption: PresetColorOption | undefined) {
        updateStyle(nextOption);
      },
    };
  }

  function handleSelect(nextValue: string) {
    onSelect(nextValue);
    isOpen = false;
  }

  function toggleOpen() {
    isOpen = !isOpen;
  }

  function handleTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOpen();
    }
  }
</script>

<button
  bind:this={customAnchor}
  type="button"
  class="s2b-color-circle-trigger"
  class:is-empty={selectedOption?.isEmpty}
  style={triggerStyle}
  title={`${triggerLabel}: ${selectedOption?.label ?? ""}`}
  aria-label={triggerLabel}
  onclick={toggleOpen}
  onkeydown={handleTriggerKeyDown}
>
  <span
    class="s2b-color-circle-icon"
    class:is-empty={selectedOption?.isEmpty}
    use:applyCircleStyle={selectedOption}
  >
    <svg class="preset-color-swatch" viewBox="0 0 22 22" aria-hidden="true">
      {#if selectedOption?.isEmpty}
        <circle
          cx="11"
          cy="11"
          r="10"
          fill="var(--background-secondary)"
          stroke="var(--background-modifier-border)"
        />
        <line
          x1="6"
          y1="16"
          x2="16"
          y2="6"
          stroke="var(--text-muted)"
          stroke-width="2"
          stroke-linecap="round"
        />
      {:else}
        <circle
          cx="11"
          cy="11"
          r="10"
          fill={getCircleBackgroundColor(selectedOption)}
          stroke={getCircleStrokeColor(selectedOption)}
        />
      {/if}
    </svg>
    {#if selectedOption?.isEmpty}
      <Icon name="slash" size="xs" />
    {/if}
  </span>
</button>

<Popover.Root bind:open={isOpen}>
  <Popover.Portal>
    <Popover.Content {customAnchor} sideOffset={8} align="start" class="preset-color-popover">
      <div class="preset-color-popover-label">{popoverLabel}</div>
      <div class="preset-color-grid">
        {#each options as option (option.value)}
          <button
            type="button"
            class="preset-color-option"
            class:selected={option.value === value}
            class:is-empty={option.isEmpty}
            use:applyCircleStyle={option}
            title={option.label}
            aria-label={`Select ${option.label}`}
            onclick={() => handleSelect(option.value)}
          >
            <svg class="preset-color-swatch" viewBox="0 0 22 22" aria-hidden="true">
              {#if option.isEmpty}
                <circle
                  cx="11"
                  cy="11"
                  r="10"
                  fill="var(--background-secondary)"
                  stroke="var(--background-modifier-border)"
                />
                <line
                  x1="6"
                  y1="16"
                  x2="16"
                  y2="6"
                  stroke="var(--text-muted)"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              {:else}
                <circle
                  cx="11"
                  cy="11"
                  r="10"
                  fill={getCircleBackgroundColor(option)}
                  stroke={getCircleStrokeColor(option)}
                />
              {/if}
            </svg>
            {#if option.value === value}
              <Icon name="check" size="xs" />
            {:else if option.isEmpty}
              <Icon name="slash" size="xs" />
            {/if}
          </button>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.s2b-color-circle-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px !important;
    height: 22px !important;
    min-width: 22px !important;
    min-height: 22px !important;
    max-width: 22px !important;
    max-height: 22px !important;
    padding: 0;
    margin: 0;
    border: 0 !important;
    border-radius: 999px;
    background: transparent !important;
    background-color: transparent !important;
    box-shadow: none !important;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    flex-shrink: 0;
    flex-grow: 0;
    flex-basis: 22px;
    line-height: 0;
    font-size: 0;
    overflow: hidden;
  }

  :global(.s2b-color-circle-trigger.is-empty) {
    background: linear-gradient(
      135deg,
      var(--background-secondary) 45%,
      var(--background-modifier-border) 45%,
      var(--background-modifier-border) 55%,
      var(--background-secondary) 55%
    ) !important;
    background-color: transparent !important;
    box-shadow: inset 0 0 0 1px var(--background-modifier-border) !important;
  }

  :global(.preset-color-trigger:hover),
  :global(.preset-color-trigger:focus-visible) {
    outline: none;
    filter: brightness(1.05);
  }

  .s2b-color-circle-icon,
  .preset-color-option {
    width: 22px;
    height: 22px;
    min-width: 22px;
    min-height: 22px;
    border-radius: 999px;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 22px;
    position: relative;
  }

  .preset-color-swatch {
    position: absolute;
    inset: 0;
    width: 22px;
    height: 22px;
    pointer-events: none;
  }

  .s2b-color-circle-icon {
    color: var(--text-muted);
  }

  .s2b-color-circle-icon.is-empty,
  .preset-color-option.is-empty {
    color: var(--text-muted);
  }

  :global(.preset-color-popover) {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    box-shadow: var(--shadow-s);
    padding: 12px;
    z-index: 401;
  }

  :global(body > div:has(> .preset-color-popover)) {
    z-index: 401 !important;
  }

  .preset-color-popover-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 10px;
  }

  .preset-color-grid {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .preset-color-option {
    padding: 0;
    border: 0;
    cursor: pointer;
    transition: transform 0.15s ease;
  }

  .preset-color-option:hover {
    transform: scale(1.08);
  }

  .preset-color-option.selected {
    box-shadow:
      0 0 0 2px var(--background-primary),
      0 0 0 4px var(--text-normal);
  }
</style>
