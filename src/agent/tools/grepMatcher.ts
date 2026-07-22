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
	/** Count non-overlapping occurrences of the needle in `text`. */
	count(text: string): number;
}

export type BuildMatcherResult = { ok: true; matcher: GrepMatcher } | { ok: false; error: string };

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
		let source: RegExp;
		try {
			source = new RegExp(pattern, caseSensitive ? "" : "i");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			Logger.debug("[grepMatcher] Invalid regex pattern:", pattern, message);
			return { ok: false, error: `Error: Invalid regular expression "${pattern}": ${message}` };
		}

		const globalFlags = `g${caseSensitive ? "" : "i"}`;
		return {
			ok: true,
			matcher: {
				// A non-global clone avoids the stateful `lastIndex` trap when reusing `.test()` in a loop.
				test: (text: string) => new RegExp(source.source, source.flags.replace("g", "")).test(text),
				globalRegex: () => new RegExp(source.source, globalFlags),
				count: (text: string) => {
					const matches = text.match(new RegExp(source.source, globalFlags));
					return matches ? matches.length : 0;
				},
			},
		};
	}

	const escaped = escapeRegExp(pattern);
	const globalFlags = `g${caseSensitive ? "" : "i"}`;
	const needle = caseSensitive ? pattern : pattern.toLowerCase();
	return {
		ok: true,
		matcher: {
			test: (text: string) => (caseSensitive ? text : text.toLowerCase()).includes(needle),
			globalRegex: () => new RegExp(escaped, globalFlags),
			count: (text: string) => {
				const matches = text.match(new RegExp(escaped, globalFlags));
				return matches ? matches.length : 0;
			},
		},
	};
}
