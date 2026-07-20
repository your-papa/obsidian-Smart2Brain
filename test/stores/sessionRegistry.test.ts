import { describe, it, expect } from "vitest";
import { SessionRegistry, ChatSession } from "../../src/stores/chatStore.svelte";
import type { AgentManager } from "../../src/agent/AgentManager";

/* --------------------------------------------------------------------------
 * SessionRegistry — per-thread sessions, running set, eviction, rekey
 *
 * The registry owns the global session map but holds NO single "active" or
 * "running" pointer. Each view binds to its own thread path and resolves its
 * session via `sessionFor(threadPath)`; running state is derived per-session
 * from `ChatSession.isRunning`. These tests exercise that surface. The full
 * loadSession/streaming path is covered by the headless integration suite.
 * ------------------------------------------------------------------------*/

function makeRegistry(): SessionRegistry {
	const stub = {} as unknown as AgentManager;
	return new SessionRegistry(stub);
}

function makeSession(id: string): ChatSession {
	return new ChatSession(id, { graphState: { nodes: new Map() }, errorCount: 0 });
}

function seed(registry: SessionRegistry, id: string): ChatSession {
	const s = makeSession(id);
	registry.sessions.set(id, s);
	return s;
}

/** Force a session into the "running" state without a live stream. `isRunning`
 * is derived from a private abortController; poke it via a cast. */
function markRunning(session: ChatSession, running: boolean): void {
	(session as unknown as { abortController: AbortController | null }).abortController = running
		? new AbortController()
		: null;
}

describe("SessionRegistry — sessionFor is per-thread", () => {
	it("resolves the session for a specific thread path, not a shared pointer", () => {
		const r = makeRegistry();
		expect(r.sessionFor("a.chat")).toBeNull();
		const a = seed(r, "a.chat");
		const b = seed(r, "b.chat");
		expect(r.sessionFor("a.chat")).toBe(a);
		expect(r.sessionFor("b.chat")).toBe(b);
		expect(r.sessionFor(null)).toBeNull();
	});
});

describe("SessionRegistry — running set derives from ChatSession.isRunning", () => {
	it("runningSessions/anyRunning reflect per-session state", () => {
		const r = makeRegistry();
		const a = seed(r, "a.chat");
		const b = seed(r, "b.chat");
		expect(r.anyRunning).toBe(false);
		expect(r.runningSessions).toEqual([]);

		markRunning(a, true);
		expect(r.anyRunning).toBe(true);
		expect(r.runningSessions).toEqual([a]);

		markRunning(b, true);
		expect(new Set(r.runningSessions)).toEqual(new Set([a, b]));

		markRunning(a, false);
		expect(r.runningSessions).toEqual([b]);
	});

	it("stopAll stops every running session and leaves idle ones alone", () => {
		const r = makeRegistry();
		const a = seed(r, "a.chat");
		const b = seed(r, "b.chat");
		markRunning(a, true);
		markRunning(b, true);
		let aStopped = false;
		let bStopped = false;
		a.stopStreaming = () => {
			aStopped = true;
		};
		b.stopStreaming = () => {
			bStopped = true;
		};
		r.stopAll();
		expect(aStopped).toBe(true);
		expect(bStopped).toBe(true);
	});
});

describe("SessionRegistry — per-session actions never cross threads", () => {
	it("a session's own isRunning is independent of other sessions", () => {
		const r = makeRegistry();
		const a = seed(r, "a.chat");
		const b = seed(r, "b.chat");
		markRunning(a, true);
		expect(a.isRunning).toBe(true);
		expect(b.isRunning).toBe(false);
		// The "busy" gate is per-view: a is running, so b is "busy elsewhere",
		// but a is free to act on itself.
		expect(r.anyRunning && !a.isRunning).toBe(false); // a can act
		expect(r.anyRunning && !b.isRunning).toBe(true); // b is blocked
	});
});

describe("SessionRegistry — LRU eviction protects ALL running sessions", () => {
	it("keeps every running session plus N most-recent idle ones", () => {
		const r = makeRegistry();
		for (let i = 0; i < 6; i++) {
			const s = seed(r, `p${i}.chat`);
			s.lastTouchedAt = 1000 + i;
		}
		// Two running sessions, both least-recently-touched — must survive.
		const run1 = seed(r, "run1.chat");
		run1.lastTouchedAt = 0;
		markRunning(run1, true);
		const run2 = seed(r, "run2.chat");
		run2.lastTouchedAt = 1;
		markRunning(run2, true);

		(r as unknown as { evictParkedSessions(): void }).evictParkedSessions();

		expect(r.sessions.has("run1.chat")).toBe(true);
		expect(r.sessions.has("run2.chat")).toBe(true);
		// Idle: keep the 3 most-recent (p5, p4, p3), drop older.
		expect(r.sessions.has("p5.chat")).toBe(true);
		expect(r.sessions.has("p4.chat")).toBe(true);
		expect(r.sessions.has("p3.chat")).toBe(true);
		expect(r.sessions.has("p2.chat")).toBe(false);
		expect(r.sessions.has("p1.chat")).toBe(false);
		expect(r.sessions.has("p0.chat")).toBe(false);
	});
});

describe("SessionRegistry — rekey on thread rename", () => {
	it("moves the session to the new key", () => {
		const r = makeRegistry();
		const s = seed(r, "Untitled.chat");

		(r as unknown as { rekeySession(o: string, n: string): void }).rekeySession(
			"Untitled.chat",
			"Renamed Title.chat",
		);

		expect(r.sessions.has("Untitled.chat")).toBe(false);
		expect(r.sessions.get("Renamed Title.chat")).toBe(s);
	});

	it("is a no-op when old and new paths are equal", () => {
		const r = makeRegistry();
		const s = seed(r, "a.chat");
		(r as unknown as { rekeySession(o: string, n: string): void }).rekeySession("a.chat", "a.chat");
		expect(r.sessions.get("a.chat")).toBe(s);
	});
});

describe("ChatSession — isRunning reflects an in-flight stream", () => {
	it("is false on a freshly built session", () => {
		const s = makeSession("a.chat");
		expect(s.isRunning).toBe(false);
	});
});
