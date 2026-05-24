/**
 * Centralized space-scope resolution for agent tools.
 *
 * Provides both a `SearchFilter` (for search tools) and a path-membership
 * predicate (for read/write/list tools) derived from the active-space
 * runtime context set by AgentManager.
 */

import type { App } from "obsidian";
import type { Space } from "../../types/graph";
import type { SearchFilter } from "../../vectorstore/types";
import { resolveSpaceToSearchFilter, resolveSpacePaths } from "../../lib/views";
import { matchesPathPrefix } from "../../utils/pathUtils";
import { getCurrentSpaces } from "./runContext";

export interface SpaceScope {
    /** SearchFilter suitable for vector/lexical search tools. */
    searchFilter: SearchFilter | undefined;
    /** Returns true when the given vault-relative path is inside the active space. */
    isPathAllowed: (path: string) => boolean;
    /**
     * Returns true when a new file may be created/moved to this path.
     * For prefix-based spaces, identical to isPathAllowed.
     * For tag-based spaces, always returns true (the file doesn't exist yet
     * so it can't be in the resolved set, but it may acquire matching tags).
     */
    isWritePathAllowed: (path: string) => boolean;
    /** Human-readable label for error messages. */
    label: string;
}

/**
 * Resolve the current agent-run space context into a usable scope.
 *
 * When no spaces are active, returns an unrestricted scope (all paths allowed,
 * no search filter).
 */
export function resolveCurrentSpaceScope(app: App): SpaceScope {
    const spaces = getCurrentSpaces();
    if (!spaces || spaces.length === 0) {
        return {
            searchFilter: undefined,
            isPathAllowed: () => true,
            isWritePathAllowed: () => true,
            label: "entire vault",
        };
    }

    return resolveSpaceScope(app, spaces);
}

/**
 * Resolve an explicit set of spaces into a scope.
 */
export function resolveSpaceScope(app: App, spaces: Space[]): SpaceScope {
    const label = spaces.map((s) => s.label).join(", ");

    // Merge SearchFilters across all active spaces (union)
    let mergedPathPrefixes: string[] | undefined;
    let mergedTags: string[] | undefined;

    for (const space of spaces) {
        const filter = resolveSpaceToSearchFilter(app, space);
        if (filter.pathPrefixes) {
            mergedPathPrefixes = [...(mergedPathPrefixes ?? []), ...filter.pathPrefixes];
        }
        if (filter.tags) {
            mergedTags = [...(mergedTags ?? []), ...filter.tags];
        }
    }

    const searchFilter: SearchFilter | undefined =
        mergedPathPrefixes || mergedTags ? { pathPrefixes: mergedPathPrefixes, tags: mergedTags } : undefined;

    // Build concrete path set for membership checks (union of all spaces)
    const allowedPaths = new Set<string>();
    for (const space of spaces) {
        for (const p of resolveSpacePaths(app, space)) {
            allowedPaths.add(p);
        }
    }

    // If the search filter only has pathPrefixes (common case), we can use
    // a fast prefix check instead of the full resolved path set.
    const prefixOnly = mergedPathPrefixes && !mergedTags;
    const prefixes = mergedPathPrefixes;

    const isPathAllowed = (path: string): boolean => {
        // Fast path: prefix-only spaces (folder-based filters)
        if (prefixOnly && prefixes) {
            return prefixes.some((prefix) => matchesPathPrefix(path, prefix));
        }

        // Resolved path set (tag/complex filters)
        return allowedPaths.has(path);
    };

    const isWritePathAllowed = (path: string): boolean => {
        // For prefix-based spaces, same as isPathAllowed — file must be under
        // a known folder prefix.
        if (prefixOnly && prefixes) {
            return prefixes.some((prefix) => matchesPathPrefix(path, prefix));
        }

        // For tag-based or mixed spaces, we cannot determine membership of a
        // file that doesn't exist yet (tags are metadata on the file). Allow
        // the write and rely on the user/agent to add appropriate tags.
        return true;
    };

    return { searchFilter, isPathAllowed, isWritePathAllowed, label };
}
