import { tool } from "@langchain/core/tools";
import type { App } from "obsidian";
import { z } from "zod";
import { DEFAULT_TOOLS_CONFIG, getData } from "../../stores/dataStore.svelte";
import { getPendingChangesStore } from "../../stores/pendingChangesStore.svelte";
import { isPathInFolder, normalizeFolderPrefix, normalizeVaultPath } from "../../utils/pathUtils";

interface DirectoryTreeFileEntry {
	name: string;
	extension: string;
	size: number;
}

interface DirectoryTreeNode {
	folders?: Record<string, DirectoryTreeNode>;
	files?: DirectoryTreeFileEntry[];
}

interface MutableDirectoryTreeNode {
	folders: Record<string, MutableDirectoryTreeNode>;
	files: DirectoryTreeFileEntry[];
}

interface DirectoryListResult {
	root: string;
	recursive: boolean;
	maxDepth: number;
	tree: DirectoryTreeNode;
	totalFolders: number;
	totalFiles: number;
	skippedPrivateFiles: number;
}

interface DirectoryScanOptions {
	rootPath: string;
	recursive: boolean;
	maxDepth: number;
	includeFiles: boolean;
	includeFolders: boolean;
	currentProvider?: string;
	store: ReturnType<typeof getPendingChangesStore>;
}

interface DirectoryScanResult {
	folderSet: Set<string>;
	fileEntries: Array<DirectoryTreeFileEntry & { path: string }>;
	skippedPrivateFiles: number;
}

const listDirectorySchema = z.object({
	path: z.string().optional().describe("Optional vault-relative folder path. Omit to list from vault root."),
	recursive: z
		.boolean()
		.optional()
		.describe(
			"Whether to recursively include nested directories. Defaults to true when maxDepth is provided, otherwise false.",
		),
	maxDepth: z
		.number()
		.int()
		.min(1)
		.max(8)
		.optional()
		.describe(
			"Maximum recursive depth. Providing maxDepth enables recursive listing automatically. Default depth: 3.",
		),
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

function buildDirectoryTree(
	folders: string[],
	files: Array<DirectoryTreeFileEntry & { path: string }>,
): DirectoryTreeNode {
	const treeRoot: MutableDirectoryTreeNode = {
		folders: {},
		files: [],
	};

	const nodeByPath = new Map<string, MutableDirectoryTreeNode>();
	nodeByPath.set("", treeRoot);

	const ensureFolderNode = (folderPath: string): MutableDirectoryTreeNode => {
		if (!folderPath) return treeRoot;

		const existingNode = nodeByPath.get(folderPath);
		if (existingNode) return existingNode;

		const segments = folderPath.split("/").filter(Boolean);
		let currentPath = "";
		let parentNode = treeRoot;

		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			let currentNode = nodeByPath.get(currentPath);

			if (!currentNode) {
				currentNode = {
					folders: {},
					files: [],
				};
				nodeByPath.set(currentPath, currentNode);
				parentNode.folders[segment] = currentNode;
			}

			parentNode = currentNode;
		}

		return parentNode;
	};

	for (const folder of folders) {
		ensureFolderNode(folder);
	}

	for (const file of files) {
		const slashIndex = file.path.lastIndexOf("/");
		const parentPath = slashIndex >= 0 ? file.path.slice(0, slashIndex) : "";
		ensureFolderNode(parentPath).files.push({
			name: file.name,
			extension: file.extension,
			size: file.size,
		});
	}

	const sortNode = (node: MutableDirectoryTreeNode): void => {
		const sortedFolders = Object.entries(node.folders).toSorted(([left], [right]) => left.localeCompare(right));
		node.folders = Object.fromEntries(sortedFolders);
		node.files.sort((a, b) => a.name.localeCompare(b.name));
		for (const child of Object.values(node.folders)) sortNode(child);
	};

	const finalizeNode = (node: MutableDirectoryTreeNode): DirectoryTreeNode => {
		const finalizedFolders = Object.entries(node.folders).reduce<Record<string, DirectoryTreeNode>>(
			(acc, [name, child]) => {
				acc[name] = finalizeNode(child);
				return acc;
			},
			{},
		);

		const finalizedNode: DirectoryTreeNode = {};
		if (Object.keys(finalizedFolders).length > 0) finalizedNode.folders = finalizedFolders;
		if (node.files.length > 0) finalizedNode.files = node.files;
		return finalizedNode;
	};

	sortNode(treeRoot);
	return finalizeNode(treeRoot);
}

function isDirectoryFileVisible(
	filePath: string,
	rootPath: string,
	store: DirectoryScanOptions["store"],
	currentProvider?: string,
): "include" | "skip" | "private" {
	if (!isPathInFolder(filePath, rootPath)) return "skip";
	if (!store.isPathAllowed(filePath)) return "skip";
	if (currentProvider && store.shouldBlockFile(filePath, currentProvider)) return "private";
	return "include";
}

function addDirectoryFolders(folderSet: Set<string>, relativePath: string, recursive: boolean, maxDepth: number): void {
	for (const folder of collectFoldersForFile(relativePath, recursive, maxDepth)) {
		folderSet.add(folder);
	}
}

function addVisibleDirectoryEntry(
	file: { path: string; name: string; extension: string; stat: { size: number } },
	result: DirectoryScanResult,
	options: DirectoryScanOptions,
): void {
	const relativePath = getRelativePath(options.rootPath, file.path);
	const relativeSegments = relativePath.split("/");
	const fileDepth = relativeSegments.length;

	if (!options.recursive && fileDepth > 1) {
		if (options.includeFolders) result.folderSet.add(relativeSegments[0]);
		return;
	}

	if (options.recursive && fileDepth > options.maxDepth + 1) {
		if (options.includeFolders) addDirectoryFolders(result.folderSet, relativePath, true, options.maxDepth);
		return;
	}

	if (options.includeFolders)
		addDirectoryFolders(result.folderSet, relativePath, options.recursive, options.maxDepth);

	if (!options.includeFiles) return;

	result.fileEntries.push({
		name: file.name,
		path: options.rootPath ? relativePath : normalizeVaultPath(file.path),
		extension: file.extension,
		size: file.stat.size,
	});
}

function collectDirectoryEntries(app: App, options: DirectoryScanOptions): DirectoryScanResult {
	const result: DirectoryScanResult = {
		folderSet: new Set<string>(),
		fileEntries: [],
		skippedPrivateFiles: 0,
	};

	for (const file of app.vault.getFiles()) {
		const visibility = isDirectoryFileVisible(file.path, options.rootPath, options.store, options.currentProvider);
		if (visibility === "skip") continue;
		if (visibility === "private") {
			result.skippedPrivateFiles++;
			continue;
		}

		addVisibleDirectoryEntry(file, result, options);
	}

	return result;
}

function buildDirectoryListResult(
	requestedPath: string,
	options: Omit<DirectoryScanOptions, "store" | "currentProvider">,
	scanResult: DirectoryScanResult,
): DirectoryListResult {
	const sortedFolders = options.includeFolders
		? Array.from(scanResult.folderSet).toSorted((a, b) => a.localeCompare(b))
		: [];
	const sortedFiles = options.includeFiles
		? scanResult.fileEntries.toSorted((a, b) => a.path.localeCompare(b.path))
		: [];

	return {
		root: requestedPath,
		recursive: options.recursive,
		maxDepth: options.maxDepth,
		tree: buildDirectoryTree(sortedFolders, sortedFiles),
		totalFolders: options.includeFolders ? scanResult.folderSet.size : 0,
		totalFiles: options.includeFiles ? scanResult.fileEntries.length : 0,
		skippedPrivateFiles: scanResult.skippedPrivateFiles,
	};
}

export function createListDirectoryTool(app: App) {
	const toolConfig = getListDirectoryToolConfig();

	return tool(
		async ({ path, recursive, maxDepth, includeFiles = true, includeFolders = true }: ListDirectoryInput) => {
			const effectiveRecursive = recursive ?? maxDepth !== undefined;
			const effectiveMaxDepth = maxDepth ?? 3;
			const rootPath = normalizeVaultPath(path ?? "");
			const requestedPath = rootPath || "/";
			const rootEntity = rootPath ? app.vault.getAbstractFileByPath(rootPath) : null;

			if (rootEntity && "extension" in rootEntity) {
				return `Error: "${requestedPath}" is a file, not a folder. Use read_content for file contents.`;
			}

			const store = getPendingChangesStore();
			const currentProvider = getData().getSelectedAgent().chatModel?.provider;
			const scanOptions: DirectoryScanOptions = {
				rootPath,
				recursive: effectiveRecursive,
				maxDepth: effectiveMaxDepth,
				includeFiles,
				includeFolders,
				currentProvider,
				store,
			};
			const scanResult = collectDirectoryEntries(app, scanOptions);
			const result = buildDirectoryListResult(
				requestedPath,
				{
					rootPath,
					recursive: effectiveRecursive,
					maxDepth: effectiveMaxDepth,
					includeFiles,
					includeFolders,
				},
				scanResult,
			);

			return JSON.stringify(result);
		},
		{
			name: toolConfig.name,
			description: toolConfig.description,
			schema: listDirectorySchema,
		},
	);
}
