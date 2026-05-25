export interface SelectedSpaceFile {
	path: string;
	name: string;
}

interface PickerResultLike {
	path: string;
	name: string;
}

export function dedupePickerResults<T extends PickerResultLike>(results: T[]): T[] {
	const seenPaths = new Set<string>();
	return results.filter((result) => {
		if (seenPaths.has(result.path)) {
			return false;
		}
		seenPaths.add(result.path);
		return true;
	});
}

export function toSelectedSpaceFile(result: PickerResultLike): SelectedSpaceFile {
	return {
		path: result.path,
		name: result.name,
	};
}

export function removeSelectedSpaceFile(selected: SelectedSpaceFile[], path: string): SelectedSpaceFile[] {
	return selected.filter((entry) => entry.path !== path);
}

export function toggleSelectedSpaceFile(selected: SelectedSpaceFile[], result: PickerResultLike): SelectedSpaceFile[] {
	const selectedFile = toSelectedSpaceFile(result);
	return selected.some((entry) => entry.path === selectedFile.path)
		? removeSelectedSpaceFile(selected, selectedFile.path)
		: [...selected, selectedFile];
}

export function getAdjacentSelectablePath(
	paths: string[],
	currentPath: string | null,
	direction: 1 | -1,
): string | null {
	if (paths.length === 0) {
		return null;
	}

	if (currentPath === null) {
		return direction > 0 ? paths[0] : (paths.at(-1) ?? null);
	}

	const currentIndex = paths.indexOf(currentPath);
	if (currentIndex === -1) {
		return direction > 0 ? paths[0] : (paths.at(-1) ?? null);
	}

	const nextIndex = Math.min(paths.length - 1, Math.max(0, currentIndex + direction));
	return paths[nextIndex] ?? null;
}
