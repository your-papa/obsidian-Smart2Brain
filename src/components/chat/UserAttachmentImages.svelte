<script lang="ts">
import { onDestroy } from "svelte";
import type { ChatAttachment } from "../../types/shared";
import { getPlugin } from "../../stores/state.svelte";

interface Props {
	attachments: ChatAttachment[];
}

const { attachments }: Props = $props();

let previewUrls = $state<Map<string, string>>(new Map());

onDestroy(() => {
	for (const url of previewUrls.values()) {
		URL.revokeObjectURL(url);
	}
});

$effect(() => {
	const imgs = attachments.filter((a) => a.mimeType.startsWith("image/"));
	if (imgs.length === 0) {
		for (const url of previewUrls.values()) {
			URL.revokeObjectURL(url);
		}
		previewUrls = new Map();
		return;
	}

	const app = getPlugin()?.app;
	if (!app) return;

	let cancelled = false;
	let committed = false;
	const newUrls = new Map<string, string>();
	const pending: Promise<void>[] = [];

	for (const att of imgs) {
		pending.push(
			(async () => {
				try {
					const file = app.vault.getFileByPath(att.vaultPath);
					if (!file) return;
					const buf = await app.vault.readBinary(file);
					const blob = new Blob([buf], { type: att.mimeType });
					newUrls.set(att.vaultPath, URL.createObjectURL(blob));
				} catch {
					// File may have been deleted
				}
			})(),
		);
	}

	Promise.all(pending).then(() => {
		if (!cancelled) {
			for (const url of previewUrls.values()) {
				URL.revokeObjectURL(url);
			}
			previewUrls = newUrls;
			committed = true;
		} else {
			for (const url of newUrls.values()) {
				URL.revokeObjectURL(url);
			}
		}
	});

	return () => {
		cancelled = true;
		if (!committed) {
			for (const url of newUrls.values()) {
				URL.revokeObjectURL(url);
			}
		}
	};
});
</script>

<div class="flex flex-wrap gap-2 justify-end">
  {#each attachments as att (att.vaultPath)}
    {@const url = previewUrls.get(att.vaultPath)}
    <div class="relative h-32 w-48 rounded-lg overflow-hidden shadow-sm bg-[--background-modifier-hover]">
      {#if url}
        <img src={url} alt={att.name} class="h-full w-full object-cover" />
      {:else}
        <div class="flex h-full w-full items-center justify-center gap-1 text-xs text-[--text-muted]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>{att.name}</span>
        </div>
      {/if}
    </div>
  {/each}
</div>
