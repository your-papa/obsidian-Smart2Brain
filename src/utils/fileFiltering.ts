import type { TFile, Vault } from "obsidian";
import { getData } from "../stores/dataStore.svelte";
import { gunzipToString } from "./gzip";
import { extractTextFromPdf } from "./pdfExtractor";

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
 * Extensions whose text is extracted from a binary container rather than read
 * directly. These are indexable, just not via `readTextFile`.
 */
export const BINARY_TEXT_EXTENSIONS = new Set(["pdf"]);

/**
 * Extensions excluded from the index entirely.
 *
 * A file with no extractable text yields an empty body, and `chunkText` still
 * emits one chunk containing only the title — a content-free vector. Measured:
 * those score ~0.46-0.48 against *any* query, which is the noise floor, so they
 * displace real notes while carrying no information. Lexical search still finds
 * them by filename through MiniSearch.
 *
 *   - `base`: Obsidian Bases view definitions — YAML formula/config, no prose.
 *   - images: no text to extract. Indexing them would require a multimodal
 *     embedding model and a separate image pipeline; until that exists they are
 *     pure noise rather than a missing feature.
 */
export const NON_INDEXABLE_EXTENSIONS = new Set([
	"base",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"bmp",
	"avif",
	"ico",
	"mp3",
	"wav",
	"m4a",
	"ogg",
	"flac",
	"mp4",
	"webm",
	"mov",
	"mkv",
	"zip",
]);

/**
 * Returns `true` when the file holds text content that can be read and
 * indexed for full-text / embedding search.
 */
export function isTextIndexableFile(file: TFile): boolean {
	return TEXT_INDEXABLE_EXTENSIONS.has(file.extension.toLowerCase());
}

/** Returns `true` when the file's text must be extracted from a binary container. */
export function isBinaryTextFile(file: TFile): boolean {
	return BINARY_TEXT_EXTENSIONS.has(file.extension.toLowerCase());
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
	if (isAgentFilePath(file.path)) return false;
	// Files with no extractable text would be indexed as a title-only vector,
	// which sits at the similarity noise floor and displaces real notes.
	// Fall back to the path suffix: `extension` is absent on some call sites'
	// file-like objects, and treating that as "no extension" would silently
	// re-admit every excluded type.
	const extension = (file.extension ?? file.path.split(".").pop() ?? "").toLowerCase();
	return !NON_INDEXABLE_EXTENSIONS.has(extension);
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
 * text-indexable files, or an empty string when nothing can be extracted.
 * Special-case handling:
 *   - `.chat` files: extracts only human/AI message content (not LangChain metadata)
 *   - `.pdf` files: extracts the document text via pdfjs, so a PDF is chunked and
 *     embedded like any other long document rather than reduced to its filename
 *   - `.excalidraw.md` files: extracts the "back of the note" and text elements,
 *     stripping the huge embedded JSON drawing data
 *
 * The caller is responsible for filtering via `isIndexableFile`
 * before calling this helper.
 */
export async function readIndexableContent(vault: Vault, file: TFile): Promise<string> {
	// PDFs carry real prose, but it lives inside a binary container. Extracting it
	// lets the normal chunker split the document by length; returning "" would
	// index a multi-page PDF as a single title-only vector.
	if (isBinaryTextFile(file)) {
		try {
			const bytes = await vault.adapter.readBinary(file.path);
			const { text } = await extractTextFromPdf(new Uint8Array(bytes));
			return text.trim();
		} catch {
			// Encrypted, malformed, or scanned-without-OCR: skip rather than fail
			// the whole index run.
			return "";
		}
	}

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
 * Serialised LangChain classes that represent something a person actually said or
 * was told. `ToolMessage` is deliberately absent: a tool result is the *input* the
 * agent worked from, not conversation. Measured on a real vault, tool results were
 * 73.5% of all indexed chat text, and 45.8% of it was `read_content` echoing notes
 * back verbatim — so notes were indexed a second time inside every thread that had
 * read them, competing with the note itself at retrieval time.
 */
const CONVERSATIONAL_MESSAGE_CLASSES = new Set(["HumanMessage", "AIMessage", "AIMessageChunk", "SystemMessage"]);

/**
 * Name of the serialised LangChain class for a message, e.g. `"ToolMessage"`.
 * Serialised messages carry it as the last element of the `id` path array
 * (`["langchain_core", "messages", "ToolMessage"]`). Returns `null` when the shape
 * is unrecognised, so the caller can decide how to treat it.
 */
function getMessageClass(msg: unknown): string | null {
	if (!msg || typeof msg !== "object") return null;
	const record = msg as Record<string, unknown>;

	if (Array.isArray(record.id) && record.id.length > 0) {
		const last = record.id[record.id.length - 1];
		if (typeof last === "string" && last.trim()) return last.trim();
	}
	// Flat (non-`lc`) message shape stores the role on `type`.
	if (typeof record.type === "string" && record.type.trim()) return record.type.trim();
	return null;
}

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
 *
 * Only conversational turns are indexed (see `CONVERSATIONAL_MESSAGE_CLASSES`), and
 * attachment blocks are stripped from those turns, so a thread contributes the
 * discussion itself rather than a second copy of the notes it referenced.
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
					// An unrecognised shape has no class to check; indexing it risks
					// re-admitting tool output, so skip it.
					const messageClass = getMessageClass(msg);
					if (!messageClass || !CONVERSATIONAL_MESSAGE_CLASSES.has(messageClass)) continue;

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

/**
 * Fallback marker for attachment blocks in threads written before the structured
 * `s2b_attachment` flag existed. Mirrors the wrappers built in `Agent.ts`.
 */
const RE_ATTACHMENT_BLOCK = /^--- (?:File|PDF): /;

/**
 * Returns `true` when a content part is an attached file rather than typed text.
 *
 * Attachments are the *note* the user pointed at, not what they said about it, and
 * the note is already indexed on its own. `Agent.ts` tags every attachment part with
 * `s2b_attachment: true`; the text-prefix check covers threads written before that.
 */
function isAttachmentPart(part: Record<string, unknown>): boolean {
	if (part.s2b_attachment === true) return true;
	const text = part.text;
	return typeof text === "string" && RE_ATTACHMENT_BLOCK.test(text);
}

/**
 * Collapse a multimodal content array to its typed text.
 *
 * A message with attachments serialises as an array of parts: the user's own text
 * plus one block per attached file. Treating the whole array as non-string dropped
 * the user's question entirely (measured: "what can you do" lost, while the attached
 * note's full body was the only thing that would have been kept). Keep the text
 * parts, drop the attachments and any non-text (image/file) parts.
 */
function extractTextFromContentParts(parts: unknown[]): string {
	const texts: string[] = [];
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const record = part as Record<string, unknown>;
		if (record.type !== "text") continue;
		if (isAttachmentPart(record)) continue;
		const text = record.text;
		if (typeof text === "string" && text.trim()) texts.push(text.trim());
	}
	return texts.join("\n\n");
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
	if (Array.isArray(content)) {
		return extractTextFromContentParts(content);
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
