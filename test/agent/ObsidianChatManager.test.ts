import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";

vi.mock("obsidian", () => import("../__mocks__/obsidian"));

// Mock dataStore.svelte for getChatFolder / targetFolder
vi.mock("../../src/stores/dataStore.svelte", () => ({
	getData: vi.fn(() => ({
		targetFolder: "Chats",
	})),
}));

import { ObsidianChatManager } from "../../src/agent/ObsidianChatManager";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------*/

function createMockPlugin() {
	return {
		manifest: { id: "smart-second-brain", dir: "smart-second-brain" },
		registerEvent: vi.fn(),
		app: {
			vault: {
				on: vi.fn(),
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue(""),
					readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
					write: vi.fn().mockResolvedValue(undefined),
					writeBinary: vi.fn().mockResolvedValue(undefined),
					mkdir: vi.fn().mockResolvedValue(undefined),
					remove: vi.fn().mockResolvedValue(undefined),
					rmdir: vi.fn().mockResolvedValue(undefined),
					list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
					stat: vi.fn().mockResolvedValue({ ctime: 1000, mtime: 2000, size: 100 }),
				},
				configDir: ".obsidian",
			},
		},
	};
}

function makeCheckpoint(id: string, ts: string): Checkpoint {
	return {
		v: 1,
		id,
		ts,
		channel_values: { messages: [] },
		channel_versions: {},
		versions_seen: {},
		pending_sends: [],
	};
}

function makeMetadata(step: number, parentCheckpointId?: string): CheckpointMetadata {
	return {
		source: "loop",
		step,
		writes: {},
		parents: parentCheckpointId ? { "": parentCheckpointId } : {},
	};
}

/* --------------------------------------------------------------------------
 * ObsidianChatManager – ThreadStore operations
 * ------------------------------------------------------------------------*/

describe("ObsidianChatManager", () => {
	let manager: ObsidianChatManager;
	let plugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		plugin = createMockPlugin();
		manager = new ObsidianChatManager(plugin as never);
	});

	describe("ThreadStore operations", () => {
		it("should create and read a thread snapshot", async () => {
			const threadStore = manager.asThreadStore();

			await threadStore.write({
				threadId: "Chats/thread-1.chat",
				title: "Test Thread",
				createdAt: 1000,
				updatedAt: 2000,
			});

			const result = await threadStore.read("Chats/thread-1.chat");
			expect(result).toBeDefined();
			expect(result!.threadId).toBe("Chats/thread-1.chat");
			expect(result!.title).toBe("Test Thread");
			expect(result!.createdAt).toBe(1000);
		});

		it("should list threads sorted by updatedAt descending", async () => {
			const threadStore = manager.asThreadStore();
			// Mark index as loaded to avoid rebuild
			(manager as unknown as { indexLoaded: boolean }).indexLoaded = true;

			// Populate threadIndex directly (write() defers index updates via debounce)
			const threadIndex = (
				manager as unknown as {
					threadIndex: Map<string, { threadId: string; title: string; createdAt: number; updatedAt: number }>;
				}
			).threadIndex;
			threadIndex.set("Chats/old.chat", {
				threadId: "Chats/old.chat",
				title: "Old Thread",
				createdAt: 1000,
				updatedAt: 1000,
			});
			threadIndex.set("Chats/new.chat", {
				threadId: "Chats/new.chat",
				title: "New Thread",
				createdAt: 2000,
				updatedAt: 3000,
			});
			threadIndex.set("Chats/mid.chat", {
				threadId: "Chats/mid.chat",
				title: "Mid Thread",
				createdAt: 1500,
				updatedAt: 2000,
			});

			const threads = await threadStore.list();
			expect(threads).toHaveLength(3);
			expect(threads[0].threadId).toBe("Chats/new.chat");
			expect(threads[1].threadId).toBe("Chats/mid.chat");
			expect(threads[2].threadId).toBe("Chats/old.chat");
		});

		it("should delete a thread", async () => {
			const threadStore = manager.asThreadStore();
			(manager as unknown as { indexLoaded: boolean }).indexLoaded = true;

			await threadStore.write({
				threadId: "Chats/to-delete.chat",
				title: "Delete Me",
				createdAt: 1000,
				updatedAt: 1000,
			});

			await threadStore.delete("Chats/to-delete.chat");

			const result = await threadStore.read("Chats/to-delete.chat");
			expect(result).toBeUndefined();

			const threads = await threadStore.list();
			expect(threads.find((t) => t.threadId === "Chats/to-delete.chat")).toBeUndefined();
		});

		it("should clear all threads", async () => {
			const threadStore = manager.asThreadStore();
			(manager as unknown as { indexLoaded: boolean }).indexLoaded = true;

			await threadStore.write({
				threadId: "Chats/t1.chat",
				title: "Thread 1",
				createdAt: 1000,
				updatedAt: 1000,
			});
			await threadStore.write({
				threadId: "Chats/t2.chat",
				title: "Thread 2",
				createdAt: 2000,
				updatedAt: 2000,
			});

			await threadStore.clear();

			const threads = await threadStore.list();
			expect(threads).toHaveLength(0);
		});

		it("should update an existing thread's metadata", async () => {
			const threadStore = manager.asThreadStore();

			await threadStore.write({
				threadId: "Chats/thread-update.chat",
				title: "Original",
				createdAt: 1000,
				updatedAt: 1000,
			});

			await threadStore.write({
				threadId: "Chats/thread-update.chat",
				title: "Updated Title",
				createdAt: 1000,
				updatedAt: 2000,
			});

			const result = await threadStore.read("Chats/thread-update.chat");
			expect(result!.title).toBe("Updated Title");
			expect(result!.updatedAt).toBe(2000);
		});

		it("should flush a pending thread snapshot write to disk immediately", async () => {
			const threadStore = manager.asThreadStore();

			await threadStore.write({
				threadId: "Chats/thread-flush.chat",
				title: "Flush Me",
				createdAt: 1000,
				updatedAt: 2000,
			});

			expect(plugin.app.vault.adapter.writeBinary).not.toHaveBeenCalled();

			await threadStore.flush?.("Chats/thread-flush.chat");

			expect(plugin.app.vault.adapter.writeBinary).toHaveBeenCalled();
			const [path, buf] = (plugin.app.vault.adapter.writeBinary as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(path).toBe("Chats/thread-flush.chat");
			const json = gunzipSync(Buffer.from(buf)).toString("utf8");
			expect(json).toContain('"threadId":"Chats/thread-flush.chat"');
		});
	});

	/* --------------------------------------------------------------------------
	 * CheckpointSaver operations
	 * ------------------------------------------------------------------------*/

	describe("CheckpointSaver operations", () => {
		it("should store and retrieve a checkpoint via put/getTuple", async () => {
			const checkpoint = makeCheckpoint("cp-1", "2024-01-01T00:00:00Z");
			const metadata = makeMetadata(0);
			const config = {
				configurable: { thread_id: "Chats/thread-1.chat", checkpoint_id: "cp-1" },
			};

			const savedConfig = await manager.put(config, checkpoint, metadata, {});

			expect(savedConfig.configurable!.checkpoint_id).toBe("cp-1");

			const tuple = await manager.getTuple({
				configurable: { thread_id: "Chats/thread-1.chat", checkpoint_id: "cp-1" },
			});

			expect(tuple).toBeDefined();
			expect(tuple!.checkpoint.id).toBe("cp-1");
			expect(tuple!.metadata?.step).toBe(0);
		});

		it("should return the latest checkpoint when no checkpoint_id specified", async () => {
			const config = { configurable: { thread_id: "Chats/thread-2.chat" } };

			await manager.put(config, makeCheckpoint("cp-old", "2024-01-01T00:00:00Z"), makeMetadata(0), {});
			await manager.put(
				{ ...config, configurable: { ...config.configurable, checkpoint_id: "cp-old" } },
				makeCheckpoint("cp-new", "2024-01-01T00:01:00Z"),
				makeMetadata(1, "cp-old"),
				{},
			);

			const tuple = await manager.getTuple(config);
			expect(tuple).toBeDefined();
			expect(tuple!.checkpoint.id).toBe("cp-new");
		});

		it("should return undefined for non-existent thread", async () => {
			const tuple = await manager.getTuple({
				configurable: { thread_id: "Chats/nonexistent.chat" },
			});
			expect(tuple).toBeUndefined();
		});

		it("should return undefined when thread_id is missing", async () => {
			const tuple = await manager.getTuple({ configurable: {} });
			expect(tuple).toBeUndefined();
		});

		it("should store and retrieve writes via putWrites", async () => {
			const config = { configurable: { thread_id: "Chats/thread-3.chat", checkpoint_id: "cp-1" } };

			await manager.put(config, makeCheckpoint("cp-1", "2024-01-01T00:00:00Z"), makeMetadata(0), {});

			const writes: [string, unknown][] = [["channel-1", { value: "test-write" }]];
			await manager.putWrites(config, writes, "task-1");

			const tuple = await manager.getTuple(config);
			expect(tuple).toBeDefined();
			expect(tuple!.pendingWrites).toBeDefined();
			expect(tuple!.pendingWrites!.length).toBeGreaterThanOrEqual(1);
		});

		it("should flush pending checkpoint persistence to disk", async () => {
			await manager.put(
				{ configurable: { thread_id: "Chats/thread-persist.chat", checkpoint_id: "cp-1" } },
				makeCheckpoint("cp-1", "2024-01-01T00:00:00Z"),
				makeMetadata(0),
				{},
			);

			expect(plugin.app.vault.adapter.writeBinary).not.toHaveBeenCalled();

			await manager.flush("Chats/thread-persist.chat");

			expect(plugin.app.vault.adapter.writeBinary).toHaveBeenCalled();
			const [path, buf] = (plugin.app.vault.adapter.writeBinary as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(path).toBe("Chats/thread-persist.chat");
			const json = gunzipSync(Buffer.from(buf)).toString("utf8");
			expect(json).toContain('"cp-1"');
		});

		it("should list checkpoints in order", async () => {
			const config = { configurable: { thread_id: "Chats/thread-4.chat" } };

			await manager.put(config, makeCheckpoint("cp-1", "2024-01-01T00:00:00Z"), makeMetadata(0), {});
			await manager.put(
				{ ...config, configurable: { ...config.configurable, checkpoint_id: "cp-1" } },
				makeCheckpoint("cp-2", "2024-01-01T00:01:00Z"),
				makeMetadata(1, "cp-1"),
				{},
			);
			await manager.put(
				{ ...config, configurable: { ...config.configurable, checkpoint_id: "cp-2" } },
				makeCheckpoint("cp-3", "2024-01-01T00:02:00Z"),
				makeMetadata(2, "cp-2"),
				{},
			);

			const tuples = [];
			for await (const tuple of manager.list(config)) {
				tuples.push(tuple);
			}

			expect(tuples).toHaveLength(3);
			// Should be sorted by timestamp descending
			expect(tuples[0].checkpoint.id).toBe("cp-3");
			expect(tuples[1].checkpoint.id).toBe("cp-2");
			expect(tuples[2].checkpoint.id).toBe("cp-1");
		});

		it("should respect limit option in list", async () => {
			const config = { configurable: { thread_id: "Chats/thread-5.chat" } };

			await manager.put(config, makeCheckpoint("cp-a", "2024-01-01T00:00:00Z"), makeMetadata(0), {});
			await manager.put(
				{ configurable: { thread_id: "Chats/thread-5.chat", checkpoint_id: "cp-a" } },
				makeCheckpoint("cp-b", "2024-01-01T00:01:00Z"),
				makeMetadata(1, "cp-a"),
				{},
			);

			const tuples = [];
			for await (const tuple of manager.list(config, { limit: 1 })) {
				tuples.push(tuple);
			}

			expect(tuples).toHaveLength(1);
			expect(tuples[0].checkpoint.id).toBe("cp-b");
		});
	});

	/* --------------------------------------------------------------------------
	 * Index rebuild from .chat files
	 * ------------------------------------------------------------------------*/

	describe("index rebuild", () => {
		it("should rebuild index from .chat files on disk", async () => {
			(plugin.app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
			(plugin.app.vault.adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue({
				files: ["Chats/rebuilt-thread.chat"],
				folders: [],
			});
			(plugin.app.vault.adapter.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
				ctime: 1000,
				mtime: 2000,
				size: 100,
			});

			await manager.rebuildIndex();

			const threads = await manager.asThreadStore().list();
			expect(threads).toHaveLength(1);
			expect(threads[0].threadId).toBe("Chats/rebuilt-thread.chat");
			expect(threads[0].title).toBe("rebuilt-thread");
			expect(threads[0].createdAt).toBe(1000);
			expect(threads[0].updatedAt).toBe(2000);
		});
	});

	/* --------------------------------------------------------------------------
	 * Generation metadata annotation
	 * ------------------------------------------------------------------------*/

	describe("generation metadata annotation", () => {
		it("should annotate new AI messages with generation metadata", async () => {
			const checkpoint = makeCheckpoint("cp-ann", "2024-01-01T00:00:00Z");
			(checkpoint.channel_values as Record<string, unknown>).messages = [
				{
					type: "human",
					kwargs: { content: "Hello" },
				},
				{
					type: "ai",
					kwargs: {
						content: "Hi!",
						response_metadata: {},
					},
				},
			];

			const config = {
				configurable: { thread_id: "Chats/thread-ann.chat" },
				metadata: {
					agent_id: "agent-1",
					agent_name: "My Agent",
					model_provider: "openai",
					model: "gpt-4",
				},
			};

			await manager.put(config, checkpoint, makeMetadata(0), {});

			const tuple = await manager.getTuple({
				configurable: { thread_id: "Chats/thread-ann.chat", checkpoint_id: "cp-ann" },
			});

			const messages = (tuple!.checkpoint.channel_values as Record<string, unknown[]>).messages;
			const aiMessage = messages[1] as Record<string, Record<string, Record<string, unknown>>>;
			expect(aiMessage.kwargs.response_metadata.agent_id).toBe("agent-1");
			expect(aiMessage.kwargs.response_metadata.model_provider).toBe("openai");
			expect(aiMessage.kwargs.response_metadata.model).toBe("gpt-4");
		});
	});
});
