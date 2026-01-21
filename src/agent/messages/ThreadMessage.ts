export type ThreadMessageRole = "user" | "assistant" | "system" | "tool";

export interface ThreadMessageTextContent {
	type: "text";
	text: string;
}

export interface ThreadMessageJsonContent {
	type: "json";
	data: unknown;
}

export type ThreadMessageContent = ThreadMessageTextContent | ThreadMessageJsonContent;

export interface ThreadMessageToolCall {
	id: string;
	name: string;
	arguments: unknown;
	description?: string;
}

export interface ThreadMessage {
	id: string;
	role: ThreadMessageRole;
	content: ThreadMessageContent[];
	toolCalls?: ThreadMessageToolCall[];
	toolCallId?: string;
	toolName?: string;
	metadata?: Record<string, unknown>;
	timestamp?: number;
	raw?: unknown;
}

export function normalizeThreadMessages(messages: unknown[]): ThreadMessage[] {
	if (!Array.isArray(messages)) {
		return [];
	}
	return messages
		.map((message, index) => normalizeThreadMessage(message, index))
		.filter((message): message is ThreadMessage => Boolean(message));
}

export function getMessageText(message: ThreadMessage | undefined): string | undefined {
	if (!message || !Array.isArray(message.content)) {
		return undefined;
	}
	const textSegments = message.content
		.filter((segment): segment is ThreadMessageTextContent => segment.type === "text")
		.map((segment) => segment.text.trim())
		.filter((segment) => segment.length > 0);
	return textSegments.length > 0 ? textSegments.join("\n") : undefined;
}

function normalizeThreadMessage(message: unknown, index: number): ThreadMessage | undefined {
	if (isThreadMessage(message)) {
		return message;
	}
	if (isSerializedLangChainMessage(message)) {
		return fromSerializedLangChainMessage(message, index);
	}
	if (isPlainObject(message)) {
		const obj = message as Record<string, unknown>;
		// Check for role field (our format or plain objects)
		if (typeof obj.role === "string") {
			return fromRoleContentObject(obj, index);
		}
		// Check for type field (LangChain message format: "human", "ai", "system", "tool")
		if (typeof obj.type === "string") {
			const role = mapLangChainTypeToRole(obj.type);
			return {
				id: typeof obj.id === "string" && obj.id ? obj.id : createMessageId(index),
				role,
				content: buildContentSegments(obj.content),
				toolCalls: parseToolCalls(obj.tool_calls ?? obj.toolCalls),
				toolCallId: typeof obj.tool_call_id === "string" ? obj.tool_call_id : undefined,
				toolName: typeof obj.name === "string" ? obj.name : undefined,
				metadata: isPlainObject(obj.metadata) ? (obj.metadata as Record<string, unknown>) : undefined,
				raw: message,
			};
		}
	}
	if (typeof message === "string") {
		return {
			id: createMessageId(index),
			role: "assistant",
			content: [{ type: "text", text: message }],
			raw: message,
		};
	}
	return {
		id: createMessageId(index),
		role: "assistant",
		content: [{ type: "json", data: message }],
		raw: message,
	};
}

interface SerializedLangChainMessage {
	id?: unknown;
	kwargs: Record<string, unknown>;
}

function isSerializedLangChainMessage(value: unknown): value is SerializedLangChainMessage {
	if (!isPlainObject(value)) {
		return false;
	}
	if (!("kwargs" in value)) {
		return false;
	}
	return isPlainObject((value as { kwargs: unknown }).kwargs);
}

function fromSerializedLangChainMessage(message: SerializedLangChainMessage, index: number): ThreadMessage {
	const className = readLangChainClassName(message.id);
	const kwargs = message.kwargs ?? {};
	const role = mapClassNameToRole(className);
	const content = buildContentSegments(kwargs.content);
	const metadata = buildMetadata(kwargs);
	const timestamp = extractTimestamp(kwargs);
	const toolCalls = parseToolCalls(
		(getPlainObject(kwargs.additional_kwargs)?.tool_calls ??
			getPlainObject(kwargs.additional_kwargs)?.function_call ??
			kwargs.tool_calls) as unknown,
	);
	const toolCallId = typeof kwargs.tool_call_id === "string" ? kwargs.tool_call_id : undefined;
	const toolName = typeof kwargs.name === "string" ? kwargs.name : undefined;
	const messageId =
		(typeof kwargs.id === "string" && kwargs.id) ||
		(typeof kwargs.tool_call_id === "string" && kwargs.tool_call_id) ||
		createMessageId(index);

	const normalized: ThreadMessage = {
		id: messageId,
		role,
		content,
		metadata,
		toolCalls,
		toolCallId,
		toolName,
		timestamp,
		raw: message,
	};

	return normalized;
}

function fromRoleContentObject(value: Record<string, unknown>, index: number): ThreadMessage {
	const role = mapFreeformRole(String(value.role));
	const content = buildContentSegments(value.content);
	const metadata = isPlainObject(value.metadata) ? (value.metadata as Record<string, unknown>) : undefined;
	const toolCalls = parseToolCalls(value.toolCalls ?? value.tool_calls);
	const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : undefined;
	const toolName = typeof value.toolName === "string" ? value.toolName : undefined;
	const messageId = typeof value.id === "string" && value.id.length > 0 ? value.id : createMessageId(index);
	return {
		id: messageId,
		role,
		content,
		metadata,
		toolCalls,
		toolCallId,
		toolName,
		raw: value,
	};
}

function buildContentSegments(value: unknown): ThreadMessageContent[] {
	const segments: ThreadMessageContent[] = [];
	appendContent(value, segments);
	if (segments.length === 0) {
		segments.push({ type: "text", text: "" });
	}
	return segments;
}

function appendContent(value: unknown, segments: ThreadMessageContent[]): void {
	if (typeof value === "string") {
		segments.push({ type: "text", text: value });
		return;
	}
	if (value === null || typeof value === "undefined") {
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			appendContent(entry, segments);
		}
		return;
	}
	if (isPlainObject(value)) {
		if (typeof value.text === "string" && (value.type === "text" || typeof value.type === "undefined")) {
			segments.push({ type: "text", text: value.text });
			return;
		}
	}
	segments.push({ type: "json", data: value });
}

function buildMetadata(kwargs: Record<string, unknown>): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {};
	if (isPlainObject(kwargs.metadata)) {
		Object.assign(metadata, kwargs.metadata as Record<string, unknown>);
	}
	if (isPlainObject(kwargs.response_metadata)) {
		metadata.response = kwargs.response_metadata;
	}
	if (isPlainObject(kwargs.usage_metadata)) {
		metadata.usage = kwargs.usage_metadata;
	}
	const additional = getPlainObject(kwargs.additional_kwargs);
	if (additional && Object.keys(additional).length > 0) {
		metadata.additional = additional;
	}
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractTimestamp(kwargs: Record<string, unknown>): number | undefined {
	const response = getPlainObject(kwargs.response_metadata);
	const value = (response?.created_at as string | undefined) ?? (kwargs.created_at as string | undefined);
	if (typeof value === "string") {
		const time = Date.parse(value);
		if (!Number.isNaN(time)) {
			return time;
		}
	}
	return undefined;
}

function parseToolCalls(value: unknown): ThreadMessageToolCall[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const toolCalls = value
		.map((entry, index) => parseToolCall(entry, index))
		.filter((entry): entry is ThreadMessageToolCall => Boolean(entry));
	return toolCalls.length > 0 ? toolCalls : undefined;
}

function parseToolCall(value: unknown, index: number): ThreadMessageToolCall | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}

	const functionCall = getPlainObject(value.function);
	const id =
		(typeof value.id === "string" && value.id) ||
		(typeof functionCall?.id === "string" && functionCall.id) ||
		createToolCallId(index);
	const name =
		(typeof functionCall?.name === "string" && functionCall.name) ||
		(typeof value.name === "string" && value.name) ||
		"tool";
	const args = parseToolArguments(functionCall?.arguments ?? value.arguments ?? value.args);

	return {
		id,
		name,
		arguments: args,
		description: typeof value.description === "string" ? value.description : undefined,
	};
}

function parseToolArguments(value: unknown): unknown {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			try {
				return JSON.parse(trimmed);
			} catch {
				return value;
			}
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => parseToolArguments(entry));
	}
	if (isPlainObject(value)) {
		const normalized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			normalized[key] = parseToolArguments(entry);
		}
		return normalized;
	}
	return value;
}

function mapClassNameToRole(className: string | undefined): ThreadMessageRole {
	switch (className) {
		case "HumanMessage":
		case "HumanMessageChunk":
			return "user";
		case "SystemMessage":
			return "system";
		case "AIMessage":
		case "AIMessageChunk":
		case "ChatMessage":
			return "assistant";
		case "ToolMessage":
		case "FunctionMessage":
			return "tool";
		default:
			return "assistant";
	}
}

function mapFreeformRole(role: string): ThreadMessageRole {
	const normalized = role.toLowerCase();
	if (normalized === "user" || normalized === "assistant" || normalized === "system" || normalized === "tool") {
		return normalized;
	}
	return normalized === "function" ? "tool" : "assistant";
}

function mapLangChainTypeToRole(type: string): ThreadMessageRole {
	const normalized = type.toLowerCase();
	switch (normalized) {
		case "human":
		case "humanmessage":
		case "humanmessagechunk":
			return "user";
		case "ai":
		case "aimessage":
		case "aimessagechunk":
		case "chatmessage":
			return "assistant";
		case "system":
		case "systemmessage":
			return "system";
		case "tool":
		case "toolmessage":
		case "function":
		case "functionmessage":
			return "tool";
		default:
			return "assistant";
	}
}

function readLangChainClassName(identifier: unknown): string | undefined {
	if (typeof identifier === "string") {
		return identifier.split(":").pop();
	}
	if (Array.isArray(identifier) && typeof identifier[identifier.length - 1] === "string") {
		return identifier[identifier.length - 1] as string;
	}
	return undefined;
}

function isThreadMessage(value: unknown): value is ThreadMessage {
	return (
		isPlainObject(value) &&
		typeof (value as { role?: unknown }).role === "string" &&
		Array.isArray((value as { content?: unknown }).content)
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPlainObject(value: unknown): Record<string, unknown> | undefined {
	return isPlainObject(value) ? (value as Record<string, unknown>) : undefined;
}

function createMessageId(index: number): string {
	if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
		return globalThis.crypto.randomUUID();
	}
	return `msg_${index}_${Math.random().toString(36).slice(2, 10)}`;
}

function createToolCallId(index: number): string {
	return `tool_call_${index}_${Math.random().toString(36).slice(2, 10)}`;
}
