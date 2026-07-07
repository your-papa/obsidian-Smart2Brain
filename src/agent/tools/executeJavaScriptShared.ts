export interface JavaScriptExecutionPayload {
	code: string;
	input?: unknown;
}

export interface JavaScriptExecutionResult {
	durationMs: number;
	logs: string[];
	result: unknown;
}

const MAX_SERIALIZATION_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 4_000;
const MAX_LOG_ENTRIES = 50;

type AsyncFunctionType = new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as AsyncFunctionType;

function now(): number {
	if (typeof performance !== "undefined" && typeof performance.now === "function") {
		return performance.now();
	}
	return Date.now();
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

function normalizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (value === null || value === undefined) return value;

	if (typeof value === "string") return truncateString(value);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return `${value.toString()}n`;
	if (typeof value === "symbol") return value.toString();
	if (typeof value === "function") {
		const fn = value as (...args: unknown[]) => unknown;
		return `[Function ${fn.name || "anonymous"}]`;
	}

	if (depth >= MAX_SERIALIZATION_DEPTH) {
		return "[Max depth reached]";
	}

	if (value instanceof Date) return value.toISOString();
	if (value instanceof RegExp) return value.toString();
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack ? truncateString(value.stack) : undefined,
		};
	}

	if (value instanceof Map) {
		return {
			__type: "Map",
			entries: Array.from(value.entries())
				.slice(0, MAX_ARRAY_ITEMS)
				.map(([key, mapValue]) => [
					normalizeValue(key, depth + 1, seen),
					normalizeValue(mapValue, depth + 1, seen),
				]),
			...(value.size > MAX_ARRAY_ITEMS ? { __truncatedEntries: value.size - MAX_ARRAY_ITEMS } : {}),
		};
	}

	if (value instanceof Set) {
		return {
			__type: "Set",
			values: Array.from(value.values())
				.slice(0, MAX_ARRAY_ITEMS)
				.map((item) => normalizeValue(item, depth + 1, seen)),
			...(value.size > MAX_ARRAY_ITEMS ? { __truncatedEntries: value.size - MAX_ARRAY_ITEMS } : {}),
		};
	}

	if (Array.isArray(value)) {
		const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => normalizeValue(item, depth + 1, seen));
		if (value.length > MAX_ARRAY_ITEMS) {
			items.push(`[Truncated ${value.length - MAX_ARRAY_ITEMS} additional items]`);
		}
		return items;
	}

	if (typeof value === "object") {
		const objectValue = value as Record<string, unknown>;
		if (seen.has(objectValue)) return "[Circular]";
		seen.add(objectValue);

		const normalized: Record<string, unknown> = {};
		const entries = Object.entries(objectValue);
		for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
			normalized[key] = normalizeValue(entryValue, depth + 1, seen);
		}

		if (entries.length > MAX_OBJECT_KEYS) {
			normalized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
		}

		seen.delete(objectValue);
		return normalized;
	}

	return String(value);
}

function stringifyValue(value: unknown): string {
	const normalized = normalizeValue(value);
	if (typeof normalized === "string") return normalized;
	try {
		return JSON.stringify(normalized);
	} catch {
		return String(normalized);
	}
}

function createConsoleProxy(logs: string[]): Console {
	const pushLog = (level: string, args: unknown[]) => {
		if (logs.length >= MAX_LOG_ENTRIES) return;
		const message = args.map((arg) => stringifyValue(arg)).join(" ");
		logs.push(`[${level}] ${message}`.trim());
	};

	return {
		log: (...args: unknown[]) => pushLog("log", args),
		info: (...args: unknown[]) => pushLog("info", args),
		warn: (...args: unknown[]) => pushLog("warn", args),
		error: (...args: unknown[]) => pushLog("error", args),
		debug: (...args: unknown[]) => pushLog("debug", args),
		trace: (...args: unknown[]) => pushLog("trace", args),
		table: (...args: unknown[]) => pushLog("table", args),
		dir: (...args: unknown[]) => pushLog("dir", args),
		clear: () => {
			logs.length = 0;
		},
		assert: (condition?: boolean, ...args: unknown[]) => {
			if (!condition) pushLog("assert", args);
		},
		count: (...args: unknown[]) => pushLog("count", args),
		countReset: (...args: unknown[]) => pushLog("countReset", args),
		group: (...args: unknown[]) => pushLog("group", args),
		groupCollapsed: (...args: unknown[]) => pushLog("groupCollapsed", args),
		groupEnd: () => undefined,
		time: (...args: unknown[]) => pushLog("time", args),
		timeEnd: (...args: unknown[]) => pushLog("timeEnd", args),
		timeLog: (...args: unknown[]) => pushLog("timeLog", args),
		profile: (...args: unknown[]) => pushLog("profile", args),
		profileEnd: (...args: unknown[]) => pushLog("profileEnd", args),
		timeStamp: (...args: unknown[]) => pushLog("timeStamp", args),
		dirxml: (...args: unknown[]) => pushLog("dirxml", args),
	} as Console;
}

export async function executeJavaScriptSnippet(
	payload: JavaScriptExecutionPayload,
): Promise<JavaScriptExecutionResult> {
	const logs: string[] = [];
	const executionConsole = createConsoleProxy(logs);
	const start = now();
	const fn = new AsyncFunction("input", "console", `"use strict";\n${payload.code}`);
	const result = await fn(payload.input, executionConsole);

	return {
		durationMs: Math.max(0, Math.round(now() - start)),
		logs,
		result: normalizeValue(result),
	};
}
