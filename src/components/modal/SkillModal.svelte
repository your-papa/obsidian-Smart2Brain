<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { getBundledSkill, parseFrontmatter } from "../../skills";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import type SecondBrainPlugin from "../../main";
import { slugifySkillName, validateSkillName, validateDescription } from "../../skills";
import type { Skill } from "../../types/plugin";
import Button from "../ui/Button.svelte";
import Text from "../ui/Text.svelte";
import type { SkillModal } from "./SkillModal";

interface Props {
	modal: SkillModal;
	plugin: SecondBrainPlugin;
	pluginId: string;
	onSave: () => void;
}

const { modal, plugin, pluginId, onSave }: Props = $props();

// File-based skill data (loaded from SkillsService)
let fileBasedSkill = $state<Skill | null>(null);
let originalSkillName = $state("");

// Editable fields
let editName = $state("");
let editDescription = $state("");
let validationError = $state("");

// Generate slug from display name
const editSlug = $derived(slugifySkillName(editName));

// Validate per Agent Skills spec
const validation = $derived(() => {
	if (!editName.trim()) return { valid: false, error: "Name is required" };

	const nameResult = validateSkillName(editSlug);
	if (!nameResult.valid) {
		return { valid: false, error: nameResult.errors[0]?.message || "Invalid name" };
	}

	const descResult = validateDescription(editDescription);
	if (!descResult.valid) {
		return { valid: false, error: descResult.errors[0]?.message || "Description is required" };
	}

	return { valid: true, error: "" };
});

const isValid = $derived(validation().valid);

// Display name from file-based skill or fallback to pluginId
const displayName = $derived(
	fileBasedSkill?.frontmatter.metadata?.displayName ?? fileBasedSkill?.frontmatter.name ?? pluginId,
);

// Check if this skill has a bundled default
const hasBundledDefault = $derived(!!getBundledSkill(pluginId));

let editorContainer: HTMLDivElement | undefined = $state();
let editor: EmbeddableMarkdownEditor | undefined = $state();
let promptValue = $state("");
let initialName = $state("");
let initialDescription = $state("");
let initialPrompt = $state("");
let bundledDefaultName = $state("");
let bundledDefaultDescription = $state("");
let bundledDefaultPrompt = $state("");
let hasParsedBundledDefault = $state(false);

const isDirty = $derived(
  editName !== initialName ||
    editDescription !== initialDescription ||
    promptValue !== initialPrompt,
);

const isAtBundledDefault = $derived(
  hasParsedBundledDefault &&
    editName === bundledDefaultName &&
    editDescription === bundledDefaultDescription &&
    promptValue === bundledDefaultPrompt,
);

const showResetToDefault = $derived(
  hasBundledDefault && hasParsedBundledDefault && !isAtBundledDefault,
);

onMount(async () => {
	// Load file-based skill
	const skillsService = plugin.skillsService;
	if (skillsService?.isDiscovered()) {
		const skillMetadata = skillsService.getCachedSkills().get(pluginId);
		if (skillMetadata) {
			fileBasedSkill = await skillsService.loadSkill(pluginId);
			originalSkillName = pluginId;

			// Initialize editable fields from loaded skill
			editName =
				fileBasedSkill?.frontmatter.metadata?.displayName ?? fileBasedSkill?.frontmatter.name ?? pluginId;
			editDescription = fileBasedSkill?.frontmatter.description ?? "";
      initialName = editName;
      initialDescription = editDescription;
      initialPrompt = fileBasedSkill?.content ?? "";

      const bundled = getBundledSkill(pluginId);
      if (bundled) {
        const parsed = parseFrontmatter(bundled.content);
        if (parsed.frontmatter.name && parsed.frontmatter.description) {
          bundledDefaultName = parsed.frontmatter.metadata?.displayName ?? parsed.frontmatter.name;
          bundledDefaultDescription = parsed.frontmatter.description;
          bundledDefaultPrompt = parsed.body;
          hasParsedBundledDefault = true;
        }
      }
		}
	}

	if (editorContainer) {
		initializeEditor();
	}
	// Set modal title
	modal.setTitle(`Edit: ${displayName}`);
});

onDestroy(() => {
	editor?.destroy();
});

function initializeEditor() {
	if (!editorContainer || !fileBasedSkill) return;

	promptValue = fileBasedSkill.content;

	editor = new EmbeddableMarkdownEditor(plugin.app, editorContainer, {
		value: promptValue,
		placeholder: `Enter instructions for ${displayName}...`,
		cls: "skill-editor",
		onChange: (value) => {
			promptValue = value;
		},
	});
}

async function handleSave() {
	if (!isValid) {
		validationError = validation().error;
		return;
	}

	if (!fileBasedSkill) {
		validationError = "No skill loaded";
		return;
	}

	const newSlug = editSlug;
	const nameChanged = newSlug !== originalSkillName;

	// If name changed, delete the old skill first
	if (nameChanged) {
		await plugin.skillsService.deleteSkill(originalSkillName);
	}

	// Save with updated frontmatter
	const result = await plugin.skillsService.saveSkill({
		frontmatter: {
			...fileBasedSkill.frontmatter,
			name: newSlug,
			description: editDescription.trim(),
			metadata: {
				...fileBasedSkill.frontmatter.metadata,
				displayName: editName.trim(),
			},
		},
		content: promptValue,
	});

	if (!result.valid) {
		validationError = result.errors[0]?.message || "Failed to save skill";
		return;
	}

	// Re-discover to update cache
	await plugin.skillsService.discoverSkills();

	onSave();
	modal.close();
}

async function handleResetToDefault() {
  if (!hasBundledDefault || !hasParsedBundledDefault) return;
  editName = bundledDefaultName;
  editDescription = bundledDefaultDescription;
  promptValue = bundledDefaultPrompt;
  editor?.setValue(bundledDefaultPrompt);
}
</script>

<div class="skill-modal-content">
  <div class="skill-field">
    <label class="skill-label" for="skill-modal-name">Skill Name</label>
    <Text
      id="skill-modal-name"
      inputType="text"
      value={editName}
      placeholder="e.g., Code Review, Writing Style"
      onchange={(val) => (editName = val)}
    />
    {#if editSlug && editSlug !== editName.toLowerCase()}
      <p class="skill-hint">Will be saved as: {editSlug}</p>
    {/if}
  </div>

  <div class="skill-field">
    <label class="skill-label" for="skill-modal-description">Description</label>
    <Text
      id="skill-modal-description"
      inputType="text"
      value={editDescription}
      placeholder="Describe when to use this skill..."
      onchange={(val) => (editDescription = val)}
    />
    <p class="skill-field-description">
      A short description of what this skill does. The agent uses this to decide when to load the
      full instructions.
    </p>
  </div>

  <div class="skill-field flex-1">
    <div class="skill-label">Instructions</div>
    <div bind:this={editorContainer} class="skill-editor-container"></div>
  </div>

  {#if validationError}
    <div class="skill-error">{validationError}</div>
  {/if}

  <div class="skill-actions">
    <Button buttonText="Cancel" onClick={() => modal.close()} />
    <div class="flex-1"></div>
    {#if showResetToDefault}
      <Button buttonText="Reset to Default" onClick={handleResetToDefault} />
    {/if}
    {#if isDirty}
      <Button
        buttonText="Save"
        cta={true}
        onClick={handleSave}
        disabled={!isValid}
      />
    {/if}
  </div>
</div>

<style>
  .skill-modal-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .skill-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .skill-field.flex-1 {
    flex: 1;
    min-height: 0;
  }

  .skill-label {
    font-weight: 500;
    color: var(--text-normal);
  }

  .skill-field-description {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .skill-hint {
    margin: 4px 0 0 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }

  .skill-error {
    color: var(--text-error);
    font-size: var(--font-ui-small);
    padding: 8px;
    background: var(--background-modifier-error);
    border-radius: 4px;
  }

  .skill-editor-container {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    border-radius: 12px;
  }

  .skill-editor-container :global(.cm-editor) {
    height: 100%;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    font-family: var(--font-text);
    font-size: 0.95rem;
  }

  .skill-editor-container :global(.cm-editor.cm-focused) {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--interactive-accent);
  }

  .skill-editor-container :global(.cm-scroller) {
    padding: 12px 14px;
  }

  .skill-editor-container :global(.cm-content) {
    min-height: 150px;
    caret-color: var(--text-normal);
  }

  .skill-editor-container :global(.cm-line) {
    line-height: 1.6;
  }

  .skill-editor-container :global(.cm-placeholder) {
    color: var(--text-muted);
  }

  .skill-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }
</style>
