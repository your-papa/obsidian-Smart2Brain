<script lang="ts">
import { untrack } from "svelte";
import { Notice } from "obsidian";
import SettingContainer from "./SettingContainer.svelte";
import Button from "../ui/Button.svelte";
import { ConfirmModal } from "../modal/ConfirmModal";
import { getData } from "../../stores/dataStore.svelte";
import { getPlugin } from "../../stores/state.svelte";
import { Logger } from "../../utils/logging";
import {
	deleteOrphanedDatabases,
	estimateOriginStorage,
	formatBytes,
	listOrphanedVectorDatabases,
	type OrphanedDatabase,
} from "../../vectorstore/orphanedDatabases";

/*
 * Vector databases outlive their index configuration by design (#432, step 5):
 * removing a provider or an index config leaves its vectors on disk until an
 * explicit delete. This row lists the leftovers for this vault and deletes them
 * after confirmation. It renders nothing when there is nothing to clean up or
 * when the runtime cannot enumerate databases.
 */

const pluginData = getData();
const plugin = getPlugin();

let orphans = $state<OrphanedDatabase[]>([]);
let originUsage = $state<number | null>(null);
let deleting = $state(false);

const configuredIds = $derived(pluginData.embeddingIndexes.map((index) => index.id));
// A value signature: `embeddingIndexes` is a fresh array on every store write,
// and keying the effect on its identity would rescan on unrelated saves.
const configuredSignature = $derived(configuredIds.join("|"));

async function scan(): Promise<void> {
	try {
		const found = await listOrphanedVectorDatabases(pluginData.vaultSlug, configuredIds);
		orphans = found ?? [];
		originUsage = (await estimateOriginStorage())?.usage ?? null;
	} catch (error) {
		Logger.error("[OrphanedVectorDatabases] Scan failed:", error);
		orphans = [];
	}
}

$effect(() => {
	// Rescan whenever the configured set changes (an index was deleted or added).
	void configuredSignature;
	untrack(() => void scan());
});

const totalEstimatedBytes = $derived(orphans.reduce((sum, orphan) => sum + (orphan.estimatedBytes ?? 0), 0));

function describe(orphan: OrphanedDatabase): string {
	if (orphan.kind === "legacy-sidecar") return "legacy graph data";
	const chunks = orphan.chunkCount ?? 0;
	return `${orphan.indexId} (${chunks} ${chunks === 1 ? "chunk" : "chunks"})`;
}

const description = $derived.by(() => {
	const count = orphans.length;
	const parts = [
		`${count} stored ${count === 1 ? "database" : "databases"} no longer ${count === 1 ? "belongs" : "belong"} to a configured embedding index${
			totalEstimatedBytes > 0 ? ` (at least ${formatBytes(totalEstimatedBytes)} of vectors)` : ""
		}: ${orphans.map(describe).join(", ")}.`,
	];
	if (originUsage !== null) {
		parts.push(`Obsidian's storage on this device totals ${formatBytes(originUsage)} across all vaults.`);
	}
	return parts.join(" ");
});

async function deleteOrphans(): Promise<void> {
	const names = orphans.map((orphan) => orphan.name);
	if (names.length === 0) return;
	const modal = new ConfirmModal(
		plugin.app,
		"Delete orphaned indexes?",
		`This permanently removes ${names.length} stored ${names.length === 1 ? "database" : "databases"} that no configured embedding index uses. Re-adding one of these models later will rebuild its index from scratch.`,
		"Delete",
	);
	modal.open();
	const { confirmed } = await modal.promise;
	if (!confirmed) return;

	deleting = true;
	try {
		const outcome = await deleteOrphanedDatabases(names);
		if (outcome.failed.length === 0) {
			new Notice(
				`Deleted ${outcome.deleted.length} orphaned ${outcome.deleted.length === 1 ? "index" : "indexes"}.`,
			);
		} else {
			for (const failure of outcome.failed) {
				Logger.error(`[OrphanedVectorDatabases] Could not delete ${failure.name}: ${failure.reason}`);
			}
			new Notice(
				`Deleted ${outcome.deleted.length}, could not delete ${outcome.failed.length}: ${outcome.failed[0].reason}`,
			);
		}
	} finally {
		deleting = false;
		await scan();
	}
}
</script>

{#if orphans.length > 0}
  <SettingContainer name="Orphaned vector databases" desc={description}>
    <Button buttonText="Delete orphaned indexes" disabled={deleting} onClick={() => void deleteOrphans()} />
  </SettingContainer>
{/if}
