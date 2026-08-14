import { requestUrl, type RequestUrlParam } from "obsidian";
import { Logger } from "../utils/logging";
import { createAsyncLocalStorage } from "./asyncLocalStorage";

export type AiTransportMode = "default" | "buffered";

export interface AiTransportContext {
	mode: AiTransportMode;
	label: string;
}

interface NormalizedRequest {
	url: string;
	init: RequestInit;
}

const aiTransportContextStorage = createAsyncLocalStorage<AiTransportContext>();

type ErrorWithCause = Error & { cause?: unknown };

export class AiTransportDowngradeRequiredError extends Error {
	readonly providerId: string;
	readonly url: string;
	readonly cause: unknown;

	constructor(providerId: string, url: string, cause: unknown) {
		super(`AI streaming transport failed before response for provider "${providerId}"`);
		this.name = "AiTransportDowngradeRequiredError";
		this.providerId = providerId;
		this.url = url;
		this.cause = cause;
	}
}

export function findAiTransportDowngradeRequiredError(error: unknown): AiTransportDowngradeRequiredError | null {
	let current: unknown = error;

	while (current instanceof Error) {
		if (current instanceof AiTransportDowngradeRequiredError) {
			return current;
		}
		current = (current as ErrorWithCause).cause;
	}

	return null;
}

export function createAiTransportContext(mode: AiTransportMode, label: string): AiTransportContext {
	return { mode, label };
}

/**
 * Runs `fn` with `context` as the active transport context, scoped via
 * AsyncLocalStorage.run() (NOT enterWith). This is concurrency-safe: two
 * overlapping runs each get their own isolated context, so a buffered
 * downgrade in one stream can never leak its mode into another stream's
 * async continuation. Use this to wrap non-streaming invokes (title/summary
 * generation, buffered fallback) whose entire lifecycle fits in one call.
 */
export function runWithAiTransportContext<T>(context: AiTransportContext, fn: () => Promise<T>): Promise<T> {
	return aiTransportContextStorage.run(context, fn);
}

/**
 * Wraps an async iterable so that every pull (`next`/`return`/`throw`) runs
 * inside `aiTransportContextStorage.run(context)`. Streaming agents re-yield
 * each chunk to their own consumer, which awaits work OUTSIDE the transport
 * scope; a plain run() around the generator body would lose the context on
 * every yield. Binding each pull instead keeps the context active precisely
 * when the underlying LangChain stream resumes (and issues its fetch, which
 * reads the context via getCurrentMode), isolated per run even under
 * concurrent streams. See src/lib/aiTransport ALS notes.
 */
export function bindAsyncIterableToTransportContext<T>(
	iterable: AsyncIterable<T>,
	context: AiTransportContext,
): AsyncIterable<T> {
	const iterator = iterable[Symbol.asyncIterator]();
	return {
		[Symbol.asyncIterator](): AsyncIterator<T> {
			return {
				next: (...args) => aiTransportContextStorage.run(context, () => iterator.next(...args)),
				return: iterator.return
					? (value?: unknown) =>
							aiTransportContextStorage.run(context, () =>
								(iterator.return as (v?: unknown) => Promise<IteratorResult<T>>)(value),
							)
					: undefined,
				throw: iterator.throw
					? (err?: unknown) =>
							aiTransportContextStorage.run(context, () =>
								(iterator.throw as (e?: unknown) => Promise<IteratorResult<T>>)(err),
							)
					: undefined,
			};
		},
	};
}

function getCurrentMode(): AiTransportMode {
	return aiTransportContextStorage.getStore()?.mode ?? "default";
}

/** Test-only: read the current transport mode as resolved from ALS. */
export function getCurrentAiTransportModeForTest(): AiTransportMode {
	return getCurrentMode();
}

async function getElectronNetFetch(): Promise<typeof fetch | null> {
	const globalWithRequire = globalThis as typeof globalThis & {
		require?: (id: string) => unknown;
		window?: { require?: (id: string) => unknown };
	};

	const requireCandidates = [globalWithRequire.require, globalWithRequire.window?.require];
	for (const requireFn of requireCandidates) {
		if (typeof requireFn !== "function") continue;
		try {
			const electron = requireFn("electron") as {
				net?: { fetch?: typeof fetch };
				remote?: { net?: { fetch?: typeof fetch } };
			};
			const electronNet = electron.remote?.net ?? electron.net;
			if (typeof electronNet?.fetch === "function") {
				Logger.debug("aiTransport.electron_fetch_resolved");
				return electronNet.fetch.bind(electronNet);
			}
		} catch {
			// Try the next resolution path.
		}
	}

	try {
		const electron = (await import("electron")) as {
			net?: { fetch?: typeof fetch };
			remote?: { net?: { fetch?: typeof fetch } };
		};
		const electronNet = electron.remote?.net ?? electron.net;
		return typeof electronNet?.fetch === "function" ? electronNet.fetch.bind(electronNet) : null;
	} catch {
		return null;
	}
}

function cloneHeaders(headers: HeadersInit | undefined): Headers {
	return new Headers(headers);
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
	return Object.fromEntries(new Headers(headers).entries());
}

/** Remove renderer-owned objects before RequestInit crosses Electron's remote bridge. */
export function normalizeElectronNetRequestInit(init: RequestInit): RequestInit {
	if (init.signal == null) return init;

	const { signal: _rendererSignal, ...electronInit } = init;
	return electronInit;
}

function normalizeFetchLikeResponse(response: Response): Response {
	try {
		Object.defineProperty(response, "headers", {
			value: new Headers(response.headers as unknown as HeadersInit),
			configurable: true,
		});
	} catch {
		// Keep the original headers if this runtime already exposes compatible ones.
	}
	return response;
}

function normalizeRequest(input: RequestInfo | URL, init?: RequestInit): NormalizedRequest {
	if (input instanceof Request) {
		const headers = cloneHeaders(input.headers);
		if (init?.headers) {
			new Headers(init.headers).forEach((value, key) => headers.set(key, value));
		}

		return {
			url: input.url,
			init: {
				method: init?.method ?? input.method,
				headers,
				body: init?.body ?? input.body ?? undefined,
				signal: init?.signal ?? input.signal,
			},
		};
	}

	return {
		url: input instanceof URL ? input.toString() : String(input),
		init: {
			...init,
			headers: cloneHeaders(init?.headers),
		},
	};
}

function toPlainArrayBuffer(view: ArrayBufferView): ArrayBuffer {
	const copy = new Uint8Array(view.byteLength);
	copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
	return copy.buffer;
}

async function requestUrlFetch(url: string, init: RequestInit): Promise<Response> {
	const method = init.method || "GET";
	const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers ?? {});
	const body = init.body;

	let requestBody: RequestUrlParam["body"] = typeof body === "string" ? body : undefined;

	if (body && typeof body !== "string") {
		if (body instanceof Uint8Array) {
			requestBody = toPlainArrayBuffer(body);
		} else if (ArrayBuffer.isView(body)) {
			requestBody = toPlainArrayBuffer(body);
		} else if (body instanceof ArrayBuffer) {
			requestBody = body;
		} else if (body instanceof Blob) {
			requestBody = await body.arrayBuffer();
		} else if (body instanceof ReadableStream) {
			const reader = body.getReader();
			const chunks: Uint8Array[] = [];
			let totalLength = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!(value instanceof Uint8Array)) continue;
				chunks.push(value);
				totalLength += value.length;
			}

			const result = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.length;
			}

			requestBody = result.buffer;
		}
	}

	const response = await requestUrl({
		url,
		method,
		headers: headers as Record<string, string>,
		body: requestBody,
		throw: false,
	});

	const responseHeaders: Record<string, string> = {
		...(response.headers as Record<string, string>),
		"x-smart2brain-transport": "requestUrl",
		"x-smart2brain-execution": "buffered",
	};

	// Obsidian's requestUrl may strip the content-type header from responses.
	// The OpenAI SDK requires it to parse JSON responses correctly.
	if (!responseHeaders["content-type"] && !responseHeaders["Content-Type"]) {
		responseHeaders["content-type"] = "application/json";
	}

	return new Response(response.text, {
		status: response.status,
		headers: new Headers(responseHeaders),
	});
}

function parseRequestBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
	if (typeof body !== "string") {
		return null;
	}

	try {
		return JSON.parse(body) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function stringifyRequestBody(parsed: Record<string, unknown>): string {
	return JSON.stringify(parsed);
}

function normalizeChatCompletionMessages(parsed: Record<string, unknown>): Record<string, unknown> {
	if (!Array.isArray(parsed.messages)) {
		return parsed;
	}

	const flattenedMessages = parsed.messages.flatMap((message) => (Array.isArray(message) ? message : [message]));

	return {
		...parsed,
		messages: flattenedMessages.map((message) => {
			if (!message || typeof message !== "object") {
				return message;
			}

			const entry = { ...(message as Record<string, unknown>) };
			const role = typeof entry.role === "string" ? entry.role : undefined;
			const hasToolCalls = Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0;

			if (role === "assistant" && hasToolCalls) {
				// Preserve the canonical OpenAI-compatible replay shape for tool-call turns.
				// Some providers reject assistant tool-call messages when renderer-specific
				// metadata such as `name: "model"` is forwarded back to /chat/completions.
				if (entry.content == null) {
					entry.content = "";
				}
				entry.name = undefined;
			}

			return entry;
		}),
	};
}

function summarizeMessagesForDebug(body: BodyInit | null | undefined): unknown {
	const parsed = parseRequestBody(body);
	if (!parsed || !Array.isArray(parsed.messages)) {
		return undefined;
	}

	return parsed.messages.map((message) => {
		if (!message || typeof message !== "object") {
			return message;
		}

		const entry = message as Record<string, unknown>;
		return {
			role: entry.role,
			content: entry.content,
			tool_call_id: entry.tool_call_id,
			tool_calls: entry.tool_calls,
			name: entry.name,
		};
	});
}

function isStreamingRequest(init: RequestInit): boolean {
	const parsed = parseRequestBody(init.body);
	return parsed?.stream === true;
}

function disableStreaming(init: RequestInit): RequestInit {
	const parsed = parseRequestBody(init.body);
	if (!parsed) {
		return init;
	}

	if (parsed.stream === true) {
		parsed.stream = false;
	}

	return {
		...init,
		body: stringifyRequestBody(normalizeChatCompletionMessages(parsed)),
	};
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function looksLikeTransportFailureMessage(message: string): boolean {
	return (
		message.includes("failed to fetch") ||
		message.includes("networkerror") ||
		message.includes("network error") ||
		message.includes("cors") ||
		message.includes("load failed")
	);
}

function isTransportFailure(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	if (isAbortError(error)) {
		return false;
	}

	const message = error.message.toLowerCase();
	return looksLikeTransportFailureMessage(message);
}

async function performPrimaryFetch(normalized: NormalizedRequest): Promise<Response> {
	const electronFetch = await getElectronNetFetch();
	const rendererSignal = normalized.init.signal;
	rendererSignal?.throwIfAborted();
	const parsedBody = parseRequestBody(normalized.init.body);
	const normalizedBody =
		parsedBody && normalized.url.includes("/chat/completions")
			? normalizeChatCompletionMessages(parsedBody)
			: undefined;
	const requestBody = normalizedBody ? stringifyRequestBody(normalizedBody) : normalized.init.body;
	const response = await (electronFetch ?? globalThis.fetch.bind(globalThis))(
		normalized.url,
		electronFetch
			? normalizeElectronNetRequestInit({
					...normalized.init,
					body: requestBody,
					headers: toHeaderRecord(normalized.init.headers),
				})
			: { ...normalized.init, body: requestBody },
	);
	if (electronFetch && rendererSignal?.aborted) {
		await response.body?.cancel().catch(() => undefined);
		rendererSignal.throwIfAborted();
	}
	if (!response.ok && normalized.url.includes("/chat/completions")) {
		let responseText: string | undefined;
		try {
			responseText = await response.clone().text();
		} catch {
			responseText = undefined;
		}
		Logger.debug("aiTransport.response_error", {
			url: normalized.url,
			status: response.status,
			body: responseText,
		});
	}
	return electronFetch ? normalizeFetchLikeResponse(response as Response) : response;
}

export async function performAiFetch(
	providerId: string,
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const normalized = normalizeRequest(input, init);
	const wantsStreaming = isStreamingRequest(normalized.init);
	const currentMode = getCurrentMode();

	const debugMessages = summarizeMessagesForDebug(normalized.init.body);
	if (debugMessages && normalized.url.includes("/chat/completions")) {
		Logger.debug("aiTransport.request_messages", {
			providerId,
			url: normalized.url,
			mode: currentMode,
			messages: debugMessages,
		});
	}

	if (currentMode === "buffered") {
		const bufferedInit = wantsStreaming ? disableStreaming(normalized.init) : normalized.init;
		Logger.debug("aiTransport.buffered_request", {
			providerId,
			url: normalized.url,
			wantsStreaming,
		});
		return requestUrlFetch(normalized.url, bufferedInit);
	}

	try {
		const response = await performPrimaryFetch(normalized);
		return response;
	} catch (error) {
		if (!isTransportFailure(error)) {
			throw error;
		}

		if (wantsStreaming) {
			Logger.debug("aiTransport.streaming_downgrade_required", {
				providerId,
				url: normalized.url,
				message: error instanceof Error ? error.message : String(error),
			});
			throw new AiTransportDowngradeRequiredError(providerId, normalized.url, error);
		}

		Logger.debug("aiTransport.requestUrl_fallback", {
			providerId,
			url: normalized.url,
			message: error instanceof Error ? error.message : String(error),
		});
		return requestUrlFetch(normalized.url, normalized.init);
	}
}

export function createAiProviderFetch(providerId: string): typeof fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => performAiFetch(providerId, input, init)) as typeof fetch;
}

/**
 * Fetch implementation that always routes through Obsidian's buffered `requestUrl`.
 * Subagent models are invoked non-streaming (via the
 * deepagents `task` tool's `.invoke()`), and the LiteLLM/OpenAI-compatible endpoints
 * used here can return an empty body for a non-streaming request served over renderer fetch,
 * which surfaces as "Cannot read properties of undefined (reading 'message')" inside
 * `BaseChatModel.invoke`. Routing through `requestUrl` returns a usable buffered body.
 * Pair with `disableStreaming: true` on the model (see chatProviders) so LangChain
 * actually takes the non-streaming path.
 */
export function createBufferedAiProviderFetch(providerId: string): typeof fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const normalized = normalizeRequest(input, init);
		const bufferedInit = isStreamingRequest(normalized.init) ? disableStreaming(normalized.init) : normalized.init;
		Logger.debug("aiTransport.subagent_buffered_request", { providerId, url: normalized.url });
		return requestUrlFetch(normalized.url, bufferedInit);
	}) as typeof fetch;
}
