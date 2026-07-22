import { describe, expect, it, vi } from "vitest";

// Logger touches Obsidian-adjacent globals; stub it so the pure matcher is testable in isolation.
vi.mock("../../src/utils/logging", () => ({
	Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}));

import { buildGrepMatcher, escapeRegExp } from "../../src/agent/tools/grepMatcher";

describe("escapeRegExp", () => {
	it("escapes regex metacharacters", () => {
		expect(escapeRegExp("a.b*c+")).toBe("a\\.b\\*c\\+");
		expect(escapeRegExp("TODO(fix)")).toBe("TODO\\(fix\\)");
		expect(escapeRegExp("#tag")).toBe("#tag");
	});
});

describe("buildGrepMatcher — literal", () => {
	it("matches a literal substring case-insensitively by default", () => {
		const built = buildGrepMatcher("todo", false, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.test("A TODO line")).toBe(true);
		expect(built.matcher.test("nothing here")).toBe(false);
	});

	it("respects case sensitivity", () => {
		const built = buildGrepMatcher("TODO", false, true);
		if (!built.ok) return;
		expect(built.matcher.test("TODO")).toBe(true);
		expect(built.matcher.test("todo")).toBe(false);
	});

	it("treats special characters literally, not as regex", () => {
		const built = buildGrepMatcher("TODO(fix)", false, false);
		if (!built.ok) return;
		expect(built.matcher.test("a TODO(fix) here")).toBe(true);
		// A regex would treat (fix) as a group; literal must require the parens.
		expect(built.matcher.test("a TODOfix here")).toBe(false);
	});

	it("counts occurrences", () => {
		const built = buildGrepMatcher("a", false, true);
		if (!built.ok) return;
		expect(built.matcher.count("banana")).toBe(3);
	});
});

describe("buildGrepMatcher — regex", () => {
	it("matches a regex pattern", () => {
		const built = buildGrepMatcher("TODO|FIXME", true, false);
		if (!built.ok) return;
		expect(built.matcher.test("a FIXME here")).toBe(true);
		expect(built.matcher.test("nothing")).toBe(false);
	});

	it("does not carry lastIndex state across test() calls", () => {
		const built = buildGrepMatcher("x", true, false);
		if (!built.ok) return;
		// Two consecutive tests on matching strings must both return true
		// (a shared /g regex would flip-flop via lastIndex).
		expect(built.matcher.test("x")).toBe(true);
		expect(built.matcher.test("x")).toBe(true);
	});

	it("returns an error for an invalid regex", () => {
		const built = buildGrepMatcher("(unclosed", true, false);
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.error).toContain("Invalid regular expression");
	});

	it("counts regex occurrences", () => {
		const built = buildGrepMatcher("\\d", true, false);
		if (!built.ok) return;
		expect(built.matcher.count("a1b2c3")).toBe(3);
	});
});
