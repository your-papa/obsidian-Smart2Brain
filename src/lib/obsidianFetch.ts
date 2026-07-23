import { requestUrl, type RequestUrlParam } from "obsidian";
import { Logger } from "../utils/logging";

/**
 * Creates a custom fetch implementation that uses Obsidian's requestUrl
 * to bypass CORS restrictions in the plugin environment.
 *
 * Strategy:
 * 1. Always try native fetch first - this supports streaming which is needed for LLM APIs
 * 2. Fall back to Obsidian's requestUrl if native fetch fails (CORS errors, etc.)
 *
 * Note: LLM APIs (OpenAI, Anthropic, etc.) have proper CORS headers and work with native fetch.
 * MCP servers may not have CORS headers, so they fall back to requestUrl.
 */
export function createObsidianFetch(
	originalFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = input.toString();

		const toPlainArrayBuffer = (view: ArrayBufferView): ArrayBuffer => {
			const copy = new Uint8Array(view.byteLength);
			copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
			return copy.buffer;
		};

		// Try using the original fetch first to support streaming
		// LLM APIs have proper CORS headers and need native fetch for streaming
		if (originalFetch) {
			try {
				// We clone the init object to avoid side effects if fetch modifies it,
				// though usually it doesn't.
				// NOTE: If body is a ReadableStream and it gets locked/consumed by originalFetch,
				// fallback to requestUrl might fail. But usually for LLM calls body is a string (JSON).
				return await originalFetch(input, init);
			} catch (e) {
				// If original fetch fails (likely CORS or network), fallback to requestUrl
				// This handles MCP servers that don't have CORS headers
			}
		}

		const method = init?.method || "GET";
		const headers = (init?.headers as Record<string, string>) || {};
		const body = init?.body;

		// Convert Headers object to record if needed
		if (init?.headers instanceof Headers) {
			init.headers.forEach((value, key) => {
				headers[key] = value;
			});
		}

		// If the body is a byte array (Uint8Array), requestUrl expects it as an ArrayBuffer
		// However, for multipart/form-data or gzipped content, we might need special handling

		let requestBody: RequestUrlParam["body"] = typeof body === "string" ? body : undefined;
		// Check if body exists and is NOT a string (so it's likely binary)
		if (init?.body && typeof init.body !== "string") {
			// Handle Uint8Array specifically (common in node/browser buffers)
			if (init.body instanceof Uint8Array) {
				requestBody = toPlainArrayBuffer(init.body);
			}
			// Handle generic ArrayBufferView
			else if (ArrayBuffer.isView(init.body)) {
				requestBody = toPlainArrayBuffer(init.body);
			}
			// Handle raw ArrayBuffer
			else if (init.body instanceof ArrayBuffer) {
				requestBody = init.body;
			}
			// Handle Blob
			else if (init.body instanceof Blob) {
				requestBody = await init.body.arrayBuffer();
			}
			// Handle ReadableStream
			else if (init.body instanceof ReadableStream) {
				// We need to read the stream into an ArrayBuffer
				const reader = init.body.getReader();
				const chunks: Uint8Array[] = [];
				let totalLength = 0;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!(value instanceof Uint8Array)) continue;
					chunks.push(value);
					totalLength += value.length;
				}

				// Merge chunks into a single Uint8Array
				const result = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					result.set(chunk, offset);
					offset += chunk.length;
				}

				requestBody = result.buffer;
			}
		}

		// CRITICAL: requestUrl in Obsidian often tries to set Content-Type automatically
		// If we are sending binary data (like gzip), we must ensure we don't double-encode or mess up headers.

		// LangSmith/LangChain sends 'Content-Encoding: gzip' header.
		// Ensure we are passing the raw buffer.

		const requestParams: RequestUrlParam = {
			url,
			method,
			headers,
			body: requestBody,
			throw: false, // Don't throw on 4xx/5xx to match fetch behavior
		};

		try {
			const response = await requestUrl(requestParams);

			const responseHeaders: Record<string, string> = {
				...(response.headers as Record<string, string>),
			};

			// Obsidian's requestUrl may strip the content-type header from responses.
			// The OpenAI SDK requires it to parse JSON responses correctly.
			if (!responseHeaders["content-type"] && !responseHeaders["Content-Type"]) {
				responseHeaders["content-type"] = "application/json";
			}

			// Convert Obsidian response to standard Response object
			return new Response(response.text, {
				status: response.status,
				headers: responseHeaders,
			});
		} catch (error) {
			Logger.error("Obsidian fetch proxy error:", error);
			throw error;
		}
	};
}

/**
 * Ref-counted installer for the global `fetch` patch used by MCP clients (which
 * read `globalThis.fetch` at call time and can't be handed a fetch directly).
 *
 * Multiple callers may need the patch concurrently (e.g. two `fetchServerTools`
 * calls, or agent MCP tool-loading overlapping a settings-modal probe). The
 * naive `_originalFetch`-flag + `finally`-restore pattern corrupts under
 * concurrency: one caller's restore fires mid-flight of another, or the
 * original gets captured as an already-wrapped fetch and double-wrapped
 * permanently. Ref-counting installs once (on 0→1) and restores once (on 1→0),
 * so concurrent users are safe. `release()` is idempotent.
 */
let patchDepth = 0;
let savedFetch: typeof globalThis.fetch | null = null;

export function installObsidianFetch(): { release: () => void } {
	if (patchDepth === 0) {
		savedFetch = globalThis.fetch;
		globalThis.fetch = createObsidianFetch(savedFetch);
	}
	patchDepth++;

	let released = false;
	return {
		release: () => {
			if (released) return;
			released = true;
			patchDepth--;
			if (patchDepth === 0 && savedFetch) {
				globalThis.fetch = savedFetch;
				savedFetch = null;
			}
		},
	};
}
