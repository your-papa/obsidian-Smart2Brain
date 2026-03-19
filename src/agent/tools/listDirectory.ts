import { tool } from "@langchain/core/tools";
import type { App } from "obsidian";
import { z } from "zod";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { isPathInFolder, normalizeFolderPrefix, normalizeVaultPath } from "../../utils/pathUtils";

interface DirectoryFileEntry {
	name: string;
	path: string;
	extension: string;
	size: number;
}

interface DirectoryListResult {
	root: string;
	recursive: boolean;
	maxDepth: number;
	folders: string[];
	files: DirectoryFileEntry[];
	totalFolders: number;
	totalFiles: number;
	skippedPrivateFiles: number;
}

const listDirectorySchema = z.object({
	path: z.string().optional().describe("Optional vault-relative folder path. Omit to list from vault root."),
	recursive: z.boolean().optional().describe("Whether to recursively include nested directories. Default: false."),
	maxDepth: z.number().int().min(1).max(8).optional().describe("Maximum depth when recursive is true. Default: 3."),
	includeFiles: z.boolean().optional().describe("Include files in the output. Default: true."),
	includeFolders: z.boolean().optional().describe("Include folders in the output. Default: true."),
});

type ListDirectoryInput = z.infer<typeof listDirectorySchema>;

function getListDirectoryToolConfig(): { name: string; description: string } {
	const selectedConfig = getData().getSelectedAgent().toolsConfig.list_directory;
	const defaultConfig = DEFAULT_TOOLS_CONFIG.list_directory;

	return {
		name: selectedConfig?.name ?? defaultConfig.name,
		description: selectedConfig?.description ?? defaultConfig.description,
	};
}

function getRelativePath(root: string, filePath: string): string {
	if (!root) return normalizeVaultPath(filePath);
	const normalizedRoot = normalizeFolderPrefix(root);
	return normalizeVaultPath(filePath).slice(normalizedRoot.length);
}

function collectFoldersForFile(relativePath: string, recursive: boolean, maxDepth: number): string[] {
	const segments = relativePath.split("/");
	if (segments.length <= 1) return [];

	const maxFolderDepth = recursive ? Math.min(maxDepth, segments.length - 1) : 1;
	const folders: string[] = [];
	for (let depth = 1; depth <= maxFolderDepth; depth++) {
		folders.push(segments.slice(0, depth).join("/"));
	}
	return folders;
}

export function createListDirectoryTool(app: App) {
	const toolConfig = getListDirectoryToolConfig();

	return tool(
		async ({
			path,
			recursive = false,
			maxDepth = 3,
			includeFiles = true,
			includeFolders = true,
		}: ListDirectoryInput) => {
			const rootPath = normalizeVaultPath(path ?? "");
			const requestedPath = rootPath || "/";
			const rootEntity = rootPath ? app.vault.getAbstractFileByPath(rootPath) : null;

			if (rootEntity && "extension" in rootEntity) {
				return `Error: \"${requestedPath}\" is a file, not a folder. Use read_content for file contents.`;
			}

			const store = getPendingChangesStore();
			const currentProvider = getData().getSelectedAgent().chatModel?.provider;
			const folderSet = new Set<string>();
			const fileEntries: DirectoryFileEntry[] = [];
			let skippedPrivateFiles = 0;

			for (const file of app.vault.getFiles()) {
				if (!isPathInFolder(file.path, rootPath)) continue;
				if (!store.isPathAllowed(file.path)) continue;
				if (currentProvider && store.shouldBlockFile(file.path, currentProvider)) {
					skippedPrivateFiles++;
					continue;
				}

				const relativePath = getRelativePath(rootPath, file.path);
				const relativeSegments = relativePath.split("/");
				const fileDepth = relativeSegments.length;

				if (!recursive && fileDepth > 1) {
					if (includeFolders) folderSet.add(relativeSegments[0]);
					continue;
				}

				if (recursive && fileDepth > maxDepth + 1) {
					if (includeFolders) {
						for (const folder of collectFoldersForFile(relativePath, true, maxDepth)) {
							folderSet.add(folder);
						}
					}
					continue;
				}

				if (includeFolders) {
					for (const folder of collectFoldersForFile(relativePath, recursive, maxDepth)) {
						folderSet.add(folder);
					}
				}

				if (includeFiles) {
					fileEntries.push({
						name: file.name,
						path: rootPath ? relativePath : normalizeVaultPath(file.path),
						extension: file.extension,
						size: file.stat.size,
					});
				}
			}

			const result: DirectoryListResult = {
				root: requestedPath,
				recursive,
				maxDepth,
				folders: includeFolders ? Array.from(folderSet).sort((a, b) => a.localeCompare(b)) : [],
				files: includeFiles ? fileEntries.sort((a, b) => a.path.localeCompare(b.path)) : [],
				totalFolders: includeFolders ? folderSet.size : 0,
				totalFiles: includeFiles ? fileEntries.length : 0,
				skippedPrivateFiles,
			};

			return JSON.stringify(result, null, 2);
		},
		{
			name: toolConfig.name,
			description: toolConfig.description,
			schema: listDirectorySchema,
		},
	);
}
