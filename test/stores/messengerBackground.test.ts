import { describe, it, expect } from "vitest";
import { Messenger, BusyElsewhereError, ChatSession } from "../../src/stores/chatStore.svelte";
import type { AgentManager } from "../../src/agent/AgentManager";

/* --------------------------------------------------------------------------
 * Messenger — session map, one-at-a-time guard, reattach, eviction, rekey
 *
 * These exercise the singleton-free surface of the background-streaming
 * refactor: the pointer logic (active/running), the busy guard, LRU eviction,
 * and map rekeying on thread rename. The full loadSession/streaming path is
 * covered by the headless integration suite (needs a live agent).
 * ------------------------------------------------------------------------*/

function makeMessenger(): Messenger {
	const stub = {} as unknown as AgentManager;
	return new Messenger(stub);
}

function makeSession(id: string): ChatSession {
	return new ChatSession(id, { graphState: { nodes: new Map() }, errorCount: 0 });
}

function seed(messenger: Messenger, id: string): ChatSession {
	const s = makeSession(id);
	messenger.sessions.set(id, s);
	return s;
}

describe("Messenger — active/running pointers", () => {
	it("session getter resolves through activeThreadPath", () => {
		const m = makeMessenger();
		expect(m.session).toBeNull();
		const a = seed(m, "a.chat");
		m.activeThreadPath = "a.chat";
		expect(m.session).toBe(a);
	});

	it("runningSession resolves through runningThreadPath", () => {
		const m = makeMessenger();
		const a = seed(m, "a.chat");
		expect(m.runningSession).toBeNull();
		m.runningThreadPath = "a.chat";
		expect(m.runningSession).toBe(a);
	});

	it("isBusyElsewhere is true only when a different thread is running", () => {
		const m = makeMessenger();
		seed(m, "a.chat");
		seed(m, "b.chat");
		expect(m.isBusyElsewhere("b.chat")).toBe(false);
		m.runningThreadPath = "a.chat";
		expect(m.isBusyElsewhere("a.chat")).toBe(false);
		expect(m.isBusyElsewhere("b.chat")).toBe(true);
		expect(m.isBusyElsewhere(null)).toBe(true);
	});
});

describe("Messenger — one-at-a-time guard", () => {
	it("sendMessage throws BusyElsewhereError when another chat is running", async () => {
		const m = makeMessenger();
		seed(m, "a.chat");
		seed(m, "b.chat");
		m.activeThreadPath = "b.chat";
		m.runningThreadPath = "a.chat";

		await expect(m.sendMessage("hi")).rejects.toBeInstanceOf(BusyElsewhereError);
		await expect(m.sendMessage("hi")).rejects.toMatchObject({ runningThreadPath: "a.chat" });
	});

	it("editMessage and regenerateResponse are guarded too", async () => {
		const m = makeMessenger();
		seed(m, "a.chat");
		seed(m, "b.chat");
		m.activeThreadPath = "b.chat";
		m.runningThreadPath = "a.chat";

		await expect(m.editMessage("pair-1", "x")).rejects.toBeInstanceOf(BusyElsewhereError);
		await expect(m.regenerateResponse("pair-1")).rejects.toBeInstanceOf(BusyElsewhereError);
		await expect(m.summarizeHistoryNow()).rejects.toBeInstanceOf(BusyElsewhereError);
	});

	it("run-starting actions are allowed on the currently-running chat itself", () => {
		const m = makeMessenger();
		seed(m, "a.chat");
		m.activeThreadPath = "a.chat";
		m.runningThreadPath = "a.chat";
		expect(m.isBusyElsewhere("a.chat")).toBe(false);
	});
});

describe("Messenger — LRU eviction of parked sessions", () => {
	it("keeps active + running + N most-recent idle sessions", () => {
		const m = makeMessenger();
		for (let i = 0; i < 6; i++) {
			const s = seed(m, `p${i}.chat`);
			s.lastTouchedAt = 1000 + i;
		}
		const active = seed(m, "active.chat");
		active.lastTouchedAt = 0;
		const running = seed(m, "running.chat");
		running.lastTouchedAt = 1;
		m.activeThreadPath = "active.chat";
		m.runningThreadPath = "running.chat";

		(m as unknown as { evictParkedSessions(): void }).evictParkedSessions();

		expect(m.sessions.has("active.chat")).toBe(true);
		expect(m.sessions.has("running.chat")).toBe(true);
		expect(m.sessions.has("p5.chat")).toBe(true);
		expect(m.sessions.has("p4.chat")).toBe(true);
		expect(m.sessions.has("p3.chat")).toBe(true);
		expect(m.sessions.has("p2.chat")).toBe(false);
		expect(m.sessions.has("p1.chat")).toBe(false);
		expect(m.sessions.has("p0.chat")).toBe(false);
	});

	it("never evicts a running session even if it is the least-recently touched", () => {
		const m = makeMessenger();
		for (let i = 0; i < 5; i++) {
			const s = seed(m, `p${i}.chat`);
			s.lastTouchedAt = 1000 + i;
		}
		const running = seed(m, "running.chat");
		running.lastTouchedAt = 0;
		m.runningThreadPath = "running.chat";

		(m as unknown as { evictParkedSessions(): void }).evictParkedSessions();
		expect(m.sessions.has("running.chat")).toBe(true);
	});
});

describe("Messenger — rekey on thread rename", () => {
	it("moves the session to the new key and repoints active/running", () => {
		const m = makeMessenger();
		const s = seed(m, "Untitled.chat");
		m.activeThreadPath = "Untitled.chat";
		m.runningThreadPath = "Untitled.chat";

		(m as unknown as { rekeySession(o: string, n: string): void }).rekeySession(
			"Untitled.chat",
			"Renamed Title.chat",
		);

		expect(m.sessions.has("Untitled.chat")).toBe(false);
		expect(m.sessions.get("Renamed Title.chat")).toBe(s);
		expect(m.activeThreadPath).toBe("Renamed Title.chat");
		expect(m.runningThreadPath).toBe("Renamed Title.chat");
	});

	it("is a no-op when old and new paths are equal", () => {
		const m = makeMessenger();
		const s = seed(m, "a.chat");
		(m as unknown as { rekeySession(o: string, n: string): void }).rekeySession("a.chat", "a.chat");
		expect(m.sessions.get("a.chat")).toBe(s);
	});
});

describe("ChatSession — isRunning reflects an in-flight stream", () => {
	it("is false on a freshly built session", () => {
		const s = makeSession("a.chat");
		expect(s.isRunning).toBe(false);
	});
});
