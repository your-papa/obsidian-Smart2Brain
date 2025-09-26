import Dexie, { type Table } from "dexie";
import { type AssistantState, type ChatModel } from "../Chat/chatState.svelte";
import { type UUIDv7 } from "../../utils/uuid7Validator";

/**
 * Chat metadata row.
 */
export interface ChatRow {
  id: UUIDv7;
  title: string;
  lastAccessed: string;
  msgCount: number;
  parentChatId: UUIDv7 | null;
}

/**
 * Individual message pair (user + assistant).
 * Stored separately to avoid rewriting the entire chat document on every message.
 */
export interface MessagePairRow {
  id: UUIDv7;
  model: ChatModel;
  userContent: string;
  assistantState: AssistantState;
  assistantContent: string;
}

export interface ChatMessageRow {
  messageId: UUIDv7;
  chatId: UUIDv7;
}

export class ChatDB extends Dexie {
  chats!: Table<ChatRow, UUIDv7>;
  messagePairs!: Table<MessagePairRow, UUIDv7>;
  messagePointers!: Table<ChatMessageRow, [UUIDv7, UUIDv7]>;

  constructor(name = "smart-second-brain-db") {
    super(name);

    this.version(1).stores({
      chats: "id, lastAccessed, [id+parentChatId]",
      messagePairs: "id , [id+assistantState]",
      messagePointers: "[chatId+messageId], chatId, messageId",
    });
  }
}
