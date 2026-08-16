import type { TFile, Vault } from "obsidian";
import { getData } from "../stores/dataStore.svelte";
import { gunzipToString } from "./gzip";

function normalizePattern(pattern: string): string {
	return pattern.trim().replace(/^\/+|\/+$/g, "");
}

export function matchesPathPattern(filePath: string, pattern: string): boolean {
	const normalizedPattern = normalizePattern(pattern);
	if (!normalizedPattern) return false;

	if (normalizedPattern.startsWith("*.")) {
		return filePath.toLowerCase().endsWith(normalizedPattern.slice(1).toLowerCase());
	}

	return (
		filePath === normalizedPattern ||
		filePath.startsWith(`${normalizedPattern}/`) ||
		filePath.includes(`/${normalizedPattern}`)
	);
}

export function isInternallyExcludedPath(filePath: string, targetFolder: string): boolean {
	return matchesPathPattern(filePath, targetFolder);
}

export function shouldProcessVaultPath(filePath: string, targetFolder: string): boolean {
	return !isInternallyExcludedPath(filePath, targetFolder);
}

// ---------------------------------------------------------------------------
// File-type classification for indexing
// ---------------------------------------------------------------------------

/**
 * Extensions whose content can be read as UTF-8 text via `vault.cachedRead()`
 * or `vault.read()`. Canvas files are JSON internally and included here.
 */
export const TEXT_INDEXABLE_EXTENSIONS = new Set(["md", "txt", "csv", "json", "yaml", "yml", "canvas", "chat"]);

/**
 * Returns `true` when the file holds text content that can be read and
 * indexed for full-text / embedding search.
 */
export function isTextIndexableFile(file: TFile): boolean {
	return TEXT_INDEXABLE_EXTENSIONS.has(file.extension.toLowerCase());
}

/**
 * Returns `true` when `path` lives inside the configurable agent root folder (default
 * "Agents"). That folder holds all agent context — `Memories/`, `Skills/` (skill dirs,
 * core skills included), and `System Prompts/` (per-agent subfolders). These are plugin
 * machinery, not user notes, so they must be kept out of indexing, search, graph, and the
 * agent's vault-facing tools. `agentFolder` is pure/injectable for testing; callers that
 * don't have it use `isAgentFilePath`, which reads it from plugin data.
 */
export function isAgentPath(path: string, agentFolder: string): boolean {
	if (!agentFolder) return false;
	const folder = normalizePattern(agentFolder);
	if (!folder) return false;
	const p = path.replace(/^\/+/, "");
	return p === folder || p.startsWith(`${folder}/`);
}

/**
 * `isAgentPath` with the configured agent folder resolved from plugin data. Use this from
 * runtime call sites (indexing, search, graph, tools); use `isAgentPath` directly in tests.
 * Fails open (returns `false`) if the data store isn't initialized yet — the caller then
 * treats the file as a normal note, preserving pre-relocation behavior rather than throwing.
 */
export function isAgentFilePath(path: string): boolean {
	let agentFolder: string;
	try {
		agentFolder = getData().agentFolder;
	} catch {
		return false;
	}
	return isAgentPath(path, agentFolder);
}

/**
 * Returns `true` when the file should be included in the search index.
 * Every non-hidden vault file is indexable, except files under the agent folder.
 */
export function isIndexableFile(file: TFile): boolean {
	return !isAgentFilePath(file.path);
}

/**
 * Enumerate all vault files eligible for indexing (replaces
 * `vault.getMarkdownFiles()` in search / vectorstore callers).
 */
export function getIndexableVaultFiles(vault: Vault): TFile[] {
	return vault.getFiles().filter((file) => isIndexableFile(file));
}

/**
 * Read indexable content for a file. Returns the text content for
 * text-indexable files, or an empty string for binary files (metadata-only
 * indexing). Special-case handling:
 *   - `.chat` files: extracts only human/AI message content (not LangChain metadata)
 *   - `.excalidraw.md` files: extracts the "back of the note" and text elements,
 *     stripping the huge embedded JSON drawing data
 *
 * The caller is responsible for filtering via `isIndexableFile`
 * before calling this helper.
 */
export async function readIndexableContent(vault: Vault, file: TFile): Promise<string> {
	if (!isTextIndexableFile(file)) {
		return "";
	}

	// `.chat` files are gzip-compressed binary (written via readBinary/gzipString
	// by ObsidianChatManager), NOT UTF-8 text. A text read throws on iOS ("file
	// isn't in the correct format") and yields garbage on desktop, so read + gunzip
	// the bytes and hand the decompressed JSON to the extractor.
	if (file.extension === "chat") {
		try {
			const bytes = await vault.adapter.readBinary(file.path);
			const raw = await gunzipToString(bytes);
			return extractChatContent(raw);
		} catch {
			// Unreadable/corrupt thread file — skip rather than fail the whole index.
			return "";
		}
	}

	const raw = await readTextFile(vault, file);

	if (file.path.toLowerCase().endsWith(".excalidraw.md")) {
		return extractExcalidrawContent(raw);
	}

	return raw;
}

/**
 * Read a text file's raw content, resilient to Obsidian mobile's `cachedRead`.
 *
 * On iOS, `vault.cachedRead()` / `vault.read()` route through a reader that can
 * reject some non-markdown extensions. The low-level `vault.adapter.read()` is a
 * plain UTF-8 read with no such gate. Try `cachedRead` first (cache-backed, fast
 * on desktop) and fall back to the adapter on failure.
 */
async function readTextFile(vault: Vault, file: TFile): Promise<string> {
	try {
		return await vault.cachedRead(file);
	} catch {
		return await vault.adapter.read(file.path);
	}
}

// ---------------------------------------------------------------------------
// .chat file content extraction
// ---------------------------------------------------------------------------

/**
 * Extract human and AI message text from a `.chat` file (LangGraph ThreadData JSON).
 * Skips all LangChain serialisation noise, checkpoint metadata, writes, etc.
 *
 * Conversation history is a *tree* of checkpoints, and every checkpoint re-contains
 * the whole message list that preceded it. Concatenating each checkpoint's messages
 * therefore re-emits the same text once per subsequent turn — measured at ~8x on a
 * 526-checkpoint thread, which inflates both the embedding cost and the lexical term
 * frequencies of every chat file. Emit each distinct message exactly once instead,
 * keyed on the stable LangChain message id (falling back to the message text when a
 * message carries no id). First-seen order is preserved so the extracted text still
 * reads as a transcript.
 */
function extractChatContent(raw: string): string {
	try {
		const data = JSON.parse(raw);
		const parts: string[] = [];

		// Include the chat title if present
		if (typeof data.title === "string" && data.title.trim()) {
			parts.push(data.title.trim());
		}

		// Walk checkpoints → channel_values.messages → kwargs.content / data.content
		const checkpoints = data.checkpoints;
		if (checkpoints && typeof checkpoints === "object") {
			const seen = new Set<string>();
			for (const entry of Object.values(checkpoints)) {
				const messages = getNestedMessages(entry);
				for (const msg of messages) {
					const content = extractMessageContent(msg);
					if (!content) continue;

					// Prefer the message id: the same logical message can be
					// re-serialised across checkpoints, and two genuinely distinct
					// messages may share identical text (e.g. a repeated "yes").
					const dedupeKey = getMessageId(msg) ?? `content:${content}`;
					if (seen.has(dedupeKey)) continue;
					seen.add(dedupeKey);
					parts.push(content);
				}
			}
		}

		return parts.join("\n\n");
	} catch {
		// If parsing fails, fall back to empty (don't index raw JSON)
		return "";
	}
}

/**
 * Read the stable LangChain message id, which survives re-serialisation across
 * checkpoints. Returns `null` when the message carries no usable id so the caller
 * can fall back to content-based deduplication.
 */
function getMessageId(msg: unknown): string | null {
	if (!msg || typeof msg !== "object") return null;
	const record = msg as Record<string, unknown>;

	const candidates: unknown[] = [];
	if (record.kwargs && typeof record.kwargs === "object") {
		candidates.push((record.kwargs as Record<string, unknown>).id);
	}
	if (record.data && typeof record.data === "object") {
		candidates.push((record.data as Record<string, unknown>).id);
	}
	candidates.push(record.id);

	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) {
			return `id:${candidate.trim()}`;
		}
	}
	return null;
}

function getNestedMessages(entry: unknown): unknown[] {
	if (!entry || typeof entry !== "object") return [];
	const checkpoint = (entry as Record<string, unknown>).checkpoint;
	if (!checkpoint || typeof checkpoint !== "object") return [];
	const channelValues = (checkpoint as Record<string, unknown>).channel_values;
	if (!channelValues || typeof channelValues !== "object") return [];
	const messages = (channelValues as Record<string, unknown>).messages;
	return Array.isArray(messages) ? messages : [];
}

function extractMessageContent(msg: unknown): string {
	if (!msg || typeof msg !== "object") return "";
	const record = msg as Record<string, unknown>;

	// LangChain serialised messages store content in kwargs.content or data.content
	let content: unknown;
	if (record.kwargs && typeof record.kwargs === "object") {
		content = (record.kwargs as Record<string, unknown>).content;
	}
	if (content === undefined && record.data && typeof record.data === "object") {
		content = (record.data as Record<string, unknown>).content;
	}
	// Flat message format
	if (content === undefined) {
		content = record.content;
	}

	if (typeof content === "string" && content.trim()) {
		return content.trim();
	}
	return "";
}

// ---------------------------------------------------------------------------
// .excalidraw.md content extraction
// ---------------------------------------------------------------------------

/**
 * Regex matching the start of the Excalidraw data section.
 * Everything from this point onward is drawing data (JSON, compressed
 * blobs, element links, embedded file refs) and should NOT be indexed.
 */
const RE_EXCALIDRAW_DATA_START = /^#+ (?:Excalidraw Data|Text Elements|Drawing)\s*$/m;

/**
 * Extract the user-authored "back of the note" from an `.excalidraw.md` file.
 * Strips the frontmatter-tagged Excalidraw sections and the huge JSON drawing.
 */
function extractExcalidrawContent(raw: string): string {
	const match = RE_EXCALIDRAW_DATA_START.exec(raw);
	if (!match) {
		// No Excalidraw markers found — treat the whole file as content
		return raw;
	}

	// Everything before the first Excalidraw section header
	let content = raw.substring(0, match.index);

	// Strip Obsidian comment markers that Excalidraw uses as section fences
	content = content.replace(/%%\s*$/g, "").trim();

	return content;
}
