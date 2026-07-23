import { describe, expect, it, vi } from "vitest";

// Logger touches Obsidian-adjacent globals; stub it so the pure matcher is testable in isolation.
vi.mock("../../src/utils/logging", () => ({
	Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}));

import { buildGrepMatcher, escapeRegExp, MAX_REGEX_INPUT_LENGTH } from "../../src/agent/tools/grepMatcher";

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

describe("buildGrepMatcher — ReDoS protection", () => {
	it("rejects nested-quantifier patterns", () => {
		const built = buildGrepMatcher("(a+)+$", true, false);
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.error).toContain("rejected");
	});

	it("rejects quantified-alternation patterns", () => {
		const built = buildGrepMatcher("(a|a)*", true, false);
		expect(built.ok).toBe(false);
	});

	it("rejects bounded repetition applied to a group", () => {
		const built = buildGrepMatcher("(a+){10,}", true, false);
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(built.error).toContain("rejected");
	});

	it("rejects a large explicit repetition bound", () => {
		expect(buildGrepMatcher("a{5000}", true, false).ok).toBe(false);
		expect(buildGrepMatcher("x{0,9999}", true, false).ok).toBe(false);
		expect(buildGrepMatcher("y{2000,}", true, false).ok).toBe(false);
	});

	it("still accepts a modest bounded repetition", () => {
		const built = buildGrepMatcher("a{2,5}", true, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.test("aaa")).toBe(true);
	});

	it("still accepts ordinary quantifiers", () => {
		const built = buildGrepMatcher("\\d+", true, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.test("abc123")).toBe(true);
	});

	it("matches against long content (no length cap inside the matcher)", () => {
		// The matcher no longer caps input length — grep_notes enforces its own
		// per-line limit. manage_notes runs count/replace against whole notes,
		// which routinely exceed 5000 chars, so the matcher must still match.
		const built = buildGrepMatcher("needle", true, false);
		if (!built.ok) return;
		const bigNote = `${"x".repeat(6000)}needle${"y".repeat(6000)}`;
		expect(built.matcher.test(bigNote)).toBe(true);
		expect(built.matcher.count(bigNote)).toBe(1);
	});

	it("does not treat an escaped paren as a group terminator", () => {
		// `\){5,10}` repeats a literal ')' — it is NOT a bounded group repetition
		// and must be accepted.
		const built = buildGrepMatcher("\\){5,10}", true, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.test(")))))")).toBe(true);
	});

	it("accepts escaped braces and parens generally", () => {
		expect(buildGrepMatcher("\\(a\\)", true, false).ok).toBe(true);
		expect(buildGrepMatcher("price\\{\\d+\\}", true, false).ok).toBe(true);
	});

	it("catches nested quantifiers hidden inside a character class", () => {
		// The `)` lives inside `[^)]`, so a screen that scans group bodies with
		// `[^)]*` would stop early and miss the real `(…+)+` shape. The class-aware
		// screen must still reject these.
		expect(buildGrepMatcher("([^)]+)+$", true, false).ok).toBe(false);
		expect(buildGrepMatcher("([^x]+)*$", true, false).ok).toBe(false);
	});

	it("accepts a safe pattern with escaped parens around a quantifier", () => {
		// `\(a+\)+` is a literal '(' , a+, literal ')', repeated — NOT a quantified
		// group. Neutralizing escapes to placeholders (not deleting them) keeps it
		// from collapsing to `(a+)+` and being wrongly rejected.
		const built = buildGrepMatcher("\\(a+\\)+", true, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.test("(aaa))")).toBe(true);
	});

	it("does not screen literal needles (parens are literal there)", () => {
		const built = buildGrepMatcher("(a+)+", false, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.test("literal (a+)+ text")).toBe(true);
	});
});

describe("buildGrepMatcher — empty-match handling", () => {
	it("flags empty-matchable regex and counts them as zero", () => {
		const built = buildGrepMatcher("x*", true, false);
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		expect(built.matcher.matchesEmpty).toBe(true);
		// `x*` matches at every position; a naive String.match(/x*/g) would
		// inflate this — count must not.
		expect(built.matcher.count("abc")).toBe(0);
	});

	it("counts a real repeated regex correctly (non-overlapping)", () => {
		const built = buildGrepMatcher("\\d+", true, false);
		if (!built.ok) return;
		expect(built.matcher.matchesEmpty).toBe(false);
		expect(built.matcher.count("a12b3c456")).toBe(3);
	});

	it("singleRegex replaces only the first match; globalRegex replaces all", () => {
		const built = buildGrepMatcher("\\d", true, false);
		if (!built.ok) return;
		expect("a1b2c3".replace(built.matcher.singleRegex(), "#")).toBe("a#b2c3");
		expect("a1b2c3".replace(built.matcher.globalRegex(), "#")).toBe("a#b#c#");
	});

	it("literal needle is never empty-matchable unless the pattern is empty", () => {
		const built = buildGrepMatcher("foo", false, false);
		if (!built.ok) return;
		expect(built.matcher.matchesEmpty).toBe(false);
	});
});

describe("buildGrepMatcher — input-length ceiling (ReDoS backstop)", () => {
	it("exposes MAX_REGEX_INPUT_LENGTH as maxInputLength for a regex matcher", () => {
		const built = buildGrepMatcher("needle", true, false);
		if (!built.ok) return;
		expect(built.matcher.maxInputLength).toBe(MAX_REGEX_INPUT_LENGTH);
	});

	it("does not run a regex against input longer than the ceiling", () => {
		const built = buildGrepMatcher("needle", true, false);
		if (!built.ok) return;
		// Over-length input: the matcher refuses to run (backstop), so it reports
		// no match / zero count even though the needle is present. Callers detect
		// this via maxInputLength and surface a clear error instead.
		const over = `${"x".repeat(MAX_REGEX_INPUT_LENGTH + 1)}needle`;
		expect(built.matcher.test(over)).toBe(false);
		expect(built.matcher.count(over)).toBe(0);
		// At/under the ceiling it still matches normally.
		const under = `${"x".repeat(1000)}needle`;
		expect(built.matcher.test(under)).toBe(true);
		expect(built.matcher.count(under)).toBe(1);
	});

	it("does not cap literal needles (they cannot backtrack)", () => {
		const built = buildGrepMatcher("needle", false, false);
		if (!built.ok) return;
		expect(built.matcher.maxInputLength).toBe(Number.POSITIVE_INFINITY);
		const over = `${"x".repeat(MAX_REGEX_INPUT_LENGTH + 1)}needle`;
		expect(built.matcher.test(over)).toBe(true);
		expect(built.matcher.count(over)).toBe(1);
	});
});
