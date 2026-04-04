const SEARCH_TERM_SPLIT_REGEX = /[^\p{L}\p{N}#@_-]+/u;
const NUMERIC_TERM_REGEX = /^\p{N}+$/u;

export function isNumericSearchTerm(term: string): boolean {
	return NUMERIC_TERM_REGEX.test(term);
}

export function isSignificantSearchTerm(term: string): boolean {
	return term.length > 1 || isNumericSearchTerm(term);
}

export function tokenizeSearchText(value: string): string[] {
	return value
		.toLowerCase()
		.split(SEARCH_TERM_SPLIT_REGEX)
		.map((term) => term.trim())
		.filter((term) => isSignificantSearchTerm(term));
}

export function extractNormalizedTokens(value: string): string[] {
	return value
		.toLowerCase()
		.split(SEARCH_TERM_SPLIT_REGEX)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

export function extractSearchTerms(value: string): string[] {
	return Array.from(new Set(tokenizeSearchText(value))).sort((left, right) => right.length - left.length);
}

export function normalizeSearchText(value: string): string {
	return extractNormalizedTokens(value).join(" ");
}
