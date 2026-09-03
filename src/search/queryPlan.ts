import {
	extractNormalizedTokens,
	extractSearchTerms,
	isNumericSearchTerm,
	normalizeSearchText,
	tokenizeSearchText,
} from "./searchTermUtils";

export interface QueryPlan {
	rawQuery: string;
	normalizedQuery: string;
	normalizedTokens: string[];
	significantTokens: string[];
	searchTerms: string[];
	hasStrongToken: boolean;
	identityTokens: string[];
	identityQuery: string;
	candidateTokens: string[];
	candidateQuery: string;
	contentTokens: string[];
	contentQuery: string;
	minimumMatchedTerms: number;
}

export function createQueryPlan(query: string): QueryPlan {
	const normalizedTokens = extractNormalizedTokens(query);
	const significantTokens = tokenizeSearchText(query);
	const identityTokens = significantTokens.length > 0 ? significantTokens : normalizedTokens;
	const searchTerms = extractSearchTerms(query);
	const hasStrongToken = significantTokens.some((token) => token.length >= 3 || isNumericSearchTerm(token));
	const candidateTokens =
		significantTokens.length === 0
			? []
			: !hasStrongToken
				? significantTokens
				: significantTokens.filter(
						(token, index) => index === 0 || token.length >= 3 || isNumericSearchTerm(token),
					);

	return {
		rawQuery: query,
		normalizedQuery: normalizeSearchText(query),
		normalizedTokens,
		significantTokens,
		searchTerms,
		hasStrongToken,
		identityTokens,
		identityQuery: identityTokens.join(" "),
		candidateTokens,
		candidateQuery: candidateTokens.join(" "),
		contentTokens: candidateTokens,
		contentQuery: candidateTokens.join(" "),
		minimumMatchedTerms: searchTerms.length > 1 ? 2 : 1,
	};
}
