import { describe, it, expect, vi, beforeEach } from "vitest";

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
		app: {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockResolvedValue(""),
					write: vi.fn().mockResolvedValue(undefined),
					mkdir: vi.fn().mockResolvedValue(undefined),
					remove: vi.fn().mockResolvedValue(undefined),
					rmdir: vi.fn().mockResolvedValue(undefined),
					list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
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
				threadId: "thread-1",
				title: "Test Thread",
				createdAt: 1000,
				updatedAt: 2000,
			});

			const result = await threadStore.read("thread-1");
			expect(result).toBeDefined();
			expect(result!.threadId).toBe("thread-1");
			expect(result!.title).toBe("Test Thread");
			expect(result!.createdAt).toBe(1000);
		});

		it("should list threads sorted by updatedAt descending", async () => {
			const threadStore = manager.asThreadStore();
			// Mark index as loaded to avoid rebuild
			(manager as unknown as { indexLoaded: boolean }).indexLoaded = true;

			// Populate threadIndex directly (write() defers index updates via debounce)
			const threadIndex = (manager as unknown as { threadIndex: Map<string, { threadId: string; title: string; createdAt: number; updatedAt: number }> }).threadIndex;
			threadIndex.set("old", { threadId: "old", title: "Old Thread", createdAt: 1000, updatedAt: 1000 });
			threadIndex.set("new", { threadId: "new", title: "New Thread", createdAt: 2000, updatedAt: 3000 });
			threadIndex.set("mid", { threadId: "mid", title: "Mid Thread", createdAt: 1500, updatedAt: 2000 });

			const threads = await threadStore.list();
			expect(threads).toHaveLength(3);
			expect(threads[0].threadId).toBe("new");
			expect(threads[1].threadId).toBe("mid");
			expect(threads[2].threadId).toBe("old");
		});

		it("should delete a thread", async () => {
			const threadStore = manager.asThreadStore();
			(manager as unknown as { indexLoaded: boolean }).indexLoaded = true;

			await threadStore.write({
				threadId: "to-delete",
				title: "Delete Me",
				createdAt: 1000,
				updatedAt: 1000,
			});

			await threadStore.delete("to-delete");

			const result = await threadStore.read("to-delete");
			expect(result).toBeUndefined();

			const threads = await threadStore.list();
			expect(threads.find((t) => t.threadId === "to-delete")).toBeUndefined();
		});

		it("should clear all threads", async () => {
			const threadStore = manager.asThreadStore();
			(manager as unknown as { indexLoaded: boolean }).indexLoaded = true;

			await threadStore.write({
				threadId: "t1",
				title: "Thread 1",
				createdAt: 1000,
				updatedAt: 1000,
			});
			await threadStore.write({
				threadId: "t2",
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
				threadId: "thread-update",
				title: "Original",
				createdAt: 1000,
				updatedAt: 1000,
			});

			await threadStore.write({
				threadId: "thread-update",
				title: "Updated Title",
				createdAt: 1000,
				updatedAt: 2000,
			});

			const result = await threadStore.read("thread-update");
			expect(result!.title).toBe("Updated Title");
			expect(result!.updatedAt).toBe(2000);
		});

		it("should flush a pending thread snapshot write to disk immediately", async () => {
			const threadStore = manager.asThreadStore();

			await threadStore.write({
				threadId: "thread-flush",
				title: "Flush Me",
				createdAt: 1000,
				updatedAt: 2000,
			});

			expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();

			await threadStore.flush?.("thread-flush");

			expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith(
				"Chats/thread-flush.chat",
				expect.stringContaining('"threadId":"thread-flush"'),
			);
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
				configurable: { thread_id: "thread-1", checkpoint_id: "cp-1" },
			};

			const savedConfig = await manager.put(config, checkpoint, metadata, {});

			expect(savedConfig.configurable!.checkpoint_id).toBe("cp-1");

			const tuple = await manager.getTuple({
				configurable: { thread_id: "thread-1", checkpoint_id: "cp-1" },
			});

			expect(tuple).toBeDefined();
			expect(tuple!.checkpoint.id).toBe("cp-1");
			expect(tuple!.metadata?.step).toBe(0);
		});

		it("should return the latest checkpoint when no checkpoint_id specified", async () => {
			const config = { configurable: { thread_id: "thread-2" } };

			await manager.put(
				config,
				makeCheckpoint("cp-old", "2024-01-01T00:00:00Z"),
				makeMetadata(0),
				{},
			);
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
				configurable: { thread_id: "nonexistent" },
			});
			expect(tuple).toBeUndefined();
		});

		it("should return undefined when thread_id is missing", async () => {
			const tuple = await manager.getTuple({ configurable: {} });
			expect(tuple).toBeUndefined();
		});

		it("should store and retrieve writes via putWrites", async () => {
			const config = { configurable: { thread_id: "thread-3", checkpoint_id: "cp-1" } };

			await manager.put(
				config,
				makeCheckpoint("cp-1", "2024-01-01T00:00:00Z"),
				makeMetadata(0),
				{},
			);

			const writes: [string, unknown][] = [["channel-1", { value: "test-write" }]];
			await manager.putWrites(config, writes, "task-1");

			const tuple = await manager.getTuple(config);
			expect(tuple).toBeDefined();
			expect(tuple!.pendingWrites).toBeDefined();
			expect(tuple!.pendingWrites!.length).toBeGreaterThanOrEqual(1);
		});

		it("should flush pending checkpoint persistence to disk", async () => {
			await manager.put(
				{ configurable: { thread_id: "thread-persist", checkpoint_id: "cp-1" } },
				makeCheckpoint("cp-1", "2024-01-01T00:00:00Z"),
				makeMetadata(0),
				{},
			);

			expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();

			await manager.flush("thread-persist");

			expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith(
				"Chats/thread-persist.chat",
				expect.stringContaining('"cp-1"'),
			);
		});

		it("should list checkpoints in order", async () => {
			const config = { configurable: { thread_id: "thread-4" } };

			await manager.put(
				config,
				makeCheckpoint("cp-1", "2024-01-01T00:00:00Z"),
				makeMetadata(0),
				{},
			);
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
			const config = { configurable: { thread_id: "thread-5" } };

			await manager.put(config, makeCheckpoint("cp-a", "2024-01-01T00:00:00Z"), makeMetadata(0), {});
			await manager.put(
				{ configurable: { thread_id: "thread-5", checkpoint_id: "cp-a" } },
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
			const threadData = {
				threadId: "rebuilt-thread",
				title: "Rebuilt",
				createdAt: 1000,
				updatedAt: 2000,
				checkpoints: {},
				writes: {},
			};

			(plugin.app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
			(plugin.app.vault.adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue({
				files: ["Chats/rebuilt-thread.chat"],
				folders: [],
			});
			(plugin.app.vault.adapter.read as ReturnType<typeof vi.fn>).mockImplementation(
				async (path: string) => {
					if (path.includes("rebuilt-thread.chat")) {
						return `${JSON.stringify(threadData)}\n`;
					}
					if (path.includes("threads.json")) {
						throw new Error("Not found");
					}
					return "";
				},
			);

			await manager.rebuildIndex();

			const threads = await manager.asThreadStore().list();
			expect(threads).toHaveLength(1);
			expect(threads[0].threadId).toBe("rebuilt-thread");
			expect(threads[0].title).toBe("Rebuilt");
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
				configurable: { thread_id: "thread-ann" },
				metadata: {
					agent_id: "agent-1",
					agent_name: "My Agent",
					model_provider: "openai",
					model: "gpt-4",
				},
			};

			await manager.put(config, checkpoint, makeMetadata(0), {});

			const tuple = await manager.getTuple({
				configurable: { thread_id: "thread-ann", checkpoint_id: "cp-ann" },
			});

			const messages = (tuple!.checkpoint.channel_values as Record<string, unknown[]>).messages;
			const aiMessage = messages[1] as Record<string, Record<string, Record<string, unknown>>>;
			expect(aiMessage.kwargs.response_metadata.agent_id).toBe("agent-1");
			expect(aiMessage.kwargs.response_metadata.model_provider).toBe("openai");
			expect(aiMessage.kwargs.response_metadata.model).toBe("gpt-4");
		});
	});
});
