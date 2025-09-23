import Dexie, { type Table } from "dexie";
import { type AssistantState, type ChatModel } from "../Chat/chatState.svelte";
import { type UUIDv7 } from "../../utils/uuid7Validator";
import type { GenModelConfig } from "papa-ts";

/**
 * Chat metadata row.
 */
export interface ChatRow {
  id: UUIDv7;
  title: string;
  lastAccessed: string; // ISO string
  createdAt: string;
  msgCount: number;
}

/**
 * Individual message pair (user + assistant).
 * Stored separately to avoid rewriting the entire chat document on every message.
 */
export interface MessagePairRow {
  id: UUIDv7;
  chatId: UUIDv7;
  model: ChatModel;
  userContent: string;
  assistantState: AssistantState;
  assistantContent: string;
}

export class ChatDB extends Dexie {
  chats!: Table<ChatRow, UUIDv7>;
  messagePairs!: Table<MessagePairRow, UUIDv7>;

  constructor(name = "smart-second-brain-db") {
    super(name);

    // Single version: order messages by UUIDv7 (lexicographic) with [chatId+id]
    this.version(1).stores({
      chats: "id, lastAccessed, createdAt",
      messagePairs: "id, chatId, [chatId+id]",
    });
  }
}
