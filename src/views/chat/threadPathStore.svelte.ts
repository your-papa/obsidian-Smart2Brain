/** Tiny per-tab reactive holder for the thread path.
 * Created in Chat.ts (plain TS) and passed into Chat.svelte as a prop so the
 * component stays pinned to its own file rather than the global activeThreadPath. */
export class ThreadPathStore {
	current: string | null = $state(null);
}
