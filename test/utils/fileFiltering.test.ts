import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// fileFiltering imports getData() at module load; isIndexableFile/isAgentFilePath resolve the
// agent folder through it. isAgentPath itself is pure (folder passed explicitly).
const mockGetData = vi.fn().mockReturnValue({ agentFolder: "Agents" });
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: () => mockGetData(),
}));

import { isAgentFilePath, isAgentPath, isIndexableFile, readIndexableContent } from "../../src/utils/fileFiltering";
import { gzipString, toArrayBuffer } from "../../src/utils/gzip";

describe("isAgentPath (pure)", () => {
	it("matches the folder itself and files inside it", () => {
		expect(isAgentPath("Agents", "Agents")).toBe(true);
		expect(isAgentPath("Agents/Skills/dataview/SKILL.md", "Agents")).toBe(true);
		expect(isAgentPath("Agents/Memories/notes.md", "Agents")).toBe(true);
		expect(isAgentPath("Agents/Base Prompts/default-agent.md", "Agents")).toBe(true);
	});

	it("does not match sibling folders or lookalike prefixes", () => {
		expect(isAgentPath("Notes/x.md", "Agents")).toBe(false);
		expect(isAgentPath("AgentsExtra/x.md", "Agents")).toBe(false);
		expect(isAgentPath("MyAgents/x.md", "Agents")).toBe(false);
	});

	it("respects a custom / nested agent folder and tolerates leading slashes", () => {
		expect(isAgentPath("Meta/Agents/Skills/x/SKILL.md", "Meta/Agents")).toBe(true);
		expect(isAgentPath("/Agents/Skills/x/SKILL.md", "Agents")).toBe(true);
		expect(isAgentPath("Agents/x.md", "Meta/Agents")).toBe(false);
	});

	it("never matches when the folder is empty", () => {
		expect(isAgentPath("anything.md", "")).toBe(false);
	});
});

describe("isAgentFilePath / isIndexableFile (folder from plugin data)", () => {
	it("isAgentFilePath reads the configured agent folder", () => {
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		expect(isAgentFilePath("Agents/Skills/foo/SKILL.md")).toBe(true);
		expect(isAgentFilePath("Agents/Memories/x.md")).toBe(true);
		expect(isAgentFilePath("Projects/foo.md")).toBe(false);
	});

	it("isIndexableFile excludes agent-folder files and includes normal notes", () => {
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		expect(isIndexableFile({ path: "Agents/Skills/foo/SKILL.md" } as never)).toBe(false);
		expect(isIndexableFile({ path: "Agents/Base Prompts/default-agent.md" } as never)).toBe(false);
		expect(isIndexableFile({ path: "Projects/note.md" } as never)).toBe(true);
	});

	it("tracks a custom folder", () => {
		mockGetData.mockReturnValue({ agentFolder: "Meta/Agents" });
		expect(isAgentFilePath("Meta/Agents/Skills/foo/SKILL.md")).toBe(true);
		expect(isAgentFilePath("Agents/Skills/foo/SKILL.md")).toBe(false);
	});

	it("fails open when the data store is uninitialized", () => {
		mockGetData.mockImplementation(() => {
			throw new Error("Plugin does not exist");
		});
		expect(isAgentFilePath("Agents/Skills/foo/SKILL.md")).toBe(false);
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
	});
});

// ---------------------------------------------------------------------------
// .chat extraction
// ---------------------------------------------------------------------------

/** Build a LangChain-serialised message as stored inside a checkpoint. */
function message(id: string | null, content: string): Record<string, unknown> {
	const kwargs: Record<string, unknown> = { content };
	if (id !== null) kwargs.id = id;
	return { lc: 1, type: "constructor", kwargs };
}

/**
 * Build thread JSON whose checkpoints form a growing prefix chain — the shape
 * LangGraph actually persists, where checkpoint N re-contains messages 1..N.
 */
function thread(title: string, messages: Array<Record<string, unknown>>): string {
	const checkpoints: Record<string, unknown> = {};
	for (let i = 1; i <= messages.length; i++) {
		checkpoints[`cp-${i}`] = {
			checkpoint: { id: `cp-${i}`, channel_values: { messages: messages.slice(0, i) } },
		};
	}
	return JSON.stringify({ title, checkpoints });
}

/** Minimal vault stub exposing the `adapter.readBinary` path used for .chat files. */
function vaultReturning(raw: string | Uint8Array) {
	return {
		adapter: {
			readBinary: vi.fn().mockImplementation(async () => {
				const bytes = typeof raw === "string" ? await gzipString(raw) : raw;
				return toArrayBuffer(bytes);
			}),
		},
	} as never;
}

const chatFile = { path: "Chats/Thread.chat", extension: "chat", basename: "Thread" } as never;

describe("readIndexableContent (.chat extraction)", () => {
	it("emits each message once despite the checkpoint tree repeating it", async () => {
		const raw = thread("Greeting", [
			message("m1", "hello there"),
			message("m2", "general kenobi"),
			message("m3", "you are a bold one"),
		]);

		const out = await readIndexableContent(vaultReturning(raw), chatFile);

		// Naive per-checkpoint concatenation would emit m1 three times and m2 twice.
		expect(out.match(/hello there/g)).toHaveLength(1);
		expect(out.match(/general kenobi/g)).toHaveLength(1);
		expect(out.match(/you are a bold one/g)).toHaveLength(1);
	});

	it("preserves the title and first-seen transcript order", async () => {
		const raw = thread("Greeting", [message("m1", "first"), message("m2", "second")]);

		const out = await readIndexableContent(vaultReturning(raw), chatFile);

		expect(out).toBe("Greeting\n\nfirst\n\nsecond");
	});

	it("keeps distinct messages that share identical text", async () => {
		// Two separate turns can legitimately both be "yes"; ids keep them apart.
		const raw = thread("Confirmations", [message("m1", "yes"), message("m2", "yes")]);

		const out = await readIndexableContent(vaultReturning(raw), chatFile);

		expect(out.match(/yes/g)).toHaveLength(2);
	});

	it("falls back to content deduplication when messages carry no id", async () => {
		const raw = thread("Legacy", [message(null, "alpha"), message(null, "beta")]);

		const out = await readIndexableContent(vaultReturning(raw), chatFile);

		expect(out.match(/alpha/g)).toHaveLength(1);
		expect(out.match(/beta/g)).toHaveLength(1);
	});

	it("returns an empty string for corrupt thread JSON", async () => {
		const out = await readIndexableContent(vaultReturning("not json at all"), chatFile);

		expect(out).toBe("");
	});

	it("returns an empty string when the file cannot be read", async () => {
		const vault = {
			adapter: { readBinary: vi.fn().mockRejectedValue(new Error("unreadable")) },
		} as never;

		expect(await readIndexableContent(vault, chatFile)).toBe("");
	});
});

describe("isIndexableFile (content-free extensions)", () => {
	const f = (path: string, extension: string) => ({ path, extension }) as never;

	it("excludes files with no extractable text", () => {
		// These were indexed as title-only vectors, which sit at the similarity noise
		// floor (~0.46-0.48 against any query) and displace real notes.
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		expect(isIndexableFile(f("TaskNotes/Views/tasks.base", "base"))).toBe(false);
		expect(isIndexableFile(f("Assets/diagram.png", "png"))).toBe(false);
		expect(isIndexableFile(f("Assets/photo.JPG", "JPG"))).toBe(false);
		expect(isIndexableFile(f("Assets/clip.mp4", "mp4"))).toBe(false);
	});

	it("keeps notes and PDFs, whose text can be extracted", () => {
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		expect(isIndexableFile(f("Notes/note.md", "md"))).toBe(true);
		expect(isIndexableFile(f("Papers/paper.pdf", "pdf"))).toBe(true);
		expect(isIndexableFile(f("Chats/thread.chat", "chat"))).toBe(true);
	});
});

describe("readIndexableContent (PDF)", () => {
	const pdfFile = { path: "Papers/paper.pdf", extension: "pdf", basename: "paper" } as never;

	it("returns an empty string when the PDF cannot be parsed", async () => {
		// Encrypted, malformed, or scanned-without-OCR must skip the file rather than
		// fail the whole index run.
		const vault = {
			adapter: { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)) },
		} as never;

		expect(await readIndexableContent(vault, pdfFile)).toBe("");
	});

	it("returns an empty string when the file cannot be read at all", async () => {
		const vault = {
			adapter: { readBinary: vi.fn().mockRejectedValue(new Error("missing")) },
		} as never;

		expect(await readIndexableContent(vault, pdfFile)).toBe("");
	});
});

describe("rename into a non-indexable extension", () => {
	// Review finding: both index listeners gated the rename event on
	// `isIndexableFile(file)` — the *post-rename* file. Renaming `note.md` to
	// `note.base` therefore skipped the handler entirely, so `removeDocument(oldPath)`
	// never ran and the pre-rename document stayed searchable. The guard now lives
	// inside the handler, after the removal.
	it("classifies the destination as non-indexable, so the old entry must be dropped", () => {
		mockGetData.mockReturnValue({ agentFolder: "Agents" });
		const before = { path: "Notes/note.md", extension: "md" } as never;
		const after = { path: "Notes/note.base", extension: "base" } as never;

		expect(isIndexableFile(before)).toBe(true);
		// The destination is excluded — which is exactly why the event must not be
		// filtered on it before the stale path is removed.
		expect(isIndexableFile(after)).toBe(false);
	});
});
