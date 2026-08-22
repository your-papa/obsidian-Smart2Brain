import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeElectronNetRequestInit, performAiFetch } from "../../src/lib/aiTransport";

describe("performAiFetch renderer transport", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses renderer fetch and preserves its AbortSignal", async () => {
		const controller = new AbortController();
		const rendererFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.signal).toBe(controller.signal);
			return new Response("ok");
		});
		vi.stubGlobal("fetch", rendererFetch);

		const response = await performAiFetch("test-provider", "https://example.com/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ stream: true, messages: [] }),
			signal: controller.signal,
		});

		expect(await response.text()).toBe("ok");
		expect(rendererFetch).toHaveBeenCalledOnce();
	});

	it("uses Electron net fetch without passing a renderer AbortSignal", async () => {
		const controller = new AbortController();
		const electronFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.signal).toBeUndefined();
			expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true });
			return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
				headers: { "content-type": "text/event-stream" },
			});
		});
		vi.stubGlobal("require", (id: string) => {
			if (id !== "electron") throw new Error(`Unexpected module: ${id}`);
			return { remote: { net: { fetch: electronFetch } } };
		});

		const response = await performAiFetch("test-provider", "http://localhost:10100/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ stream: true, messages: [] }),
			signal: controller.signal,
		});

		expect(electronFetch).toHaveBeenCalledOnce();
		expect(await response.text()).toContain("[DONE]");
	});

	it("does not mutate signal-free Electron request options", () => {
		const init: RequestInit = { method: "GET" };
		expect(normalizeElectronNetRequestInit(init)).toBe(init);
	});
});
