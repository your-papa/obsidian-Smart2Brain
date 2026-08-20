import { describe, expect, it } from "vitest";
import {
	type ShippedHistory,
	fingerprint,
	isShippedDefault,
	normalizeShipped,
	shippedVersion,
} from "../../src/utils/shippedDefaults";

describe("normalizeShipped", () => {
	/*
	 * This is the load-bearing part of the whole mechanism. Content round-trips through the
	 * vault adapter and through whatever editor the user opens the note in, and either can
	 * change line endings or append a final newline without the user touching a character.
	 *
	 * Getting this wrong misclassifies installs wholesale — and in the worse direction: an
	 * untouched file reads as "customized", so it never receives an update and instead nags
	 * the user with a notice about a change they didn't make.
	 */
	it("treats CRLF and LF as the same content", () => {
		const lf = "line one\nline two\nline three";
		expect(normalizeShipped(lf.replace(/\n/g, "\r\n"))).toBe(lf);
		expect(fingerprint(lf.replace(/\n/g, "\r\n"))).toBe(fingerprint(lf));
	});

	it("ignores leading and trailing whitespace", () => {
		const body = "# Skill\n\nSome guidance.";
		expect(fingerprint(`${body}\n`)).toBe(fingerprint(body));
		expect(fingerprint(`${body}\n\n\n`)).toBe(fingerprint(body));
		expect(fingerprint(`\n${body}  `)).toBe(fingerprint(body));
	});

	it("does NOT ignore interior whitespace changes", () => {
		// Reflowing a paragraph or re-indenting a list IS an edit — normalization must not
		// reach so far that a real customization gets silently overwritten.
		expect(fingerprint("a\nb")).not.toBe(fingerprint("a\n\nb"));
		expect(fingerprint("- item")).not.toBe(fingerprint("-   item"));
	});
});

describe("fingerprint", () => {
	it("is stable across calls", () => {
		expect(fingerprint("some shipped text")).toBe(fingerprint("some shipped text"));
	});

	it("distinguishes different content", () => {
		expect(fingerprint("version one")).not.toBe(fingerprint("version two"));
		// Single-character differences must not collide — bumped guidance often differs by
		// very little.
		expect(fingerprint("escalate the algorithm once")).not.toBe(fingerprint("escalate the algorithm twice"));
	});

	it("is a fixed-width hex digest", () => {
		for (const text of ["", "a", "a much longer body\n".repeat(500)]) {
			expect(fingerprint(text)).toMatch(/^[0-9a-f]{16}$/);
		}
	});

	it("handles non-ASCII content", () => {
		// The real bodies contain em dashes, §, and typographic quotes; hashing UTF-8 bytes
		// keeps the digest independent of JS string encoding quirks.
		expect(fingerprint("§ Introduction — “quoted”")).toMatch(/^[0-9a-f]{16}$/);
		expect(fingerprint("café")).not.toBe(fingerprint("cafe"));
	});
});

describe("shippedVersion / isShippedDefault", () => {
	const V1 = "the body we shipped first";
	const V2 = "the body we ship now";
	const history: ShippedHistory = new Map([
		[1, fingerprint(V1)],
		[2, fingerprint(V2)],
	]);

	it("identifies which version content came from", () => {
		expect(shippedVersion(V1, history)).toBe(1);
		expect(shippedVersion(V2, history)).toBe(2);
	});

	it("returns null for content we never shipped", () => {
		expect(shippedVersion("the user's own rewrite", history)).toBeNull();
		expect(isShippedDefault("the user's own rewrite", history)).toBe(false);
	});

	it("recognizes any shipped version, not just the newest", () => {
		expect(isShippedDefault(V1, history)).toBe(true);
		expect(isShippedDefault(V2, history)).toBe(true);
	});

	it("recognizes a shipped version through incidental reformatting", () => {
		expect(shippedVersion(`${V1.replace(/ /g, " ")}\n`, history)).toBe(1);
	});

	it("reports nothing for an empty history", () => {
		expect(shippedVersion(V1, new Map())).toBeNull();
	});

	it("supports string version keys, as bundled skills use", () => {
		const skillHistory: ShippedHistory = new Map([
			["1.0", fingerprint(V1)],
			["1.1", fingerprint(V2)],
		]);
		expect(shippedVersion(V1, skillHistory)).toBe("1.0");
		expect(shippedVersion(V2, skillHistory)).toBe("1.1");
	});
});
