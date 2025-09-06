/**
 * Persistence layer abstractions for chat + message storage.
 *
 * Goals:
 *  - Backward compatible with the earlier (monolithic) API.
 *  - Enable per-message CRUD so we do NOT have to rewrite / re-save the whole chat object.
 *  - Provide streaming-friendly "upsert" semantics for assistant message updates.
 *
 * Legacy methods retained (for backward compatibility):
 *  - listChats()
 *  - loadChat()
 *  - createChat()
 *  - saveChat()          (DEPRECATED alias – internally should delegate to upsertMessage)
 *  - deleteChat()
 *
 * New granular methods:
 *  - getMessages()
 *  - getMessage()
 *  - addMessage()
 *  - upsertMessage()
 *  - updateAssistantMessagePartial()
 *  - deleteMessage()
 *  - countMessages()
 *
 * If you implement a new persistence adapter, prefer using the granular methods
 * inside higher-level services (e.g. Messenger / ChatSession). The monolithic
 * `loadChat()` + `saveChat()` pair can then be phased out later.
 */

import type {
  ChatPreview,
  MessagePair,
  AssistantMessage,
} from "../Chat/chatState.svelte";

/**
 * Minimal chat record metadata (messages loaded separately).
 * If you still rely on the old full Chat class, you can adapt it externally.
 */
export interface ChatRecordMeta {
  id: string;
  title: string;
  lastAccessed: Date;
  msgCount: number;
}

/**
 * Options for listing / paging messages.
 */
export interface ListMessagesOptions {
  /**
   * Number of messages to skip (for manual paging / infinite scroll).
   * Default: 0
   */
  offset?: number;
  /**
   * Max number of messages to return.
   * Default: undefined (all)
   */
  limit?: number;
  /**
   * Order by timestamp
   * Default: "asc"
   */
  order?: "asc" | "desc";
}

/**
 * A more explicit persistence interface that supports both the legacy
 * "load entire chat" model and the new per-message indexing model.
 */
export interface IChatPersistence {
  /* ---------------------------------------------------------
   * Chat metadata (list / create / delete / load)
   * -------------------------------------------------------*/

  /**
   * List chats for sidebar previews (fast, metadata only).
   */
  listChats(): Promise<ChatPreview[]>;

  /**
   * Load an entire chat including all message pairs (legacy/full load).
   * IMPORTANT: New code should prefer:
   *   - loadChatMeta()
   *   - getMessages(chatId, { ... })
   */
  loadChat(id: string): Promise<any | null>;

  /**
   * Create a new chat with no messages yet.
   * Accepts either a legacy Chat object or a lightweight meta shape.
   */
  createChat(chatLike: {
    id: string;
    title: string;
    lastAccessed: Date;
    messages?: MessagePair[];
  }): Promise<string>;

  /**
   * Delete a chat and all its messages.
   */
  deleteChat(id: string): Promise<boolean>;

  /**
   * Lightweight meta load (no messages).
   */
  loadChatMeta(id: string): Promise<ChatRecordMeta | null>;

  /**
   * Update basic chat metadata (title, lastAccessed).
   * Implementations may merge with existing row.
   */
  updateChatMeta(
    id: string,
    patch: Partial<Omit<ChatRecordMeta, "id" | "msgCount">>,
  ): Promise<void>;

  /* ---------------------------------------------------------
   * Message-level APIs
   * -------------------------------------------------------*/

  /**
   * Get messages for a chat. Supports paging & order.
   */
  getMessages(
    chatId: string,
    options?: ListMessagesOptions,
  ): Promise<MessagePair[]>;

  /**
   * Get a single message by its ID (scoped to a chat).
   */
  getMessage(chatId: string, messageId: string): Promise<MessagePair | null>;

  /**
   * Add a brand-new message pair (user + empty/initial assistant).
   * Should fail / reject if an entry with the same ID already exists.
   */
  addMessage(chatId: string, message: MessagePair): Promise<void>;

  /**
   * Insert or update a message pair (idempotent).
   * Use this for streaming updates (assistant content/state changes).
   */
  upsertMessage(chatId: string, message: MessagePair): Promise<void>;

  /**
   * Partial, assistant-only update to avoid re-writing unchanged user fields.
   * Implementations can optimize to only patch assistant columns.
   */
  updateAssistantMessagePartial(
    chatId: string,
    messageId: string,
    patch: Partial<AssistantMessage>,
  ): Promise<void>;

  /**
   * Remove a single message from a chat.
   */
  deleteMessage(chatId: string, messageId: string): Promise<boolean>;

  /**
   * Count messages in a chat (for pagination / analytics).
   */
  countMessages(chatId: string): Promise<number>;

  /* ---------------------------------------------------------
   * Legacy (monolithic) method – retained for compatibility.
   * New code SHOULD NOT call this directly; use addMessage/upsertMessage.
   * -------------------------------------------------------*/

  /**
   * DEPRECATED:
   * Historically used to "save the chat" by passing a single messagePair.
   * Treat this as an alias for upsertMessage + metadata bump.
   */
  saveChat(chatId: string, messagePair: MessagePair): Promise<void>;
}

/**
 * Type Guard helpers (optional)
 */
export function isChatRecordMeta(obj: any): obj is ChatRecordMeta {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.title === "string" &&
    obj.lastAccessed instanceof Date &&
    typeof obj.msgCount === "number"
  );
}
