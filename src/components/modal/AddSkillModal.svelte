<script lang="ts">
import { onDestroy } from "svelte";
import { EmbeddableMarkdownEditor } from "../../lib/editor";
import type SecondBrainPlugin from "../../main";
import { slugifySkillName, validateSkillName, validateDescription, parseFrontmatter } from "../../skills";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import Button from "../ui/Button.svelte";
import Text from "../ui/Text.svelte";
import type { AddSkillModal } from "./AddSkillModal";

interface Props {
	modal: AddSkillModal;
	plugin: SecondBrainPlugin;
	agentId: string;
	onSave: (skillId: string) => void | Promise<void>;
}

const { modal, plugin, agentId, onSave }: Props = $props();

// Mode: "create" or "import"
type Mode = "create" | "import";
let mode = $state<Mode>("create");

let skillName = $state("");
let skillDescription = $state("");
let promptValue = $state("");
let validationError = $state("");

// Import mode state
let importUrl = $state("");
let importLoading = $state(false);
let importError = $state("");

let editor: EmbeddableMarkdownEditor | undefined = $state();

// Generate slug from display name
const skillSlug = $derived(slugifySkillName(skillName));

// Validate per Agent Skills spec
const validation = $derived(() => {
	if (!skillName.trim()) return { valid: false, error: "Name is required" };

	const nameResult = validateSkillName(skillSlug);
	if (!nameResult.valid) {
		return { valid: false, error: nameResult.errors[0]?.message || "Invalid name" };
	}

	const descResult = validateDescription(skillDescription);
	if (!descResult.valid) {
		return { valid: false, error: descResult.errors[0]?.message || "Description is required" };
	}

	return { valid: true, error: "" };
});

const isValid = $derived(validation().valid);

// Track if we have pending content to load into editor
let pendingEditorContent = $state<string | null>(null);

// Svelte action to manage editor lifecycle with the DOM element
function editorAction(node: HTMLDivElement) {
	// Create editor when element mounts
	const initialValue = pendingEditorContent ?? promptValue;
	editor = new EmbeddableMarkdownEditor(plugin.app, node, {
		value: initialValue,
		placeholder: "Enter instructions for this skill...",
		cls: "skill-editor",
		onChange: (value) => {
			promptValue = value;
		},
	});
	// Clear pending content after using it
	if (pendingEditorContent !== null) {
		pendingEditorContent = null;
	}

	return {
		destroy() {
			editor?.destroy();
			editor = undefined;
		},
	};
}

onDestroy(() => {
	editor?.destroy();
});

/**
 * Convert a GitHub URL to raw content URL.
 * Supports: github.com blob URLs, raw.githubusercontent.com
 */
function toRawGitHubUrl(url: string): string {
	// Already a raw URL
	if (url.includes("raw.githubusercontent.com")) {
		return url;
	}
	// Convert github.com/owner/repo/blob/branch/path to raw URL
	const blobMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
	if (blobMatch) {
		const [, owner, repo, branch, path] = blobMatch;
		return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
	}
	return url;
}

async function handleImport() {
	if (!importUrl.trim()) {
		importError = "Please enter a URL";
		return;
	}

	importLoading = true;
	importError = "";

	try {
		const rawUrl = toRawGitHubUrl(importUrl.trim());
		const obsidianFetch = createObsidianFetch(fetch);
		const response = await obsidianFetch(rawUrl);

		if (!response.ok) {
			throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
		}

		const content = await response.text();

		// Parse the SKILL.md content
		const { frontmatter, body } = parseFrontmatter(content);

		if (!frontmatter.name || !frontmatter.description) {
			throw new Error("Invalid SKILL.md: missing name or description in frontmatter");
		}

		// Populate fields
		skillName = frontmatter.metadata?.displayName ?? frontmatter.name;
		skillDescription = frontmatter.description;
		promptValue = body;

		// Switch to create mode to allow editing
		mode = "create";
		importUrl = "";

		// Set pending content - $effect will initialize editor and set content
		pendingEditorContent = body;
	} catch (err) {
		importError = err instanceof Error ? err.message : "Failed to import skill";
	} finally {
		importLoading = false;
	}
}

function openSkillsMarketplace() {
	window.open("https://skillsmp.com/", "_blank");
}

async function handleSave() {
	if (!isValid) {
		validationError = validation().error;
		return;
	}

	// Save skill using SkillsService (file-based)
	const skillsService = plugin.skillsService;
	const result = await skillsService.saveSkill({
		frontmatter: {
			name: skillSlug,
			description: skillDescription.trim(),
			metadata: {
				displayName: skillName.trim(),
			},
		},
		content: promptValue,
	});

	if (!result.valid) {
		validationError = result.errors[0]?.message || "Failed to save skill";
		return;
	}

	// Re-discover skills to update cache
	await skillsService.discoverSkills();

	// Call onSave and wait for it to complete (agent reinitialization)
	await onSave(skillSlug);
	modal.close();
}
</script>

<div class="add-skill-modal-content">
  <!-- Mode Toggle -->
  <div class="add-skill-tabs">
    <button
      class="add-skill-tab"
      class:active={mode === "create"}
      onclick={() => (mode = "create")}
    >
      Create New
    </button>
    <button
      class="add-skill-tab"
      class:active={mode === "import"}
      onclick={() => (mode = "import")}
    >
      Import from URL
    </button>
    <div class="flex-1"></div>
    <button class="add-skill-marketplace-link" onclick={openSkillsMarketplace}>
      Browse SkillsMP →
    </button>
  </div>

  {#if mode === "import"}
    <!-- Import Mode -->
    <div class="add-skill-field">
      <label class="add-skill-label">SKILL.md URL</label>
      <Text
        inputType="text"
        value={importUrl}
        placeholder="https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md"
        changeFunc={(val) => (importUrl = val)}
      />
      <p class="add-skill-description">
        Paste a GitHub URL to a SKILL.md file. Supports github.com and raw.githubusercontent.com
        URLs. Find skills at <button class="inline-link" onclick={openSkillsMarketplace}
          >skillsmp.com</button
        >
      </p>
    </div>

    {#if importError}
      <div class="add-skill-error">{importError}</div>
    {/if}

    <div class="add-skill-actions">
      <div class="flex-1"></div>
      <Button buttonText="Cancel" onClick={() => modal.close()} />
      <Button
        buttonText={importLoading ? "Importing..." : "Import"}
        cta={true}
        onClick={handleImport}
        disabled={importLoading || !importUrl.trim()}
      />
    </div>
  {:else}
    <!-- Create Mode -->
    <div class="add-skill-field">
      <label class="add-skill-label">Skill Name</label>
      <Text
        inputType="text"
        value={skillName}
        placeholder="e.g., Code Review, Writing Style"
        changeFunc={(val) => (skillName = val)}
      />
      {#if skillSlug && skillSlug !== skillName.toLowerCase()}
        <p class="add-skill-hint">Will be saved as: {skillSlug}</p>
      {/if}
    </div>

    <div class="add-skill-field">
      <label class="add-skill-label">Description</label>
      <Text
        inputType="text"
        value={skillDescription}
        placeholder="Describe when to use this skill..."
        changeFunc={(val) => (skillDescription = val)}
      />
      <p class="add-skill-description">
        A short description of what this skill does and when to use it.
      </p>
    </div>

    <div class="add-skill-field flex-1">
      <label class="add-skill-label">Instructions</label>
      <p class="add-skill-description">
        Define the behavior and capabilities for this skill. These instructions will be appended to
        the system prompt when the skill is enabled.
      </p>
      <div use:editorAction class="skill-editor-container"></div>
    </div>

    {#if validationError}
      <div class="add-skill-error">{validationError}</div>
    {/if}

    <div class="add-skill-actions">
      <div class="flex-1"></div>
      <Button buttonText="Cancel" onClick={() => modal.close()} />
      <Button buttonText="Add Skill" cta={true} onClick={handleSave} disabled={!isValid} />
    </div>
  {/if}
</div>

<style>
  .add-skill-modal-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 12px;
  }

  .add-skill-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .add-skill-field.flex-1 {
    flex: 1;
    min-height: 0;
  }

  .add-skill-label {
    font-weight: 500;
    color: var(--text-normal);
  }

  .add-skill-description {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .add-skill-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    font-style: italic;
  }

  .add-skill-error {
    color: var(--text-error);
    font-size: var(--font-ui-small);
    padding: 8px 12px;
    background: var(--background-modifier-error);
    border-radius: 6px;
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
    min-height: 100px;
    caret-color: var(--text-normal);
  }

  .skill-editor-container :global(.cm-line) {
    line-height: 1.6;
  }

  .skill-editor-container :global(.cm-placeholder) {
    color: var(--text-muted);
  }

  .add-skill-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .add-skill-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--background-modifier-border);
    margin-bottom: 4px;
  }

  .add-skill-tab {
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .add-skill-tab:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .add-skill-tab.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .add-skill-marketplace-link {
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text-accent);
    font-size: var(--font-ui-small);
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s ease;
  }

  .add-skill-marketplace-link:hover {
    text-decoration: underline;
  }

  .inline-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
  }

  .inline-link:hover {
    color: var(--text-accent-hover);
  }
</style>
