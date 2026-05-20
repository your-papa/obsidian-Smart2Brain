import type { SearchResult } from "../../vectorstore/types";

export interface SelectedSpaceFile {
    path: string;
    name: string;
}

export function dedupePickerResults(entries: SearchResult[]): SearchResult[] {
    const deduped = new Map<string, SearchResult>();
    for (const entry of entries) {
        if (!deduped.has(entry.path)) {
            deduped.set(entry.path, entry);
        }
    }
    return Array.from(deduped.values());
}

export function toSelectedSpaceFile(result: Pick<SearchResult, "path" | "name">): SelectedSpaceFile {
    return {
        path: result.path,
        name: result.name,
    };
}

export function toggleSelectedSpaceFile(
    selected: SelectedSpaceFile[],
    result: Pick<SearchResult, "path" | "name">,
): SelectedSpaceFile[] {
    if (selected.some((entry) => entry.path === result.path)) {
        return selected.filter((entry) => entry.path !== result.path);
    }
    return [...selected, toSelectedSpaceFile(result)];
}

export function removeSelectedSpaceFile(selected: SelectedSpaceFile[], path: string): SelectedSpaceFile[] {
    return selected.filter((entry) => entry.path !== path);
}

export function getAdjacentSelectablePath(
    paths: string[],
    currentPath: string | null,
    direction: -1 | 1,
): string | null {
    if (paths.length === 0) return null;
    if (!currentPath) {
        return direction === 1 ? paths[0] : paths[paths.length - 1];
    }

    const currentIndex = paths.indexOf(currentPath);
    if (currentIndex === -1) {
        return direction === 1 ? paths[0] : paths[paths.length - 1];
    }

    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), paths.length - 1);
    return paths[nextIndex] ?? null;
}
