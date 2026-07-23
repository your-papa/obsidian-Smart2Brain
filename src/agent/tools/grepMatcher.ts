import { Logger } from "../../utils/logging";

/**
 * Escapes a string so it can be embedded literally inside a RegExp.
 */
export function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface GrepMatcher {
	/** Test whether a single line/string matches the needle. */
	test(text: string): boolean;
	/**
	 * A fresh global RegExp for replace operations (`String.prototype.replace`).
	 * For literal needles the pattern is escaped; back-references in the
	 * replacement string only apply when the caller passed a real regex.
	 */
	globalRegex(): RegExp;
	/**
	 * A fresh non-global RegExp for single (first-match) replace operations.
	 * Shares the matcher's compiled source/flags so a single-match replace can
	 * never diverge from the `count`/uniqueness gate that authorized it.
	 */
	singleRegex(): RegExp;
	/** Count non-overlapping occurrences of the needle in `text`. */
	count(text: string): number;
	/**
	 * Whether the compiled needle can match the empty string (e.g. `x*`, `a?`).
	 * Such patterns make find-and-replace nonsensical (they "match" at every
	 * position), so callers should reject them rather than count/replace.
	 */
	readonly matchesEmpty: boolean;
}

export type BuildMatcherResult = { ok: true; matcher: GrepMatcher } | { ok: false; error: string };

/**
 * Longest line we will run a user-supplied regex against. `grep_notes` and
 * `manage_notes` scan every vault file synchronously on the UI thread, so an
 * unbounded line length turns even a linear regex into a visible freeze. Lines
 * longer than this are treated as non-matching (they are almost always minified
 * blobs / data URIs, not prose the agent means to search).
 */
const MAX_SCANNED_LINE_LENGTH = 20000;

/**
 * Reject regex patterns whose structure is prone to catastrophic backtracking
 * (ReDoS). A user- or agent-supplied pattern is compiled and then `.test()`ed
 * line-by-line across the whole vault on the only UI thread with no timeout, so
 * a pattern like `(a+)+$` against a long non-matching line would hard-lock
 * Obsidian. Detecting ReDoS in general is undecidable; we screen for the common
 * dangerous shapes (a quantified group whose body is itself quantified, and
 * quantified alternations with overlapping branches). Returns an error message
 * if the pattern looks unsafe, or `null` if it passes.
 */
function screenRegexForRedos(pattern: string): string | null {
	// A group that is quantified, whose body contains an unbounded quantifier:
	// (a+)+, (a*)*, (a+)*, (.*)+, (\d+){2,} etc. This is the classic exponential
	// nested-quantifier form.
	const nestedQuantifier = /\([^)]*[*+][^)]*\)\s*[*+]|\([^)]*[*+][^)]*\)\s*\{\d+,?\d*\}/;
	if (nestedQuantifier.test(pattern)) {
		return "quantifier applied to a group that already contains an unbounded quantifier (e.g. `(a+)+`)";
	}

	// Quantified alternation of single-char classes that overlap, e.g. (a|a)*,
	// (\w|\d)+ — overlapping branches under a quantifier backtrack badly.
	const quantifiedAlternation = /\([^)]*\|[^)]*\)\s*[*+]/;
	if (quantifiedAlternation.test(pattern)) {
		return "quantifier applied to an alternation group (e.g. `(a|a)*`) — prone to catastrophic backtracking";
	}

	return null;
}

/**
 * Build a shared literal/regex matcher used by both `grep_notes` (line-level
 * search) and the `manage_notes` replace paths (find-and-replace). Compiling in
 * one place keeps flag handling and invalid-regex reporting consistent.
 *
 * - Literal needles are matched with `String.includes` for `test`, and a
 *   RegExp built from an escaped pattern for `globalRegex`/`count` so replace
 *   can operate on all occurrences.
 * - Regex needles are validated here; an invalid pattern returns an error
 *   string rather than throwing.
 */
export function buildGrepMatcher(pattern: string, isRegex: boolean, caseSensitive: boolean): BuildMatcherResult {
	if (isRegex) {
		const redosReason = screenRegexForRedos(pattern);
		if (redosReason) {
			Logger.debug("[grepMatcher] Rejected potentially catastrophic regex:", pattern, redosReason);
			return {
				ok: false,
				error: `Error: Regular expression "${pattern}" was rejected: ${redosReason}. Simplify the pattern.`,
			};
		}

		let source: RegExp;
		try {
			source = new RegExp(pattern, caseSensitive ? "" : "i");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			Logger.debug("[grepMatcher] Invalid regex pattern:", pattern, message);
			return { ok: false, error: `Error: Invalid regular expression "${pattern}": ${message}` };
		}

		const globalFlags = `g${caseSensitive ? "" : "i"}`;
		const singleFlags = source.flags.replace("g", "");
		// A pattern matches empty if it can succeed against "". Such patterns make
		// find-and-replace meaningless (they match at every position).
		const matchesEmpty = new RegExp(source.source, singleFlags).test("");
		return {
			ok: true,
			matcher: {
				// A non-global clone avoids the stateful `lastIndex` trap when reusing `.test()` in a loop.
				test: (text: string) =>
					text.length <= MAX_SCANNED_LINE_LENGTH && new RegExp(source.source, singleFlags).test(text),
				globalRegex: () => new RegExp(source.source, globalFlags),
				singleRegex: () => new RegExp(source.source, singleFlags),
				count: (text: string) => {
					if (text.length > MAX_SCANNED_LINE_LENGTH) return 0;
					// Count non-overlapping matches. `matchAll` advances past
					// zero-length matches correctly (unlike `String.match(/g/)`,
					// which for an empty-matchable pattern returns one entry per
					// character and inflates the count).
					if (matchesEmpty) return 0;
					let n = 0;
					for (const _ of text.matchAll(new RegExp(source.source, globalFlags))) n++;
					return n;
				},
				matchesEmpty,
			},
		};
	}

	const escaped = escapeRegExp(pattern);
	const globalFlags = `g${caseSensitive ? "" : "i"}`;
	const singleFlags = caseSensitive ? "" : "i";
	const needle = caseSensitive ? pattern : pattern.toLowerCase();
	// A literal needle matches empty only when the pattern itself is empty.
	const matchesEmpty = pattern.length === 0;
	return {
		ok: true,
		matcher: {
			test: (text: string) => (caseSensitive ? text : text.toLowerCase()).includes(needle),
			globalRegex: () => new RegExp(escaped, globalFlags),
			singleRegex: () => new RegExp(escaped, singleFlags),
			count: (text: string) => {
				if (matchesEmpty) return 0;
				const matches = text.match(new RegExp(escaped, globalFlags));
				return matches ? matches.length : 0;
			},
			matchesEmpty,
		},
	};
}
