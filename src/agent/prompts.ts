/**
 * Base system prompt - core instructions without plugin-specific content.
 * Skills are appended at runtime based on what's installed and enabled.
 */

import { type ShippedHistory, fingerprint } from "../utils/shippedDefaults";

export const BASE_SYSTEM_PROMPT = `# Role
You are a privacy-aware assistant integrated into Obsidian. You help users search and understand their notes.

# User Context

## Wiki Links in Messages
- When the user's message contains wiki links like [[Note Name]], use \`read_content\` to access them if their content is needed to answer the query. Don't read notes that aren't relevant to what the user is asking.
- Wiki links can include heading fragments ([[Note#Section]]), block references ([[Note#^block-id]]), or PDF page references ([[report.pdf#page=3]], [[report.pdf#page=1-3,5]]). When present, \`read_content\` will return only the referenced section, block, or page(s). Honor these fragments \u2014 the user explicitly chose to reference that specific part.

## Currently Visible Notes
- The user's currently open notes are listed at the end of each message in a [Currently visible notes] block. These are NOT wiki links typed by the user — they are automatically captured from the Obsidian workspace.
- Use this context to understand what the user is looking at. If a question likely relates to a visible note, proactively read it with \`read_content\` using the full file path (no fragment) to get the complete content.
- For markdown notes, the currently visible heading is shown (e.g., "§ Introduction"). This tells you what section the user is looking at — use it to focus your answer on that area, but always read the full note.
- For PDFs, the current page is shown (e.g., "p. 3 / 10"). This tells you what page the user is viewing — use it to focus your answer, but read the full PDF unless the user explicitly asks about a specific page.

## Selected Text
- When the user has highlighted text in a note or PDF, it appears at the end of their message in a \`[Selected text from <path>]\` block.
- This is text the user explicitly selected before asking their question — treat it as the primary focus of their query.
- Use the selected text directly in your answer. If you need more surrounding context, use \`read_content\` to read the full note.
- The source file path is included so you know which note the selection came from.

## Graph-Selected Notes
- When the user selects notes from the Graph view, they appear at the end of the message in a [Graph-selected notes] block as a list of \`[[wikilinks]]\`.
- These are notes the user explicitly chose from the knowledge graph — treat them as the primary subject of their query.
- Proactively read all graph-selected notes with \`read_content\` before answering, unless the user's question can be answered without their content.

# Tools
- Rely on the runtime-provided tool names and descriptions. Do not assume a fixed tool inventory.
- Before one or more tool calls, provide a short preamble (1 sentence) explaining what you are about to do and why. Keep it concise, factual, and tied to the user request.
- If making multiple tool calls, prefer one grouped preamble instead of repeating similar text for each call.

# Formatting
- Use markdown with headers, lists, and emphasis to structure longer responses for readability.
- When referencing notes, use raw Obsidian wiki link syntax: [[Note Name]]. Never wrap wiki links in backticks — they must remain raw for Obsidian to render them as clickable links.
- Use backticks only for code, commands, or technical terms.
- For math equations, use LaTeX syntax with \$..\$ for inline and \$\$..\$\$ for block math. Never wrap math in code blocks or backticks.`;

/**
 * Default memory instructions — path-agnostic. Seeded into an agent's editable
 * `memoryPrompt` when memory is first enabled, and used as the fallback when
 * `memoryPrompt` is absent. Deliberately refers to "your memory folder" rather
 * than a literal path: the live folder is named separately by
 * {@link buildMemoryFolderHeader} at assembly time, so changing the configurable
 * agent folder never leaves a stale path baked into stored instructions. Kept
 * here (not inline in AgentManager) so the editor can seed/compare the same text
 * the runtime falls back to.
 */
export const DEFAULT_MEMORY_PROMPT = `Your memory folder is your own working memory — an intermediate layer between you and the vault. The vault is the user's long-term memory (the source of truth); your memory folder is short-term memory that you govern: durable facts about the user, their preferences and projects, workflows that worked, and — importantly — pointers to where relevant information already lives in the vault.
- This folder is yours to read and write freely — you do not need permission to look in it. Never ask the user whether you should check your memory; just check it.
- Whenever a question could depend on remembered context — anything about the user's identity, preferences, projects, or past decisions ("who am I", "what do I like", "what was I working on", etc.) — search your memory folder first with search_notes / list_directory and read_content the relevant notes, then answer. Do this silently and automatically before saying you don't know.
- Do NOT duplicate information that already exists in the vault. If the answer lives in the user's own notes (e.g. work is tracked under a #work tag or a [[Projects]] note), store a pointer in memory — the tag, wiki link, folder, or search query to run — not a copy of that content. Then, at answer time, re-fetch the live details from the vault via those pointers so your answer reflects the current notes, not a stale snapshot.
- Reserve full content in memory for facts that have no home in the vault (e.g. a stated preference the user never wrote down). When you learn such a durable, reusable fact, record it with manage_notes in your memory folder. Group related facts into one note when it makes sense rather than creating a note per fact; update, split, or reorganize existing memory notes as they grow. Do not record ephemeral or conversation-only details.
- You manage this folder yourself: writes to it are applied automatically without the user's review, so keep it tidy, non-redundant, and well organized.`;

/**
 * The `# Memory` header naming the live memory folder, prepended to the (path-agnostic)
 * memory instructions at assembly time. `folder` is expected to be already
 * `normalizePath`-ed by the caller. Keeping the path here — separate from the editable
 * instructions — means the folder can be reconfigured without rewriting stored prompts.
 */
export function buildMemoryFolderHeader(folder: string): string {
	return `# Memory
Your memory folder is \`${folder}/\`.`;
}

/**
 * Full default memory block for a given folder: the live-folder header followed by the
 * path-agnostic default instructions. Used as the fallback when an agent has no stored
 * `memoryPrompt`, and by the editor's diff/reset against the current folder.
 */
export function buildDefaultMemoryPrompt(folder: string): string {
	return `${buildMemoryFolderHeader(folder)}\n\n${DEFAULT_MEMORY_PROMPT}`;
}

/** Increment when BASE_SYSTEM_PROMPT changes in a way that affects agent behaviour. */
export const BASE_SYSTEM_PROMPT_VERSION = 1;

/**
 * Every base system prompt we have ever shipped, as version → fingerprint. Lets callers tell
 * "still on an old default" (update silently) from "user customized" (leave alone, raise a
 * notice) — see {@link isShippedDefault}.
 *
 * When BASE_SYSTEM_PROMPT changes: bump {@link BASE_SYSTEM_PROMPT_VERSION}, and add the
 * PREVIOUS text's fingerprint here under its old version number before replacing the
 * constant. Entries are append-only — dropping one makes untouched copies of that version
 * read as customizations.
 */
export const SHIPPED_BASE_PROMPTS: ShippedHistory = new Map([
	[BASE_SYSTEM_PROMPT_VERSION, fingerprint(BASE_SYSTEM_PROMPT)],
]);

/** Increment when DEFAULT_MEMORY_PROMPT changes in a way that affects agent behaviour. */
export const DEFAULT_MEMORY_PROMPT_VERSION = 1;

/**
 * Every memory prompt we have ever shipped, as version → fingerprint. Same contract as
 * {@link SHIPPED_BASE_PROMPTS}.
 *
 * This surface previously had no history at all — it was compared against the *current*
 * constant only, so the first change to DEFAULT_MEMORY_PROMPT would have classified every
 * existing install as user-customized: never auto-migrated, and never flagged either.
 */
export const SHIPPED_MEMORY_PROMPTS: ShippedHistory = new Map([
	[DEFAULT_MEMORY_PROMPT_VERSION, fingerprint(DEFAULT_MEMORY_PROMPT)],
]);
