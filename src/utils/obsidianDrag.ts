function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function parseObsidianFilesPayload(payload: string): string[] {
	try {
		const parsed: unknown = JSON.parse(payload);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((path): path is string => isNonEmptyString(path));
	} catch {
		return [];
	}
}

export function hasObsidianFileDrag(dataTransfer?: Pick<DataTransfer, "types"> | null): boolean {
	if (!dataTransfer) {
		return false;
	}

	const types = Array.from(dataTransfer.types ?? []);
	return types.includes("obsidian/file") || types.includes("obsidian/files");
}

export function extractObsidianDraggedPaths(dataTransfer?: Pick<DataTransfer, "getData"> | null): string[] {
	if (!dataTransfer) {
		return [];
	}

	const paths: string[] = [];
	const multiPayload = dataTransfer.getData("obsidian/files");
	if (isNonEmptyString(multiPayload)) {
		paths.push(...parseObsidianFilesPayload(multiPayload));
	}

	const singlePayload = dataTransfer.getData("obsidian/file");
	if (isNonEmptyString(singlePayload)) {
		paths.push(singlePayload);
	}

	return [...new Set(paths)];
}
