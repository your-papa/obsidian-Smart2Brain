/**
 * Shared search filter utilities.
 *
 * Provides a single `matchesSearchFilter` function used by recent-note
 * filtering, lexical browse/search, and any other path where documents
 * need to be tested against a `SearchFilter`.
 */

import { matchesPathPrefix } from "../utils/pathUtils";
import type { SearchFilter } from "../vectorstore/types";

// ---------------------------------------------------------------------------
// Core filter predicate
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a document at `path` with `docTags` satisfies every
 * constraint in `filter`.
 *
 * • Path prefixes are combined with OR (match any).
 * • Tags default to OR (match any) unless `filter.requireAllTags` is true.
 */
export function matchesSearchFilter(path: string, docTags: string[], filter?: SearchFilter): boolean {
	if (!filter) {
		return true;
	}

	if (filter.pathPrefixes?.length) {
		const matchesPath = filter.pathPrefixes.some((prefix) => matchesPathPrefix(path, prefix));
		if (!matchesPath) {
			return false;
		}
	}

	if (filter.tags?.length) {
		const normalizedFilterTags = filter.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
		const normalizedDocTags = docTags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
		const matchesTag = (filterTag: string) =>
			normalizedDocTags.some((docTag) => docTag === filterTag || docTag.startsWith(`${filterTag}/`));

		if (filter.requireAllTags) {
			return normalizedFilterTags.every(matchesTag);
		}

		return normalizedFilterTags.some(matchesTag);
	}

	return true;
}
