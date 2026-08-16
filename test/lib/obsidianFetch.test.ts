import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestUrl } from "obsidian";
import { createObsidianFetch } from "../../src/lib/obsidianFetch";

const mockRequestUrl = vi.mocked(requestUrl);

function lastHeaders(): Record<string, string> {
	const call = mockRequestUrl.mock.calls.at(-1);
	return (call?.[0].headers ?? {}) as Record<string, string>;
}

describe("createObsidianFetch header normalization", () => {
	beforeEach(() => {
		mockRequestUrl.mockClear();
		mockRequestUrl.mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/json" },
			text: '{"ok":true}',
			json: { ok: true },
		});
	});

	// The regression this file exists for: the OpenAI SDK always passes a `Headers`
	// instance. The old implementation cast it to Record and copied onto itself, so
	// requestUrl received a Headers object and read no headers from it — the auth
	// header vanished, the request never completed, and the promise never settled
	// (indexing stuck at 0/N with no error).
	it("converts a Headers instance into a plain record", async () => {
		const fetchImpl = createObsidianFetch();
		const headers = new Headers();
		headers.set("authorization", "Bearer secret-token");
		headers.set("content-type", "application/json");

		await fetchImpl("https://example.com/v1/embeddings", {
			method: "POST",
			headers,
			body: '{"input":"probe"}',
		});

		const sent = lastHeaders();
		expect(sent.authorization).toBe("Bearer secret-token");
		expect(sent["content-type"]).toBe("application/json");
		// Must be a real record, not a Headers instance wearing a Record type.
		expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
	});

	it("does not mutate the caller's Headers instance", async () => {
		const fetchImpl = createObsidianFetch();
		const headers = new Headers();
		headers.set("authorization", "Bearer secret-token");

		await fetchImpl("https://example.com/v1/embeddings", { method: "POST", headers });

		// The old code assigned own properties onto the Headers object.
		expect(Object.keys(headers)).toHaveLength(0);
		expect(headers.get("authorization")).toBe("Bearer secret-token");
	});

	it("accepts an array of header pairs", async () => {
		const fetchImpl = createObsidianFetch();

		await fetchImpl("https://example.com/v1/embeddings", {
			method: "POST",
			headers: [
				["authorization", "Bearer secret-token"],
				["x-custom", "1"],
			],
		});

		const sent = lastHeaders();
		expect(sent.authorization).toBe("Bearer secret-token");
		expect(sent["x-custom"]).toBe("1");
	});

	it("accepts a plain record and preserves its entries", async () => {
		const fetchImpl = createObsidianFetch();

		await fetchImpl("https://example.com/v1/embeddings", {
			method: "POST",
			headers: { authorization: "Bearer secret-token" },
		});

		expect(lastHeaders().authorization).toBe("Bearer secret-token");
	});

	it("sends an empty record when no headers are supplied", async () => {
		const fetchImpl = createObsidianFetch();

		await fetchImpl("https://example.com/v1/embeddings", { method: "POST" });

		expect(lastHeaders()).toEqual({});
	});

	it("prefers native fetch and skips requestUrl when it succeeds", async () => {
		const native = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
		const fetchImpl = createObsidianFetch(native);

		const res = await fetchImpl("https://example.com/v1/embeddings", { method: "POST" });

		expect(native).toHaveBeenCalledTimes(1);
		expect(mockRequestUrl).not.toHaveBeenCalled();
		expect(res.status).toBe(200);
	});

	it("falls back to requestUrl with normalized headers when native fetch throws", async () => {
		const native = vi.fn().mockRejectedValue(new Error("CORS"));
		const fetchImpl = createObsidianFetch(native);
		const headers = new Headers();
		headers.set("authorization", "Bearer secret-token");

		const res = await fetchImpl("https://example.com/v1/embeddings", { method: "POST", headers });

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		expect(lastHeaders().authorization).toBe("Bearer secret-token");
		expect(res.status).toBe(200);
	});
});
