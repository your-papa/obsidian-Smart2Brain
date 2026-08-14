<script lang="ts">
import { getAllTags, type App } from "obsidian";
import type { ViewFilter } from "../../types/graph";
import {
	buildSpaceMembershipRulesEditorFilter,
	cloneSpaceMembershipDraft,
	cloneViewFilter,
	compileSpaceMembershipDraft,
	createEmptySpaceFilter,
	extractSpaceMembershipRulesFilter,
	parseSpaceMembershipFilter,
	resolveViewFilter,
	resolveSpaceMembershipDraft,
	rewriteViewFilterForRename,
} from "../../lib/views";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { isAgentFilePath } from "../../utils/fileFiltering";
import type { PrivacyMode } from "../../types/plugin";
import Button from "../ui/Button.svelte";
import type { PrivacyListModal } from "./PrivacyListModal";
import FileSetEditor from "./FileSetEditor.svelte";

interface Props {
	modal: PrivacyListModal;
}

const plugin = getPlugin();
const data = getData();
const app: App = plugin.app;
const sourcePath = $derived(app.workspace.getActiveFile()?.path ?? "");

let { modal }: Props = $props();

const availableFolders = $derived.by(() => {
	const folders = new Set<string>();
	for (const file of app.vault.getFiles()) {
		if (isAgentFilePath(file.path)) continue;
		const parts = file.path.split("/");
		if (parts.length > 1) {
			folders.add(parts[0]);
			if (parts.length > 2) folders.add(`${parts[0]}/${parts[1]}`);
		}
	}
	return [...folders].sort();
});

const availableTags = $derived.by(() => {
	const tags = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (isAgentFilePath(file.path)) continue;
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const tag of getAllTags(cache) ?? []) {
			tags.add(tag);
		}
	}
	return [...tags].sort();
});

const availableProperties = $derived.by(() => {
	const keys = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (isAgentFilePath(file.path)) continue;
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) continue;
		for (const key of Object.keys(frontmatter)) {
			// `position` is Obsidian's internal frontmatter range marker, not a user property.
			if (key === "position") continue;
			keys.add(key);
		}
	}
	return [...keys].sort();
});

function ensureGroup(filter: ViewFilter): ViewFilter {
	if (filter.type === "all" || filter.type === "any" || filter.type === "none") {
		return filter;
	}
	return { type: "all", conditions: [filter] };
}

const initialParsed = parseSpaceMembershipFilter(data.privacyFilter);
let privacyFilter = $state<ViewFilter>(ensureGroup(data.privacyFilter ?? createEmptySpaceFilter()));
let showFilters = $state(initialParsed.draft.autoIncludeRules.length > 0);

// Working copy — edits only touch this local state. `data.setPrivacyFilter` /
// `data.setPrivacyMode` are called once, from `saveChanges`, so a half-typed
// condition (e.g. a folder field mid-edit) is never briefly live for tool calls,
// and closing the modal without saving discards the in-progress edit entirely.
let privacyMode = $state<PrivacyMode>(data.privacyMode);

// `dataStore` already follows vault renames for the *persisted* filter (see its
// constructor), but that rewrite lands underneath this modal's local draft. Without
// this, a rename while the modal is open would be invisible here, and clicking Save
// would overwrite the store's just-rewritten filter with this stale draft — silently
// re-introducing the exact staleness the store-level fix closes. Mirror the same
// rewrite onto the draft so Save can't regress it.
$effect(() => {
	const ref = app.vault.on("rename", (file, oldPath) => {
		privacyFilter = rewriteViewFilterForRename(privacyFilter, oldPath, file.path);
	});
	return () => app.vault.offref(ref);
});
const parsedMembership = $derived.by(() => parseSpaceMembershipFilter(privacyFilter));
const privacyUniverse = $derived.by(
	() =>
		new Set(
			app.vault
				.getFiles()
				.filter((file) => !isAgentFilePath(file.path))
				.map((file) => file.path),
		),
);
const resolvedPrivacy = $derived.by(() =>
	parsedMembership.isAdvanced
		? {
				...resolveViewFilter(app, privacyFilter, privacyUniverse),
				provenance: new Map<string, string[]>(),
				excludedPaths: new Set<string>(),
			}
		: resolveSpaceMembershipDraft(app, parsedMembership.draft, privacyUniverse),
);
const includedFiles = $derived.by(() => [...resolvedPrivacy.paths].sort((left, right) => left.localeCompare(right)));
const excludedFiles = $derived.by(() =>
	parsedMembership.isAdvanced
		? []
		: [...parsedMembership.draft.excludedPaths].sort((left, right) => left.localeCompare(right)),
);
const totalVaultFiles = $derived.by(() => app.vault.getFiles().filter((file) => !isAgentFilePath(file.path)).length);
const accessibleFileCount = $derived.by(() =>
	privacyMode === "private-by-default" ? includedFiles.length : totalVaultFiles - includedFiles.length,
);
const privateFileCount = $derived.by(() => totalVaultFiles - accessibleFileCount);
const hasFilters = $derived.by(() => parsedMembership.isAdvanced || parsedMembership.draft.autoIncludeRules.length > 0);
const includedEntries = $derived.by(() =>
	includedFiles.map((path) => ({
		path,
		displayName: path.split("/").pop() ?? path,
		contextLabel: getParentPath(path) || null,
		searchable: path.toLowerCase(),
		isManual: parsedMembership.isAdvanced
			? false
			: (resolvedPrivacy.provenance.get(path)?.includes("Manual") ?? false),
	})),
);
const excludedEntries = $derived.by(() =>
	excludedFiles.map((path) => ({
		path,
		displayName: path.split("/").pop() ?? path,
		contextLabel: getParentPath(path) || null,
	})),
);

function updatePrivacyFilter(nextFilter: ViewFilter) {
	privacyFilter = ensureGroup(nextFilter);
}

function updatePrivacyMode(mode: PrivacyMode) {
	privacyMode = mode;
}

function saveChanges() {
	data.setPrivacyFilter(privacyFilter);
	data.setPrivacyMode(privacyMode);
	modal.close();
}

function updateDraft(mutator: (draft: ReturnType<typeof cloneSpaceMembershipDraft>) => void) {
	const currentParsedMembership = parseSpaceMembershipFilter(privacyFilter);
	const draft = cloneSpaceMembershipDraft(currentParsedMembership.draft);
	mutator(draft);
	showFilters = showFilters || draft.autoIncludeRules.length > 0;
	updatePrivacyFilter(compileSpaceMembershipDraft(draft));
}

function getParentPath(path: string): string {
	const parts = path.split("/");
	return parts.slice(0, -1).join("/");
}

function removeManualPath(path: string) {
	updateDraft((draft) => {
		draft.manualPaths = draft.manualPaths.filter((entry) => entry !== path);
		draft.excludedPaths = draft.excludedPaths.filter((entry) => entry !== path);
	});
}

function excludePath(path: string) {
	updateDraft((draft) => {
		if (!draft.excludedPaths.includes(path)) {
			draft.excludedPaths = [...draft.excludedPaths, path];
		}
	});
}

function restoreExcludedPath(path: string) {
	updateDraft((draft) => {
		draft.excludedPaths = draft.excludedPaths.filter((entry) => entry !== path);
	});
}

function handleRulesFilterChange(nextFilter: ViewFilter) {
	const simpleRules = extractSpaceMembershipRulesFilter(nextFilter);
	if (!simpleRules) {
		showFilters = true;
		updatePrivacyFilter(cloneViewFilter(nextFilter));
		return;
	}

	updateDraft((draft) => {
		const preservedManualPaths = draft.manualPaths;
		const preservedExcludedPaths = draft.excludedPaths;
		draft.manualPaths = preservedManualPaths;
		draft.excludedPaths = preservedExcludedPaths;
		draft.autoIncludeRules = simpleRules;
	});
}

async function handleAddPaths(selectedPaths: string[]) {
	if (selectedPaths.length === 0 || parsedMembership.isAdvanced) return;
	updateDraft((draft) => {
		draft.manualPaths = [...draft.manualPaths, ...selectedPaths];
		draft.excludedPaths = draft.excludedPaths.filter((path) => !selectedPaths.includes(path));
	});
}

function getIncludedFileActions(entry: { isManual?: boolean }): Array<{
	label: string;
	onClick: (path: string) => void;
}> {
	if (parsedMembership.isAdvanced) return [];

	return entry.isManual
		? [{ label: "Remove", onClick: removeManualPath }]
		: [
				{
					label: privacyMode === "private-by-default" ? "Keep private" : "Keep public",
					onClick: excludePath,
				},
			];
}

function getExcludedFileActions(): Array<{ label: string; onClick: (path: string) => void }> {
	if (parsedMembership.isAdvanced) return [];

	return [
		{
			label: privacyMode === "private-by-default" ? "Restore access" : "Restore private",
			onClick: restoreExcludedPath,
		},
	];
}

const introTitle = $derived.by(() =>
	privacyMode === "private-by-default" ? "Private by default" : "Public by default",
);
const introBody = $derived.by(() =>
	privacyMode === "private-by-default"
		? "Untrusted providers can only access the files listed below. Everything else stays private unless the provider is marked as trusted."
		: "Untrusted providers can access vault files by default, except for the files listed below as private. Trusted providers always bypass this restriction.",
);
// This protects file *content*. File and folder names/paths in the vault are not
// hidden from untrusted providers — they can appear in search results, directory
// listings, and elsewhere regardless of a file's privacy status. Renaming/moving
// files and folders is safe: rules that reference a path (folder, or a wikilink
// inside a property value) follow the rename automatically, so this list won't
// drift out of date.
const pathVisibilityNote =
	"This controls file content, not file or folder names — those can still appear to any provider. " +
	"Rules here follow renames automatically, so you can freely rename or move files without breaking this list.";
const sectionTitle = $derived.by(() =>
	privacyMode === "private-by-default" ? "Files exposed to untrusted providers" : "Private files",
);
const includedEmptyText = $derived.by(() =>
	privacyMode === "private-by-default"
		? "No files are exposed to untrusted providers yet."
		: "No private files selected yet.",
);
const pickerModalTitle = $derived.by(() =>
	privacyMode === "private-by-default" ? "Expose files" : "Add private files",
);
const pickerText = $derived.by(() =>
	privacyMode === "private-by-default"
		? {
				searchPlaceholder: "Search vault files",
				searchAriaLabel: "Search files to expose",
				defaultHeading: "Vault files",
				defaultDescription: "Select one or more vault files that untrusted providers are allowed to access.",
				emptySearchText: "No matching files found.",
				confirmVerb: "Expose",
				alreadySelectedBadgeLabel: "Already exposed",
			}
		: {
				searchPlaceholder: "Search vault files",
				searchAriaLabel: "Search files to mark private",
				defaultHeading: "Vault files",
				defaultDescription: "Select one or more vault files to mark as private.",
				emptySearchText: "No matching files found.",
				confirmVerb: "Add",
				alreadySelectedBadgeLabel: "Already private",
			},
);
const excludedTitle = $derived.by(() => (privacyMode === "private-by-default" ? "Kept private" : "Kept public"));
</script>

<div class="privacy-modal-shell">
  <div class="privacy-modal-content">
    <div class="privacy-mode-panel">
      <div class="privacy-mode-copy">
        <div class="privacy-mode-title">{introTitle}</div>
        <p>{introBody}</p>
        <p>
          Untrusted providers can currently access {accessibleFileCount} of {totalVaultFiles} vault file{totalVaultFiles ===
          1
            ? ""
            : "s"}. {privateFileCount} file{privateFileCount === 1 ? "" : "s"} remain private.
        </p>
        <p class="privacy-mode-note">{pathVisibilityNote}</p>
      </div>

      <div class="privacy-mode-toggle" role="tablist" aria-label="Privacy mode">
        <button
          type="button"
          class="privacy-mode-button"
          class:privacy-mode-button--active={privacyMode === "private-by-default"}
          aria-pressed={privacyMode === "private-by-default"}
          onclick={() => updatePrivacyMode("private-by-default")}
        >
          Private by default
        </button>
        <button
          type="button"
          class="privacy-mode-button"
          class:privacy-mode-button--active={privacyMode === "public-by-default"}
          aria-pressed={privacyMode === "public-by-default"}
          onclick={() => updatePrivacyMode("public-by-default")}
        >
          Public by default
        </button>
      </div>
    </div>

    <FileSetEditor
      {app}
      {sourcePath}
      hoverSource="smart-second-brain-privacy-editor"
      {sectionTitle}
      {includedEntries}
      {includedEmptyText}
      addButtonText="Add files"
      {pickerModalTitle}
      {pickerText}
      pickerExistingPaths={!parsedMembership.isAdvanced ? parsedMembership.draft.manualPaths : []}
      pickerIncludedPaths={includedFiles}
      onAddPaths={!parsedMembership.isAdvanced ? handleAddPaths : undefined}
      showFilterToggle={true}
      filtersButtonText="Filters"
      filterToggleAriaLabel="Toggle privacy filters"
      isFilterActive={hasFilters}
      filterCount={parsedMembership.isAdvanced ? 1 : parsedMembership.draft.autoIncludeRules.length}
      onToggleFilters={() => (showFilters = !showFilters)}
      showFilterPanel={showFilters}
      filterPanelLabel="Filters"
      filterBuilderFilter={parsedMembership.isAdvanced
  		? ensureGroup(cloneViewFilter(privacyFilter))
  		: buildSpaceMembershipRulesEditorFilter(parsedMembership.draft.autoIncludeRules)}
      {availableFolders}
      {availableTags}
      {availableProperties}
      onFilterChange={handleRulesFilterChange}
      {excludedEntries}
      {excludedTitle}
      resolveIncludedActions={getIncludedFileActions}
      resolveExcludedActions={getExcludedFileActions}
    />
  </div>

  <div class="modal-button-container">
    <Button buttonText="Save" cta onClick={saveChanges} />
  </div>
</div>

<style>
  .privacy-modal-shell {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    min-height: 0;
  }

  .privacy-modal-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .privacy-mode-panel {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 10px;
    background: var(--background-secondary);
  }

  .privacy-mode-copy {
    display: flex;
    flex: 1 1 320px;
    flex-direction: column;
    gap: 6px;
  }

  .privacy-mode-copy p {
    margin: 0;
  }

  .privacy-mode-note {
    color: var(--text-muted);
    font-size: var(--font-smaller);
  }

  .privacy-mode-title {
    font-weight: 600;
  }

  .privacy-mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    border-radius: 999px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
  }

  .privacy-mode-button {
    border: 0;
    border-radius: 999px;
    padding: 8px 12px;
    background: transparent;
    color: var(--text-normal);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .privacy-mode-button:hover {
    background: var(--background-modifier-hover);
  }

  .privacy-mode-button--active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
</style>
