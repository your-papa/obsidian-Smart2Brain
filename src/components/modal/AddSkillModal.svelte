<script lang="ts">
import { normalizePath } from "obsidian";
import type SecondBrainPlugin from "../../main";
import {
	slugifySkillName,
	humanizeSkillName,
	validateSkillName,
	validateDescription,
	parseFrontmatter,
} from "../../skills";
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
// Body for the new SKILL.md. Empty in the create flow (we scaffold a starter), or the
// fetched body when importing. The user writes/edits the real instructions in the opened note.
let importedBody = $state("");
let validationError = $state("");

// Import mode state
let importUrl = $state("");
let importLoading = $state(false);
let importError = $state("");

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

		// Populate fields; keep the imported body so it's written into the new note verbatim.
		skillName = humanizeSkillName(frontmatter.name);
		skillDescription = frontmatter.description;
		importedBody = body;

		// Switch to create view so the user can confirm name/description before we scaffold + open.
		mode = "create";
		importUrl = "";
	} catch (err) {
		importError = err instanceof Error ? err.message : "Failed to import skill";
	} finally {
		importLoading = false;
	}
}

function openSkillsMarketplace() {
	window.open("https://skillsmp.com/", "_blank");
}

/** Starter body written into a brand-new skill (when not importing an existing one). */
function scaffoldBody(): string {
	return `# ${skillName.trim()}\n\nDescribe when to use this skill and the steps to follow.\n`;
}

async function handleSave() {
	if (!isValid) {
		validationError = validation().error;
		return;
	}

	// Write a SKILL.md (scaffold for a new skill, or the imported body) then open the note so
	// the user writes the real instructions in Obsidian — consistent with the edit (pencil) flow.
	const skillsService = plugin.skillsService;
	const result = await skillsService.saveSkill({
		frontmatter: {
			name: skillSlug,
			description: skillDescription.trim(),
		},
		content: importedBody.trim() ? importedBody : scaffoldBody(),
	});

	if (!result.valid) {
		validationError = result.errors[0]?.message || "Failed to save skill";
		return;
	}

	// Re-discover skills to update cache, then let the agent reinitialize.
	await skillsService.discoverSkills();
	await onSave(skillSlug);

	// Open the freshly created note for editing, then close the modal.
	const metadata = skillsService.getCachedSkills().get(skillSlug);
	if (metadata) {
		const skillPath = normalizePath(`${metadata.path}/SKILL.md`);
		modal.close();
		plugin.app.workspace.openLinkText(skillPath, "", true);
	} else {
		modal.close();
	}
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
      <label class="add-skill-label" for="add-skill-import-url">SKILL.md URL</label>
      <Text
        id="add-skill-import-url"
        inputType="text"
        value={importUrl}
        placeholder="https://github.com/owner/repo/blob/main/skills/my-skill/SKILL.md"
        onchange={(val) => (importUrl = val)}
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
      <label class="add-skill-label" for="add-skill-name">Skill Name</label>
      <Text
        id="add-skill-name"
        inputType="text"
        value={skillName}
        placeholder="e.g., Code Review, Writing Style"
        onchange={(val) => (skillName = val)}
      />
      {#if skillSlug && skillSlug !== skillName.toLowerCase()}
        <p class="add-skill-hint">Will be saved as: {skillSlug}</p>
      {/if}
    </div>

    <div class="add-skill-field">
      <label class="add-skill-label" for="add-skill-description">Description</label>
      <Text
        id="add-skill-description"
        inputType="text"
        value={skillDescription}
        placeholder="Describe when to use this skill..."
        onchange={(val) => (skillDescription = val)}
      />
      <p class="add-skill-description">
        A short description of what this skill does and when to use it. After you add it, the
        skill's note opens so you can write the full instructions.
      </p>
    </div>

    {#if validationError}
      <div class="add-skill-error">{validationError}</div>
    {/if}

    <div class="add-skill-actions">
      <div class="flex-1"></div>
      <Button buttonText="Cancel" onClick={() => modal.close()} />
      <Button buttonText="Add & Open Note" cta={true} onClick={handleSave} disabled={!isValid} />
    </div>
  {/if}
</div>

<style>
  .add-skill-modal-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .add-skill-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
