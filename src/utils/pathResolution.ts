import { type App, TFile } from "obsidian";

export type ResolveVaultFileResult =
	| { status: "found"; file: TFile }
	| { status: "not_found" }
	| { status: "ambiguous"; candidates: string[] };

export interface ReferenceInfo {
	path: string;
	subpath: string;
}

/**
 * Parse file references from plain paths or wiki links.
 * Supports aliases and subpath fragments like #heading or #page=3.
 */
export function extractReferenceInfo(input: string): ReferenceInfo {
	const trimmed = input.trim();
	let inner = trimmed;

	if (trimmed.startsWith("![[") && trimmed.endsWith("]]")) {
		inner = trimmed.slice(3, -2).trim();
	} else if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
		inner = trimmed.slice(2, -2).trim();
	}

	const withoutAlias = inner.split("|")[0]?.trim() ?? "";
	const hashIndex = withoutAlias.indexOf("#");
	if (hashIndex === -1) {
		return { path: withoutAlias, subpath: "" };
	}

	return {
		path: withoutAlias.slice(0, hashIndex).trim(),
		subpath: withoutAlias.slice(hashIndex),
	};
}

/**
 * Strip wiki-link wrappers and fragments to a normalized reference path.
 */
export function normalizeReferencePath(input: string): string {
	return extractReferenceInfo(input).path;
}

/**
 * Generic resolver for any vault file reference.
 * Exact path first, then basename fallback by extension rules.
 */
export function resolveVaultFileDetailed(app: App, path: string): ResolveVaultFileResult {
	const cleanPath = path.trim();
	if (!cleanPath) return { status: "not_found" };

	const file = app.vault.getAbstractFileByPath(cleanPath);
	if (file instanceof TFile) return { status: "found", file };

	const basename = cleanPath.split("/").pop() ?? cleanPath;
	const hasExtension = basename.includes(".");
	const allFiles = app.vault.getFiles();

	if (hasExtension) {
		const exactNameMatches = allFiles.filter((f) => f.name === basename);
		if (exactNameMatches.length === 1) return { status: "found", file: exactNameMatches[0] };
		if (exactNameMatches.length > 1) {
			return {
				status: "ambiguous",
				candidates: exactNameMatches.map((f) => f.path),
			};
		}
		return { status: "not_found" };
	}

	const basenameMatches = allFiles.filter((f) => f.basename === basename);
	if (basenameMatches.length === 1) return { status: "found", file: basenameMatches[0] };
	if (basenameMatches.length > 1) {
		return {
			status: "ambiguous",
			candidates: basenameMatches.map((f) => f.path),
		};
	}

	return { status: "not_found" };
}

/**
 * Markdown-focused resolver with linkpathDest fallback and basename matching only across markdown files.
 */
export function resolveMarkdownFileDetailed(app: App, pathOrReference: string): ResolveVaultFileResult {
	const linkPath = normalizeReferencePath(pathOrReference);
	if (!linkPath) return { status: "not_found" };

	const exact = app.vault.getAbstractFileByPath(linkPath);
	if (exact instanceof TFile && exact.extension.toLowerCase() === "md") {
		return { status: "found", file: exact };
	}

	if (!linkPath.endsWith(".md")) {
		const withMd = app.vault.getAbstractFileByPath(`${linkPath}.md`);
		if (withMd instanceof TFile && withMd.extension.toLowerCase() === "md") {
			return { status: "found", file: withMd };
		}
	}

	const byLinkPath =
		app.metadataCache.getFirstLinkpathDest?.(linkPath, "") ??
		(linkPath.endsWith(".md")
			? app.metadataCache.getFirstLinkpathDest?.(linkPath.slice(0, -3), "")
			: app.metadataCache.getFirstLinkpathDest?.(`${linkPath}.md`, ""));

	if (byLinkPath instanceof TFile && byLinkPath.extension.toLowerCase() === "md") {
		return { status: "found", file: byLinkPath };
	}

	const normalizedTarget = linkPath.toLowerCase();
	const markdownFiles = app.vault.getMarkdownFiles();
	const basenameMatches = markdownFiles.filter((f) => f.basename.toLowerCase() === normalizedTarget);

	if (basenameMatches.length === 1) return { status: "found", file: basenameMatches[0] };
	if (basenameMatches.length > 1) {
		return {
			status: "ambiguous",
			candidates: basenameMatches.map((f) => f.path),
		};
	}

	return { status: "not_found" };
}

/**
 * Resolve file references with markdown-first behavior for markdown-like inputs.
 */
export function resolveFileReferenceDetailed(app: App, rawReference: string): ResolveVaultFileResult {
	const linkPath = normalizeReferencePath(rawReference);
	if (!linkPath) return { status: "not_found" };

	const normalizedPath = linkPath.toLowerCase();
	const isExcalidrawLink = normalizedPath.endsWith(".excalidraw");
	const isMarkdownLike = !linkPath.includes(".") || normalizedPath.endsWith(".md") || isExcalidrawLink;

	if (isMarkdownLike) {
		const markdown = resolveMarkdownFileDetailed(app, linkPath);
		if (markdown.status !== "not_found") return markdown;
	}

	return resolveVaultFileDetailed(app, linkPath);
}
