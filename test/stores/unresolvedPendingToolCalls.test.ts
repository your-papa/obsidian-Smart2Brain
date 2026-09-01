import { describe, expect, it } from "vitest";
import { selectUnresolvedPendingIds, type ToolCallState } from "../../src/stores/chatStore.svelte";

function call(id: string, status: ToolCallState["status"], name = "manage_notes"): ToolCallState {
	return { id, name, status };
}

describe("selectUnresolvedPendingIds", () => {
	it("sweeps a call rejected at schema validation", () => {
		// The real failure: manage_notes was called with `content` on an `update`
		// operation, so Zod threw before on_tool_start — neither tool callback fired
		// and the announcement had nothing to resolve it.
		const ids = selectUnresolvedPendingIds([call("bad", "pending")]);
		expect([...ids]).toEqual(["bad"]);
	});

	it("leaves calls that actually started or finished alone", () => {
		const ids = selectUnresolvedPendingIds([call("a", "running"), call("b", "completed"), call("c", "failed")]);
		expect(ids.size).toBe(0);
	});

	it("sweeps only calls announced before the one that just ended", () => {
		// Tool execution is ordered, so a finished call proves earlier announcements
		// are dead — but says nothing about calls announced after it.
		const ids = selectUnresolvedPendingIds(
			[call("dead", "pending"), call("done", "completed"), call("later", "pending")],
			"done",
		);
		expect([...ids]).toEqual(["dead"]);
	});

	it("does not sweep when the ended call is the first one", () => {
		const ids = selectUnresolvedPendingIds([call("done", "completed"), call("later", "pending")], "done");
		expect(ids.size).toBe(0);
	});

	it("does not sweep everything when the reference id is unknown", () => {
		// findIndex returns -1 for an unknown id; treating that as "sweep all" would
		// erase live calls mid-stream.
		const ids = selectUnresolvedPendingIds([call("a", "pending")], "nope");
		expect(ids.size).toBe(0);
	});

	it("sweeps every stale announcement when no reference is given", () => {
		const ids = selectUnresolvedPendingIds([call("a", "pending"), call("b", "completed"), call("c", "pending")]);
		expect([...ids].sort()).toEqual(["a", "c"]);
	});

	it("handles an empty call list", () => {
		expect(selectUnresolvedPendingIds([]).size).toBe(0);
	});
});
