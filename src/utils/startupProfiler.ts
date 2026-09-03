import { Logger, LogLvl, getLogLevel } from "./logging";

/**
 * Lightweight startup profiler.
 *
 * Records ordered timing marks and measured spans during plugin startup so the
 * cold-start budget can be attributed to concrete phases. On `flush()` it emits a
 * single aligned summary via `Logger.info`, distinguishing phases that run on the
 * workspace-blocking path (inside `onload`) from those that run deferred/background
 * (after `onLayoutReady`).
 *
 * Design mirrors the `Logger` singleton in `./logging`: a module-level instance,
 * quiet unless the log level includes INFO. This is instrumentation only — it must
 * never change startup behavior. Uses `performance.now()` (monotonic, ms).
 */

type Timing =
	| { kind: "mark"; name: string; at: number; blocking: boolean }
	| { kind: "span"; name: string; at: number; duration: number; blocking: boolean };

/** A single recorded phase in a startup run (offset/duration relative to the first mark). */
interface StartupPhase {
	kind: "mark" | "span";
	name: string;
	/** ms since the first recorded mark */
	offset: number;
	/** self-duration in ms (spans only; 0 for marks) */
	duration: number;
	blocking: boolean;
}

/** A structured summary of one startup run, suitable for persistence. */
export interface StartupRecord {
	label: string;
	totalMs: number;
	phases: StartupPhase[];
	/** Free-form diagnostic context contributed during the run (sizes, counts, env). */
	meta: Record<string, unknown>;
}

/** Whether we are still inside the blocking `onload` path. */
let inBlockingPhase = true;
let startedAt: number | null = null;
const timings: Timing[] = [];
let meta: Record<string, unknown> = {};

function now(): number {
	return performance.now();
}

export const StartupProfiler = {
	/**
	 * Record a single point in time. Pass `blocking` explicitly to tag whether this
	 * point is on the workspace-blocking path; defaults to the current phase flag.
	 * Explicit tagging is preferred for the `onload` awaits, since Obsidian may invoke
	 * `onLayoutReady` synchronously mid-`onload`, flipping the flag earlier than expected.
	 */
	mark(name: string, blocking: boolean = inBlockingPhase): void {
		const at = now();
		if (startedAt === null) startedAt = at;
		timings.push({ kind: "mark", name, at, blocking });
	},

	/** Wrap an async block, recording its wall-clock duration. Returns the block's result. */
	async measure<T>(name: string, fn: () => Promise<T>, blocking: boolean = inBlockingPhase): Promise<T> {
		const start = now();
		if (startedAt === null) startedAt = start;
		try {
			return await fn();
		} finally {
			timings.push({ kind: "span", name, at: start, duration: now() - start, blocking });
		}
	},

	/** Wrap a synchronous block, recording its duration. Returns the block's result. */
	measureSync<T>(name: string, fn: () => T, blocking: boolean = inBlockingPhase): T {
		const start = now();
		if (startedAt === null) startedAt = start;
		try {
			return fn();
		} finally {
			timings.push({ kind: "span", name, at: start, duration: now() - start, blocking });
		}
	},

	/**
	 * Mark the transition off the workspace-blocking path. Everything recorded after
	 * this is tagged `deferred`. Call once from the `onLayoutReady` callback.
	 */
	leaveBlockingPhase(): void {
		inBlockingPhase = false;
	},

	/**
	 * Attach a diagnostic key/value to the current run's record (e.g. index doc count,
	 * skill count, environment context). Merged into `record.meta` at flush time.
	 * Silently ignored if called with no run in progress once flushed.
	 */
	setMeta(key: string, value: unknown): void {
		meta[key] = value;
	},

	/**
	 * Emit a single ordered summary of everything recorded so far, then reset.
	 * Returns a structured record of the run (or null if nothing was recorded) so the
	 * caller can persist it. The console summary is only logged when the log level
	 * includes INFO, but the record is always returned regardless of log level.
	 */
	flush(label: string): StartupRecord | null {
		if (timings.length === 0 || startedAt === null) {
			this.reset();
			return null;
		}

		const origin = startedAt;
		const total = now() - origin;
		const runMeta = meta;

		const phases: StartupPhase[] = timings.map((t) => ({
			kind: t.kind,
			name: t.name,
			offset: Math.round(t.at - origin),
			duration: t.kind === "span" ? Math.round(t.duration) : 0,
			blocking: t.blocking,
		}));

		if (getLogLevel() <= LogLvl.INFO) {
			const nameWidth = Math.max(...timings.map((t) => t.name.length), 4);
			const lines = timings.map((t) => {
				const tag = t.blocking ? "blocking" : "deferred";
				const offset = `+${(t.at - origin).toFixed(0)}ms`.padStart(9);
				const name = t.name.padEnd(nameWidth);
				if (t.kind === "span") {
					return `  ${offset}  ${name}  ${`${t.duration.toFixed(0)}ms`.padStart(7)}  [${tag}]`;
				}
				return `  ${offset}  ${name}  ${"·".padStart(7)}  [${tag}]`;
			});
			Logger.info(
				`${label} — total ${total.toFixed(0)}ms (offset from first mark; spans show self-duration)\n${lines.join("\n")}`,
			);
		}

		this.reset();
		return { label, totalMs: Math.round(total), phases, meta: runMeta };
	},

	/** Clear all recorded state. Exposed for tests and re-runs. */
	reset(): void {
		timings.length = 0;
		startedAt = null;
		inBlockingPhase = true;
		meta = {};
	},

	/**
	 * Time a standalone async phase and log its duration on its own line immediately.
	 * Use for deferred work that may finish after `flush()` (e.g. a cold index rebuild
	 * scheduled in its own `onLayoutReady`), so it can't rely on the shared buffer.
	 */
	async logDuration<T>(name: string, fn: () => Promise<T>): Promise<T> {
		const start = now();
		try {
			return await fn();
		} finally {
			if (getLogLevel() <= LogLvl.INFO) {
				Logger.info(`startup phase ${name}: ${(now() - start).toFixed(0)}ms [deferred]`);
			}
		}
	},
};
