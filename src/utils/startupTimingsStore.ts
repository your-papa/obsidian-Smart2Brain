import { normalizePath, Platform } from "obsidian";
import type SecondBrainPlugin from "../main";
import { Logger } from "./logging";
import { StartupProfiler, type StartupRecord } from "./startupProfiler";

/**
 * Rolling on-disk history of plugin startup timings.
 *
 * Persists the structured record produced by `StartupProfiler.flush()` to a small
 * JSON file in the plugin's data dir, keeping only the most recent runs. This exists
 * so an organic cold/slow start can be inspected after the fact without having to
 * catch it live in the console.
 *
 * Storage mirrors the `pendingChangesStore` convention: `${manifest.dir}/data/<file>`
 * written via `app.vault.adapter`. Best-effort — failures are logged and swallowed so
 * instrumentation never affects startup behavior.
 */

const STORAGE_FILE = "data/startup-timings.json";
const MAX_RUNS = 20;

/** One persisted startup run: the profiler record plus a wall-clock timestamp. */
interface PersistedStartupRun extends StartupRecord {
	/** ISO 8601 wall-clock time the run was recorded. */
	timestamp: string;
}

function storagePath(plugin: SecondBrainPlugin): string {
	return normalizePath(`${plugin.manifest.dir}/${STORAGE_FILE}`);
}

/**
 * Snapshot the system/app context for the current startup run into the profiler's meta.
 * Correlates slow starts with platform, plugin load, and memory pressure. Best-effort:
 * every field is guarded because these APIs are host-version- and platform-dependent.
 */
export function recordStartupEnvironment(plugin: SecondBrainPlugin): void {
	try {
		StartupProfiler.setMeta("platform", Platform.isMacOS ? "macos" : Platform.isWin ? "windows" : "linux");

		// Count of *enabled* community plugins (heavier onload competition = slower pre-layout).
		const pluginsApi = (plugin.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
		const enabled = pluginsApi?.enabledPlugins;
		if (enabled instanceof Set) {
			StartupProfiler.setMeta("enabledCommunityPlugins", enabled.size);
		}

		// JS heap usage, when the host exposes it (Chromium `performance.memory`). Non-standard,
		// so feature-detected. A near-limit heap correlates with GC-induced startup stalls.
		const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
		if (mem && typeof mem.usedJSHeapSize === "number") {
			StartupProfiler.setMeta("usedJSHeapMB", Math.round(mem.usedJSHeapSize / 1_048_576));
			StartupProfiler.setMeta("jsHeapLimitMB", Math.round(mem.jsHeapSizeLimit / 1_048_576));
		}
	} catch (e) {
		Logger.warn("[StartupTimings] Failed to record environment context:", e);
	}
}

/**
 * Append a startup record to the rolling history file, trimming to the last MAX_RUNS.
 * Best-effort: never throws.
 */
export async function persistStartupRecord(plugin: SecondBrainPlugin, record: StartupRecord): Promise<void> {
	try {
		const adapter = plugin.app.vault.adapter;
		const path = storagePath(plugin);

		let runs: PersistedStartupRun[] = [];
		if (await adapter.exists(path)) {
			try {
				const parsed = JSON.parse(await adapter.read(path));
				if (Array.isArray(parsed)) runs = parsed as PersistedStartupRun[];
			} catch (e) {
				// Corrupt file — start fresh rather than lose the new record.
				Logger.warn("[StartupTimings] Could not parse existing timings file, overwriting:", e);
			}
		}

		runs.push({ ...record, timestamp: new Date().toISOString() });
		if (runs.length > MAX_RUNS) runs = runs.slice(runs.length - MAX_RUNS);

		const dir = path.substring(0, path.lastIndexOf("/"));
		if (dir && !(await adapter.exists(dir))) {
			await adapter.mkdir(dir);
		}
		await adapter.write(path, JSON.stringify(runs, null, 2));
	} catch (e) {
		Logger.error("[StartupTimings] Failed to persist startup record:", e);
	}
}
