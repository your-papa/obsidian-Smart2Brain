import { requestUrl, type RequestUrlParam } from "obsidian";

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
		const body = init?.body as string;

		// Convert Headers object to record if needed
		if (init?.headers instanceof Headers) {
			init.headers.forEach((value, key) => {
				headers[key] = value;
			});
		}

		// If the body is a byte array (Uint8Array), requestUrl expects it as an ArrayBuffer
		// However, for multipart/form-data or gzipped content, we might need special handling

		let requestBody = body;
		// Check if body exists and is NOT a string (so it's likely binary)
		if (init?.body && typeof init.body !== "string") {
			// Handle Uint8Array specifically (common in node/browser buffers)
			if (init.body instanceof Uint8Array) {
				// If it's a view on a larger buffer, we need to slice it
				if (init.body.byteLength !== init.body.buffer.byteLength) {
					requestBody = init.body.buffer.slice(
						init.body.byteOffset,
						init.body.byteOffset + init.body.byteLength,
					) as any;
				} else {
					requestBody = init.body.buffer as any;
				}
			}
			// Handle generic ArrayBufferView
			else if (ArrayBuffer.isView(init.body)) {
				requestBody = init.body.buffer as any;
			}
			// Handle raw ArrayBuffer
			else if (init.body instanceof ArrayBuffer) {
				requestBody = init.body as any;
			}
			// Handle Blob
			else if (init.body instanceof Blob) {
				requestBody = (await init.body.arrayBuffer()) as any;
			}
			// Handle ReadableStream
			else if (init.body instanceof ReadableStream) {
				// We need to read the stream into an ArrayBuffer
				const reader = init.body.getReader();
				const chunks = [];
				let totalLength = 0;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
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

				requestBody = result.buffer as any;
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

			// Convert Obsidian response to standard Response object
			return new Response(response.text, {
				status: response.status,
				headers: response.headers as Record<string, string>,
			});
		} catch (error) {
			console.error("Obsidian fetch proxy error:", error);
			throw error;
		}
	};
}
