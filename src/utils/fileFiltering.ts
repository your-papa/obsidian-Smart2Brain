function normalizePattern(pattern: string): string {
	return pattern.trim().replace(/^\/+|\/+$/g, "");
}

export function matchesPathPattern(filePath: string, pattern: string): boolean {
	const normalizedPattern = normalizePattern(pattern);
	if (!normalizedPattern) return false;

	if (normalizedPattern.startsWith("*.")) {
		return filePath.toLowerCase().endsWith(normalizedPattern.slice(1).toLowerCase());
	}

	return (
		filePath === normalizedPattern ||
		filePath.startsWith(`${normalizedPattern}/`) ||
		filePath.includes(`/${normalizedPattern}`)
	);
}

export function isInternallyExcludedPath(filePath: string, targetFolder: string): boolean {
	if (matchesPathPattern(filePath, targetFolder)) return true;
	return filePath.toLowerCase().endsWith(".excalidraw.md");
}

export function shouldProcessVaultPath(filePath: string, targetFolder: string): boolean {
	return !isInternallyExcludedPath(filePath, targetFolder);
}
