<script lang="ts">
  import type { ChatAttachment } from "../../types/shared";
  import { toBase64DataUri } from "../../utils/attachments";
  import { getPlugin } from "../../stores/state.svelte";

  interface Props {
    attachments: ChatAttachment[];
  }

  const { attachments }: Props = $props();

  let previewUrls = $state<Map<string, string>>(new Map());

  $effect(() => {
    const imgs = attachments.filter((a) => a.mimeType.startsWith("image/"));
    if (imgs.length === 0) return;

    const app = getPlugin()?.app;
    if (!app) return;

    const newUrls = new Map<string, string>();
    const pending: Promise<void>[] = [];

    for (const att of imgs) {
      pending.push(
        (async () => {
          try {
            const file = app.vault.getFileByPath(att.vaultPath);
            if (!file) return;
            const buf = await app.vault.readBinary(file);
            newUrls.set(att.vaultPath, toBase64DataUri(buf, att.mimeType));
          } catch {
            // File may have been deleted
          }
        })(),
      );
    }

    Promise.all(pending).then(() => {
      previewUrls = newUrls;
    });
  });
</script>

<div class="flex flex-wrap gap-2 justify-end">
  {#each attachments as att (att.vaultPath)}
    {@const url = previewUrls.get(att.vaultPath)}
    {#if url}
      <img src={url} alt={att.name} class="max-h-48 max-w-64 rounded-lg object-cover shadow-sm" />
    {:else}
      <div
        class="flex items-center gap-1 rounded-lg bg-[--background-modifier-hover] px-3 py-2 text-xs text-[--text-muted]"
      >
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
  {/each}
</div>
