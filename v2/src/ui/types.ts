import type { ThreadMessage, ThreadMessageToolCall } from "papa-ts";

export interface ToolCallState {
	id: string;
	name: string;
	input: any;
	status: "running" | "completed" | "failed";
	output?: any;
}

export interface UIMessage extends Omit<ThreadMessage, "toolCalls"> {
	toolCalls?: ToolCallState[];
	// We need to allow for the raw toolCalls property during processing
	tool_calls?: any[];
}

