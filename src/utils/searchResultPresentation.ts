import type { SearchMatchBadge, SearchResult } from "../vectorstore/types";
import { extractSearchTerms } from "../search/searchTermUtils";
import { escapeHtml } from "./html";

export function getHighlightTerms(query: string): string[] {
	return extractSearchTerms(query);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function buildHighlightedHtml(
	text: string,
	terms: string[],
	highlightClass = "s2b-search-result-highlight",
): string {
	const escapedText = escapeHtml(text);
	if (!terms.length) {
		return escapedText;
	}

	const pattern = new RegExp(`(${terms.map((term) => escapeRegExp(term)).join("|")})`, "giu");
	let lastIndex = 0;
	let html = "";

	for (const match of text.matchAll(pattern)) {
		const start = match.index ?? 0;
		if (start > lastIndex) {
			html += escapeHtml(text.slice(lastIndex, start));
		}

		html += `<mark class="${highlightClass}">${escapeHtml(match[0])}</mark>`;
		lastIndex = start + match[0].length;
	}

	if (lastIndex < text.length) {
		html += escapeHtml(text.slice(lastIndex));
	}

	return html;
}

function escapeForPattern(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function stripHeadingPrefix(text: string, heading: string): string {
	const trimmed = text.trim();
	if (!trimmed) return trimmed;

	const patterns = [
		new RegExp(String.raw`^#+\s*${escapeForPattern(heading)}\s*`, "iu"),
		new RegExp(String.raw`^§\s*${escapeForPattern(heading)}\s*[—:-]?\s*`, "iu"),
		new RegExp(String.raw`^${escapeForPattern(heading)}\s*[—:-]?\s*`, "iu"),
	];

	for (const pattern of patterns) {
		const stripped = trimmed.replace(pattern, "").trim();
		if (stripped !== trimmed) {
			return stripped;
		}
	}

	return trimmed;
}

export function formatHeadingLabel(heading: string, level?: number): string {
	const normalizedLevel = Math.max(1, Math.min(level ?? 1, 6));
	return `${"#".repeat(normalizedLevel)} ${heading}`;
}

export function getBadgeLabel(badge: SearchMatchBadge): string {
	switch (badge) {
		case "title":
			return "Title";
		case "alias":
			return "Alias";
		case "tag":
			return "Tag";
		case "path":
			return "Path";
		case "heading":
			return "Heading";
		case "content":
			return "Content";
		case "semantic":
			return "Semantic";
		case "recent":
			return "Recent";
	}
}

export function getBadgeIconId(badge: SearchMatchBadge): string {
	switch (badge) {
		case "title":
			return "type";
		case "alias":
			return "forward";
		case "tag":
			return "tags";
		case "path":
			return "folder-tree";
		case "heading":
			return "heading";
		case "content":
			return "align-left";
		case "semantic":
			return "sparkles";
		case "recent":
			return "clock-3";
	}
}

function normalizeDisplayTags(tags: string[] | undefined): string[] {
	if (!tags?.length) {
		return [];
	}

	return Array.from(
		new Set(
			tags
				.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 1),
		),
	);
}

export function getFrontmatterDisplayTags(frontmatter: Record<string, unknown> | undefined): string[] {
	if (!frontmatter) {
		return [];
	}

	const rawTags = frontmatter.tags ?? frontmatter.tag;
	if (typeof rawTags === "string") {
		return normalizeDisplayTags(
			rawTags
				.split(",")
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0),
		);
	}

	if (Array.isArray(rawTags)) {
		return normalizeDisplayTags(rawTags.filter((tag): tag is string => typeof tag === "string"));
	}

	return [];
}

export function getDisplayTagLabel(tag: string): string {
	return tag.startsWith("#") ? tag.slice(1) : tag;
}

function getExplanationTag(matchExplanation: SearchResult["matchExplanation"]): string | undefined {
	if (matchExplanation?.source !== "tag") {
		return undefined;
	}

	const match = /^Tag:\s*(#\S+)/u.exec(matchExplanation.text);
	return match?.[1];
}

export function shouldShowMatchExplanation(
	matchExplanation: SearchResult["matchExplanation"],
	displayTags: string[],
): boolean {
	if (matchExplanation?.source === "title") {
		return false;
	}

	const explanationTag = getExplanationTag(matchExplanation);
	if (!explanationTag) {
		return true;
	}

	return !displayTags.includes(explanationTag);
}
