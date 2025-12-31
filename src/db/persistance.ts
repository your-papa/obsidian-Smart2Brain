/**
 * Persistence layer abstractions for chat + message storage.

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

import type { ChatPreview, MessagePair, AssistantMessage } from "../stores/stateState.svelte";
import { isUUIDv7, type UUIDv7 } from "../utils/uuid7Validator";

/**
 * Minimal chat record metadata (messages loaded separately).
 * If you still rely on the old full Chat class, you can adapt it externally.
 */
export interface ChatRecordMeta {
	id: UUIDv7;
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
	 * Create a new chat with no messages yet.
	 * Accepts a lightweight meta shape.
	 */
	createChat(chatLike: {
		id: UUIDv7;
		title: string;
		lastAccessed: Date;
	}): Promise<UUIDv7>;

	/**
	 * Delete a chat and all its messages.
	 */
	deleteChat(id: UUIDv7): Promise<boolean>;

	/**
	 *
	 * @param id
	 * @param chatId
	 * @param cutoffMessageId
	 *
	 * Branches off a chat from a message.
	 */
	branchOffFromMessage(id: UUIDv7, chatId: UUIDv7, cutoffMessageId: UUIDv7, lastAccessed: Date): Promise<UUIDv7>;

	/**
	 * Lightweight meta load (no messages).
	 */
	loadChatMeta(id: UUIDv7): Promise<ChatRecordMeta | null>;

	/**
	 * Update basic chat metadata (title, lastAccessed).
	 * Implementations may merge with existing row.
	 */
	updateChatMeta(id: UUIDv7, patch: Partial<Omit<ChatRecordMeta, "UUIDv7" | "msgCount">>): Promise<void>;

	/* ---------------------------------------------------------
	 * Message-level APIs
	 * -------------------------------------------------------*/

	/**
	 * Get messages for a chat. Supports paging & order.
	 */
	getMessages(chatId: UUIDv7, options?: ListMessagesOptions): Promise<MessagePair[]>;

	/**
	 * Get a single message by its ID (scoped to a chat).
	 */
	getMessage(chatId: UUIDv7, messageId: string): Promise<MessagePair | null>;

	/**
	 * Add a brand-new message pair (user + empty/initial assistant).
	 * Should fail / reject if an entry with the same ID already exists.
	 */
	addMessage(chatId: UUIDv7, message: MessagePair): Promise<void>;

	/**
	 * Insert or update a message pair (idempotent).
	 * Use this for streaming updates (assistant content/state changes).
	 */
	upsertMessage(chatId: UUIDv7, message: MessagePair): Promise<void>;

	/**
	 * Partial, assistant-only update to avoid re-writing unchanged user fields.
	 * Implementations can optimize to only patch assistant columns.
	 */
	updateAssistantMessagePartial(chatId: UUIDv7, messageId: UUIDv7, patch: Partial<AssistantMessage>): Promise<void>;

	/**
	 * Remove a single message from a chat.
	 */
	deleteMessage(chatId: UUIDv7, messageId: UUIDv7): Promise<boolean>;

	/**
	 * Drop all messages at given id from a chat.
	 */
	dropHistoryAt(chatId: UUIDv7, messageId: UUIDv7): Promise<boolean>;

	/**
	 * Count messages in a chat (for pagination / analytics).
	 */
	countMessages(chatId: UUIDv7): Promise<number>;
}

/**
 * Type Guard helpers (optional)
 */
export function isChatRecordMeta(obj: any): obj is ChatRecordMeta {
	return (
		obj &&
		isUUIDv7(obj.id) &&
		typeof obj.title === "string" &&
		obj.lastAccessed instanceof Date &&
		typeof obj.msgCount === "number"
	);
}
