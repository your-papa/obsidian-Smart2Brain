import type { ThreadMessage, ThreadMessageToolCall } from "papa-ts";
import type { UIMessage, ToolCallState } from "./types";

export function processMessages(storedMessages: any[]): UIMessage[] {
    if (!storedMessages || storedMessages.length === 0) {
        return [];
    }

    // First pass: map to basic UI messages
    const uiMessages: UIMessage[] = storedMessages.map(
        (msg: any) => ({
            ...msg,
            id: msg.id || crypto.randomUUID(),
            timestamp: msg.timestamp || Date.now(),
            // Don't overwrite toolCalls yet, we need to read them!
            // But ensure we have a property for Svelte to track if it doesn't exist
            _uiToolCalls: [],
        }),
    );

    // Second pass: Link tool outputs back to assistant messages
    const toolOutputs = new Map<string, any>(); // tool_call_id -> output message

    for (const msg of uiMessages) {
        // Check both camelCase and snake_case
        const toolCallId =
            (msg as any).tool_call_id || (msg as any).toolCallId;
        if (msg.role === "tool" && toolCallId) {
            toolOutputs.set(toolCallId, msg);
        }
    }

    for (const msg of uiMessages) {
        // Read from the message properties (preserved from spread)
        const rawToolCalls =
            (msg as any).tool_calls || (msg as any).toolCalls;

        if (
            msg.role === "assistant" &&
            rawToolCalls &&
            rawToolCalls.length > 0
        ) {
            if (Array.isArray(rawToolCalls)) {
                msg.toolCalls = rawToolCalls.map(
                    (tc: ThreadMessageToolCall) => {
                        const id = tc.id;
                        const name = tc.name;
                        const args = tc.arguments;

                        const outputMsg = toolOutputs.get(id);

                        // Handle different input formats (same logic as streaming)
                        let parsedArgs = args;
                        if (args === undefined || args === null) {
                            parsedArgs = {};
                        } else if (typeof args === "string") {
                            // Try to parse as JSON
                            try {
                                const parsed = JSON.parse(args);
                                // Ensure it's an object (not array or primitive)
                                parsedArgs =
                                    typeof parsed === "object" &&
                                    !Array.isArray(parsed)
                                        ? parsed
                                        : { value: parsed };
                            } catch {
                                // If parsing fails, treat as a single string value
                                parsedArgs = { input: args };
                            }
                        } else if (Array.isArray(args)) {
                            // If it's an array, wrap it
                            parsedArgs = { value: args };
                        } else if (typeof args !== "object") {
                            // If it's a primitive, wrap it
                            parsedArgs = { value: args };
                        }
                        // If it's already an object, use it as-is

                        return {
                            id: id,
                            name: name,
                            input: parsedArgs,
                            // Determine status based on presence of output message
                            status: outputMsg
                                ? outputMsg.status === "error"
                                    ? "failed"
                                    : "completed"
                                : "running",
                            output: outputMsg
                                ? outputMsg.content
                                : undefined,
                        };
                    },
                );
            }
        }
    }

    // Filter out tool messages as they are now embedded in assistant messages
    let filteredMessages = uiMessages.filter(
        (msg) => msg.role !== "tool",
    );

    // Merge consecutive assistant messages (tool calls + final response)
    return mergeConsecutiveAssistantMessages(filteredMessages);
}

export function mergeConsecutiveAssistantMessages(msgs: UIMessage[]): UIMessage[] {
    const merged: UIMessage[] = [];
    let i = 0;

    while (i < msgs.length) {
        const current = msgs[i];

        // If it's not an assistant message, just add it
        if (current.role !== "assistant") {
            merged.push(current);
            i++;
            continue;
        }

        // Collect consecutive assistant messages
        const assistantGroup: UIMessage[] = [current];
        i++;

        while (i < msgs.length && msgs[i].role === "assistant") {
            assistantGroup.push(msgs[i]);
            i++;
        }

        // Merge the group into one message
        if (assistantGroup.length === 1) {
            merged.push(assistantGroup[0]);
        } else {
            // Combine all tool calls
            const allToolCalls: ToolCallState[] = [];
            let finalContent: any = null;
            let finalId = assistantGroup[0].id;
            let finalTimestamp = assistantGroup[0].timestamp || Date.now();

            for (const msg of assistantGroup) {
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    allToolCalls.push(...msg.toolCalls);
                }
                // Find the message with actual text content (final response)
                const content = msg.content?.[0];
                if (
                    content &&
                    (content as any).type === "text" &&
                    (content as any).text &&
                    (content as any).text.trim()
                ) {
                    finalContent = msg.content;
                    finalId = msg.id;
                    finalTimestamp = msg.timestamp || finalTimestamp;
                }
            }

            // Create merged message
            merged.push({
                ...assistantGroup[assistantGroup.length - 1], // Use last message as base
                id: finalId,
                timestamp: finalTimestamp,
                toolCalls:
                    allToolCalls.length > 0 ? allToolCalls : undefined,
                content: finalContent || assistantGroup[0].content,
            });
        }
    }

    return merged;
}

export function createThreadId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `Chat ${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}

