import { tool } from "@langchain/core/tools";
import { htmlToMarkdown } from "obsidian";
import { z } from "zod";
import { createObsidianFetch } from "../../lib/obsidianFetch";
import { getData } from "../../stores/dataStore.svelte";
import { Logger } from "../../utils/logging";

const DEFAULT_MAX_CONTENT_LENGTH = 50_000;
const FETCH_TIMEOUT_MS = 20_000;
/** Hard ceiling on raw response size we will read (binary or text), independent of the post-strip cap. */
const MAX_RAW_BYTES = 4 * 1024 * 1024;

/** Tags whose contents are pure noise once converted to markdown. */
const NOISE_TAG_PATTERN = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** Self-closing or empty noise tags (rare but possible: `<style />`). */
const SELF_CLOSING_NOISE_PATTERN = /<(script|style|noscript|svg|template|iframe)\b[^>]*\/>/gi;
/** HTML comments. */
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
/** Layout chrome that htmlToMarkdown otherwise preserves verbatim. */
const CHROME_TAG_PATTERN = /<(nav|footer|aside|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi;

function isHtmlContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const lower = contentType.toLowerCase();
	return lower.includes("text/html") || lower.includes("application/xhtml");
}

function isTextualContentType(contentType: string | null): boolean {
	if (!contentType) return true; // be lenient — many servers omit it
	const lower = contentType.toLowerCase();
	return (
		lower.startsWith("text/") ||
		lower.includes("json") ||
		lower.includes("xml") ||
		lower.includes("javascript") ||
		lower.includes("yaml")
	);
}

/**
 * Strip script/style/nav/footer/aside/header/form/comments from raw HTML before
 * handing it to Obsidian's htmlToMarkdown. We do this with regex rather than
 * DOMParser because htmlToMarkdown will re-parse the cleaned string itself.
 */
function preStripHtml(html: string): string {
	return html
		.replace(COMMENT_PATTERN, "")
		.replace(NOISE_TAG_PATTERN, "")
		.replace(SELF_CLOSING_NOISE_PATTERN, "")
		.replace(CHROME_TAG_PATTERN, "");
}

/**
 * Collapse runs of 3+ blank lines that htmlToMarkdown sometimes produces from
 * stripped chrome, without touching code blocks (no fenced-block awareness here
 * is fine — htmlToMarkdown emits 4-space-indented code, not fences).
 */
function tidyMarkdown(md: string): string {
	return md.replace(/\n{3,}/g, "\n\n").trim();
}

function truncate(content: string, maxChars: number): string {
	if (maxChars <= 0 || content.length <= maxChars) return content;
	return `${content.slice(0, maxChars)}\n\n[...truncated ${content.length - maxChars} characters to fit context limits...]`;
}

interface FetchUrlSettings {
	maxContentLength?: number;
}

/**
 * Tool for fetching a URL and returning a cleaned markdown view of its content.
 * Uses Obsidian's htmlToMarkdown after stripping boilerplate so layout (headings,
 * lists, tables, links) is preserved while scripts/styles/nav chrome are removed.
 *
 * Routes through createObsidianFetch so CORS-restricted hosts fall back to
 * Obsidian's requestUrl, mirroring how the rest of the plugin reaches the network.
 */
export function createFetchUrlTool() {
	const pluginData = getData();
	const getToolConfig = () => pluginData.getSelectedAgent().toolsConfig.fetch_url;
	const fetchImpl = createObsidianFetch(globalThis.fetch);

	const fetchUrlFn = async ({ url }: { url: string }): Promise<string> => {
		const trimmed = url?.trim();
		if (!trimmed) return "Error: URL is empty.";

		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return `Error: "${url}" is not a valid URL. Include the scheme (https://...).`;
		}

		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return `Error: Unsupported protocol "${parsed.protocol}". Only http(s) URLs are allowed.`;
		}

		const settings = getToolConfig()?.settings as FetchUrlSettings | undefined;
		const maxContentLength = settings?.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		try {
			Logger.log(`[fetch_url] Fetching ${parsed.href}`);
			const response = await fetchImpl(parsed.href, {
				method: "GET",
				headers: {
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
					"Accept-Language": "en-US,en;q=0.9",
				},
				signal: controller.signal,
				redirect: "follow",
			});

			if (!response.ok) {
				return `Error: HTTP ${response.status} ${response.statusText} fetching "${parsed.href}".`;
			}

			const contentType = response.headers.get("content-type");
			if (!isTextualContentType(contentType)) {
				return `Error: "${parsed.href}" returned non-textual content (${contentType ?? "unknown content type"}). This tool only handles text-based responses.`;
			}

			// Bound the read so a misbehaving server can't fill memory.
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength > MAX_RAW_BYTES) {
				return `Error: Response body for "${parsed.href}" exceeds ${MAX_RAW_BYTES} bytes (got ${buffer.byteLength}). Refusing to load.`;
			}
			const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

			let body: string;
			let format: "markdown" | "text";
			if (isHtmlContentType(contentType) || /<\s*html[\s>]/i.test(raw.slice(0, 2048))) {
				const cleaned = preStripHtml(raw);
				body = tidyMarkdown(htmlToMarkdown(cleaned));
				format = "markdown";
			} else {
				body = raw.trim();
				format = "text";
			}

			if (!body) {
				return `Fetched "${parsed.href}" but the response had no readable content after cleaning.`;
			}

			const output = truncate(body, maxContentLength);
			const header = `Content of "${parsed.href}" (${format}, ${output.length} chars):`;
			return `${header}\n\n${output}`;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return `Error: Request to "${parsed.href}" timed out after ${FETCH_TIMEOUT_MS}ms.`;
			}
			const message = error instanceof Error ? error.message : String(error);
			Logger.error(`[fetch_url] Failed to fetch ${parsed.href}`, error);
			return `Error fetching "${parsed.href}": ${message}`;
		} finally {
			clearTimeout(timeout);
		}
	};

	const toolConfig = getToolConfig();

	return tool(fetchUrlFn, {
		name: toolConfig?.name ?? "fetch_url",
		description:
			toolConfig?.description ??
			"Fetch a public web page or text resource over HTTP(S) and return its main content. HTML is converted to markdown with scripts, styles, and navigation chrome removed while headings, lists, tables, code blocks, and links are preserved. JSON, plain text, and other text-based responses are returned as-is. Use this when the user asks about a specific URL or when external information is needed that the vault does not contain.",
		schema: z.object({
			url: z
				.string()
				.describe(
					"Absolute http(s) URL to fetch (e.g., 'https://example.com/article'). Relative paths and other schemes are rejected.",
				),
		}),
	});
}
