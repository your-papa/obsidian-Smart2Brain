import { normalizePath } from "obsidian";

/**
 * Normalize user-provided vault paths to Obsidian-style relative paths.
 */
export function normalizeVaultPath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) return "";
	const normalized = normalizePath(trimmed).replace(/^\.\//, "");
	return normalized === "." ? "" : normalized;
}

/**
 * Normalize a folder prefix and ensure trailing slash for boundary-safe matching.
 */
export function normalizeFolderPrefix(folderPath: string): string {
	const normalized = normalizeVaultPath(folderPath).replace(/^\/+/, "");
	if (!normalized) return "";
	return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

/**
 * True when filePath is inside folderPath with folder boundary safety.
 */
export function isPathInFolder(filePath: string, folderPath: string): boolean {
	const normalizedFile = normalizeVaultPath(filePath);
	const normalizedFolder = normalizeFolderPrefix(folderPath);
	if (!normalizedFolder) return true;
	return normalizedFile.startsWith(normalizedFolder);
}

/**
 * True when path matches a user prefix as either an exact path or folder prefix.
 */
export function matchesPathPrefix(path: string, prefix: string): boolean {
	const normalizedPath = normalizeVaultPath(path);
	const normalizedPrefix = normalizeVaultPath(prefix);
	if (!normalizedPrefix) return true;
	if (normalizedPath === normalizedPrefix) return true;
	return normalizedPath.startsWith(normalizeFolderPrefix(normalizedPrefix));
}
