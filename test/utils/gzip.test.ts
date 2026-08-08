import { describe, expect, it } from "vitest";
import { gunzipToString, gzipString, toArrayBuffer } from "../../src/utils/gzip";

describe("gzip helpers", () => {
	it("round-trips an ASCII string", async () => {
		const input = "hello world";
		const compressed = await gzipString(input);
		expect(compressed.length).toBeGreaterThan(0);
		const out = await gunzipToString(compressed);
		expect(out).toBe(input);
	});

	it("round-trips JSON with unicode and emoji", async () => {
		const input = JSON.stringify({ title: "Zürich 日本語 🚀", items: [1, 2, 3], nested: { a: null } });
		const out = await gunzipToString(await gzipString(input));
		expect(out).toBe(input);
	});

	it("round-trips an empty string", async () => {
		const out = await gunzipToString(await gzipString(""));
		expect(out).toBe("");
	});

	it("round-trips a large repetitive payload", async () => {
		const input = "The quick brown fox. ".repeat(50_000);
		const compressed = await gzipString(input);
		// Highly repetitive text should compress far below its raw size.
		expect(compressed.length).toBeLessThan(input.length / 10);
		expect(await gunzipToString(compressed)).toBe(input);
	});

	it("gunzips from an ArrayBuffer as well as a Uint8Array", async () => {
		const bytes = await gzipString("payload");
		const buffer = toArrayBuffer(bytes);
		expect(buffer).toBeInstanceOf(ArrayBuffer);
		expect(await gunzipToString(buffer)).toBe("payload");
		expect(await gunzipToString(bytes)).toBe("payload");
	});

	it("produces standard gzip (0x1f 0x8b magic bytes)", async () => {
		const bytes = await gzipString("x");
		expect(bytes[0]).toBe(0x1f);
		expect(bytes[1]).toBe(0x8b);
	});
});
