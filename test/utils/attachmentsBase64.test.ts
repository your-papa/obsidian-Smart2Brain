import { describe, expect, it } from "vitest";
import { toBase64, toBase64DataUri } from "../../src/utils/attachments";
import { arrayBufferToBase64Url, base64UrlToString, uint8ToBase64Url } from "../../src/providers/oauthNode";

function bytesToBuffer(bytes: number[]): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

describe("attachments base64 (web, no node Buffer)", () => {
	it("encodes known bytes to base64", () => {
		// "Man" → "TWFu"
		expect(toBase64(bytesToBuffer([0x4d, 0x61, 0x6e]))).toBe("TWFu");
	});

	it("matches Buffer's base64 for arbitrary bytes", () => {
		const bytes = Array.from({ length: 256 }, (_, i) => i);
		const expected = Buffer.from(new Uint8Array(bytes)).toString("base64");
		expect(toBase64(bytesToBuffer(bytes))).toBe(expected);
	});

	it("builds a data URI with the given mime type", () => {
		expect(toBase64DataUri(bytesToBuffer([0x4d, 0x61, 0x6e]), "image/png")).toBe("data:image/png;base64,TWFu");
	});

	it("handles large buffers without stack overflow", () => {
		const bytes = new Uint8Array(200_000).fill(65);
		const expected = Buffer.from(bytes).toString("base64");
		expect(toBase64(bytes.buffer)).toBe(expected);
	});
});

describe("oauthNode base64url helpers", () => {
	it("encodes url-safe with no padding", () => {
		// Bytes chosen to force '+' and '/' in standard base64.
		const b64url = uint8ToBase64Url(new Uint8Array([0xfb, 0xff, 0xbf]));
		expect(b64url).not.toContain("+");
		expect(b64url).not.toContain("/");
		expect(b64url).not.toContain("=");
	});

	it("matches Buffer's base64url for arbitrary bytes", () => {
		const bytes = new Uint8Array(Array.from({ length: 128 }, (_, i) => (i * 7) % 256));
		const expected = Buffer.from(bytes).toString("base64url");
		expect(arrayBufferToBase64Url(bytes.buffer)).toBe(expected);
	});

	it("decodes base64url back to the original string", () => {
		const original = JSON.stringify({ sub: "user", exp: 123, "🚀": true });
		const encoded = Buffer.from(original).toString("base64url");
		expect(base64UrlToString(encoded)).toBe(original);
	});
});
