/**
 * Sandboxed iframe ↔ plugin bridge.
 *
 * The iframe posts `{ type: "s2b-bridge", id, method, args }` and the
 * parent responds with `{ type: "s2b-bridge-response", id, result?, error? }`.
 *
 * Because the iframe uses `sandbox="allow-scripts"` (no `allow-same-origin`),
 * its origin is `null` and it cannot touch the parent DOM, cookies, or storage.
 * Communication is strictly via `postMessage`.
 */

import { type App, getAllTags, normalizePath } from "obsidian";
import { Logger } from "../../utils/logging";

// ─── Protocol types ──────────────────────────────────────────────────

export interface BridgeRequest {
	type: "s2b-bridge";
	id: string;
	method: string;
	args: unknown[];
}

export interface BridgeResponse {
	type: "s2b-bridge-response";
	id: string;
	result?: unknown;
	error?: string;
}

// ─── Bridge handler ──────────────────────────────────────────────────

/**
 * Creates a `message` event listener that handles bridge requests from
 * a sandboxed iframe and dispatches to vault methods.
 *
 * Returns a cleanup function to remove the listener.
 */
export function createBridgeHandler(app: App, iframe: HTMLIFrameElement): () => void {
	const handler = async (event: MessageEvent) => {
		const data = event.data as BridgeRequest | undefined;
		if (!data || data.type !== "s2b-bridge") return;

		// Only accept messages from our iframe
		if (event.source !== iframe.contentWindow) return;

		const { id, method, args } = data;
		let result: unknown;
		let error: string | undefined;

		try {
			result = await dispatchMethod(app, method, args);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			Logger.error(`[Bridge] ${method} failed:`, e);
		}

		const response: BridgeResponse = { type: "s2b-bridge-response", id, result, error };
		iframe.contentWindow?.postMessage(response, "*");
	};

	window.addEventListener("message", handler);
	return () => window.removeEventListener("message", handler);
}

// ─── Method dispatch ─────────────────────────────────────────────────

async function dispatchMethod(app: App, method: string, args: unknown[]): Promise<unknown> {
	switch (method) {
		case "searchNotes":
			return bridgeSearchNotes(app, args[0] as string, args[1] as number | undefined);
		case "readContent":
			return bridgeReadContent(app, args[0] as string);
		case "getProperties":
			return bridgeGetProperties(app, args[0] as string | undefined);
		case "getAllTags":
			return bridgeGetAllTags(app);
		case "listFiles":
			return bridgeListFiles(app, args[0] as string | undefined);
		case "createNote":
			return bridgeCreateNote(app, args[0] as string, args[1] as string);
		case "updateNote":
			return bridgeUpdateNote(app, args[0] as string, args[1] as string);
		case "deleteNote":
			return bridgeDeleteNote(app, args[0] as string);
		default:
			throw new Error(`Unknown bridge method: ${method}`);
	}
}

// ─── Bridge method implementations ──────────────────────────────────

function validatePath(path: string): string {
	const normalized = normalizePath(path);
	if (normalized.includes("..")) throw new Error("Path traversal not allowed");
	return normalized;
}

async function bridgeSearchNotes(
	app: App,
	query: string,
	limit?: number,
): Promise<Array<{ path: string; name: string }>> {
	const maxResults = Math.min(limit ?? 20, 100);
	const files = app.vault.getMarkdownFiles();
	const q = query.toLowerCase();
	const matches: Array<{ path: string; name: string }> = [];

	for (const file of files) {
		if (matches.length >= maxResults) break;
		if (file.path.toLowerCase().includes(q) || file.basename.toLowerCase().includes(q)) {
			matches.push({ path: file.path, name: file.basename });
		}
	}
	return matches;
}

async function bridgeReadContent(app: App, path: string): Promise<string> {
	const normalized = validatePath(path);
	const file = app.vault.getAbstractFileByPath(normalized);
	if (!file) throw new Error(`File not found: ${path}`);
	if (!("extension" in file)) throw new Error(`Not a file: ${path}`);
	return app.vault.read(file as import("obsidian").TFile);
}

async function bridgeGetProperties(app: App, path?: string): Promise<Record<string, unknown> | string[]> {
	if (!path) {
		// Return all known property keys
		// @ts-ignore — allProperties is internal API
		const keys = app.metadataCache.getAllPropertyInfos?.();
		if (keys) return Object.keys(keys);
		return [];
	}
	const normalized = validatePath(path);
	const file = app.vault.getAbstractFileByPath(normalized);
	if (!file) throw new Error(`File not found: ${path}`);
	const cache = app.metadataCache.getFileCache(file as import("obsidian").TFile);
	return cache?.frontmatter ?? {};
}

function bridgeGetAllTags(app: App): string[] {
	const tags = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache) {
			const fileTags = getAllTags(cache);
			if (fileTags) {
				for (const tag of fileTags) {
					tags.add(tag);
				}
			}
		}
	}
	return [...tags].sort();
}

async function bridgeListFiles(
	app: App,
	prefix?: string,
): Promise<Array<{ path: string; name: string; size: number }>> {
	const files = app.vault.getMarkdownFiles();
	const normalizedPrefix = prefix ? normalizePath(prefix) : null;
	return files
		.filter((f) => !normalizedPrefix || f.path.startsWith(normalizedPrefix))
		.map((f) => ({ path: f.path, name: f.basename, size: f.stat.size }));
}

async function bridgeCreateNote(app: App, path: string, content: string): Promise<{ path: string }> {
	const normalized = validatePath(path);
	if (!normalized.endsWith(".md")) throw new Error("Path must end in .md");
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing) throw new Error(`File already exists: ${normalized}`);
	// Ensure parent folder exists
	const dir = normalized.substring(0, normalized.lastIndexOf("/"));
	if (dir && !(await app.vault.adapter.exists(dir))) {
		await app.vault.createFolder(dir);
	}
	await app.vault.create(normalized, content);
	return { path: normalized };
}

async function bridgeUpdateNote(app: App, path: string, content: string): Promise<{ path: string }> {
	const normalized = validatePath(path);
	const file = app.vault.getAbstractFileByPath(normalized);
	if (!file) throw new Error(`File not found: ${path}`);
	await app.vault.modify(file as import("obsidian").TFile, content);
	return { path: normalized };
}

async function bridgeDeleteNote(app: App, path: string): Promise<{ deleted: boolean }> {
	const normalized = validatePath(path);
	const file = app.vault.getAbstractFileByPath(normalized);
	if (!file) throw new Error(`File not found: ${path}`);
	await app.vault.trash(file, true);
	return { deleted: true };
}
