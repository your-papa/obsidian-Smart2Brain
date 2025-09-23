import type {
  ChatPreview,
  MessagePair,
  AssistantMessage,
} from "../Chat/chatState.svelte";
import type {
  IChatPersistence,
  ChatRecordMeta,
  ListMessagesOptions,
} from "./persistance";
import type { ChatDB, ChatRow, MessagePairRow } from "./chatDbSchema";
import { Dexie } from "dexie";
import type { UUIDv7 } from "../../utils/uuid7Validator";

/**
 * DexiePersistence
 * Implements granular, per-message CRUD operations while keeping the old
 * "saveChat(chatId, messagePair)" API for backward compatibility.
 *
 * METHODS:
 *  - loadChatMeta()
 *  - getMessages()
 *  - addMessage()
 *  - upsertMessage()
 *  - updateAssistantMessagePartial()
 *  - deleteMessage()
 *
 *
 * NOTE: We keep returning a Chat instance from loadChat() so existing code
 * using the original Chat class will continue to function until migrated.
 */
export class DexiePersistence implements IChatPersistence {
  constructor(private db: ChatDB) {}

  /* =========================================================
   * Helpers
   * =======================================================*/

  private rowToMessagePair(row: MessagePairRow): MessagePair {
    return {
      id: row.id,
      model: row.model,
      userMessage: {
        content: row.userContent,
      },
      assistantMessage: {
        state: row.assistantState,
        content: row.assistantContent,
      },
    };
  }

  private async internalIncrementMsgCount(chatId: UUIDv7): Promise<void> {
    // Optimistic approach: recompute count from table (avoids race)
    const count = await this.db.messagePairs
      .where("chatId")
      .equals(chatId)
      .count();
    await this.db.chats.update(chatId, {
      msgCount: count,
    });
  }

  /* =========================================================
   * Chat (metadata) APIs
   * =======================================================*/

  async listChats(): Promise<ChatPreview[]> {
    const rows = await this.db.chats
      .orderBy("lastAccessed")
      .reverse()
      .toArray();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      lastAccessed: new Date(r.lastAccessed), // Convert ISO string -> Date for preview
    }));
  }

  async loadChatMeta(id: UUIDv7): Promise<ChatRecordMeta | null> {
    const row = await this.db.chats.get(id);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      lastAccessed: new Date(row.lastAccessed),
      msgCount: row.msgCount ?? 0,
    };
  }

  async createChat(chatLike: {
    id: UUIDv7;
    title: string;
    lastAccessed: Date;
  }): Promise<string> {
    const { id, title, lastAccessed } = chatLike;

    await this.db.chats.add({
      id,
      title,
      lastAccessed: lastAccessed.toISOString(),
      createdAt: lastAccessed.toISOString(),
      msgCount: 0,
    });

    return id;
  }

  async updateChatMeta(
    id: UUIDv7,
    patch: Partial<Omit<ChatRecordMeta, "UUIDv7" | "msgCount">>,
  ): Promise<void> {
    const update: Partial<ChatRow> = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.lastAccessed !== undefined) {
      update.lastAccessed = patch.lastAccessed.toISOString();
    }
    if (Object.keys(update).length) {
      await this.db.chats.update(id, update);
    }
  }

  async deleteChat(id: UUIDv7): Promise<boolean> {
    return this.db.transaction(
      "rw",
      this.db.chats,
      this.db.messagePairs,
      async () => {
        const exists = await this.db.chats.get(id);
        if (!exists) return false;

        await this.db.messagePairs.where("chatId").equals(id).delete();
        await this.db.chats.delete(id);
        return true;
      },
    );
  }

  /* =========================================================
   * Message-Level APIs
   * =======================================================*/

  async getMessages(
    chatId: UUIDv7,
    options: ListMessagesOptions = {},
  ): Promise<MessagePair[]> {
    const { offset = 0, limit, order = "asc" } = options;

    // Retrieve ordered by timestamp via compound index
    let collection = this.db.messagePairs
      .where("[chatId+id]")
      .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]);

    if (order === "desc") {
      collection = collection.reverse();
    }

    if (offset) collection = collection.offset(offset);
    if (limit !== undefined) collection = collection.limit(limit);

    const rows = await collection.toArray();
    return rows.map((r) => this.rowToMessagePair(r));
  }

  async getMessage(
    chatId: UUIDv7,
    messageId: UUIDv7,
  ): Promise<MessagePair | null> {
    const row = await this.db.messagePairs.get(messageId);
    if (!row || row.chatId !== chatId) return null;
    return this.rowToMessagePair(row);
  }

  async addMessage(chatId: UUIDv7, message: MessagePair): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.messagePairs,
      this.db.chats,
      async () => {
        const existing = await this.db.messagePairs.get(message.id);
        if (existing) {
          throw new Error(
            `Message with id ${message.id} already exists (chat ${chatId}).`,
          );
        }

        const row: MessagePairRow = {
          id: message.id,
          chatId,
          model: message.model,
          userContent: message.userMessage.content,
          assistantState: message.assistantMessage.state,
          assistantContent: message.assistantMessage.content,
        };

        await this.db.messagePairs.add(row);
        await this.db.chats.update(chatId, {
          lastAccessed: new Date().toISOString(),
        });
      },
    );

    await this.internalIncrementMsgCount(chatId);
  }

  async upsertMessage(chatId: UUIDv7, message: MessagePair): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.messagePairs,
      this.db.chats,
      async () => {
        const prior = await this.db.messagePairs.get(message.id);

        const row: MessagePairRow = {
          id: message.id,
          chatId,
          model: message.model,
          userContent: message.userMessage.content,
          assistantState: message.assistantMessage.state,
          assistantContent: message.assistantMessage.content,
        };

        await this.db.messagePairs.put(row);

        await this.db.chats.update(chatId, {
          lastAccessed: new Date().toISOString(),
        });

        if (!prior) {
          await this.internalIncrementMsgCount(chatId);
        }
      },
    );
  }

  async dropHistoryAt(chatId: UUIDv7, messageId: UUIDv7): Promise<boolean> {
    return this.db.transaction(
      "rw",
      this.db.messagePairs,
      this.db.chats,
      async () => {
        const existing = await this.getMessage(chatId, messageId);
        console.log(existing);
        if (!existing) return false;

        await this.db.messagePairs
          .where("[chatId+id]")
          .between([chatId, messageId], [chatId, Dexie.maxKey])
          .delete();

        await this.internalIncrementMsgCount(chatId);
        return true;
      },
    );
  }

  async updateAssistantMessagePartial(
    chatId: UUIDv7,
    messageId: UUIDv7,
    patch: Partial<AssistantMessage>,
  ): Promise<void> {
    const allowed: Partial<MessagePairRow> = {};
    if (patch.state !== undefined) {
      allowed.assistantState = patch.state;
    }
    if (patch.content !== undefined) {
      allowed.assistantContent = patch.content;
    }
    if (!Object.keys(allowed).length) return;

    await this.db.transaction("rw", this.db.messagePairs, async () => {
      const existing = await this.db.messagePairs.get(messageId);
      if (!existing) return;
      if (existing.chatId !== chatId) {
        throw new Error(
          `Message ${messageId} does not belong to chat ${chatId}.`,
        );
      }
      await this.db.messagePairs.update(messageId, allowed);
    });
  }

  async deleteMessage(chatId: UUIDv7, messageId: UUIDv7): Promise<boolean> {
    const deleted = await this.db.transaction(
      "rw",
      this.db.messagePairs,
      this.db.chats,
      async () => {
        const existing = await this.db.messagePairs.get(messageId);
        if (!existing || existing.chatId !== chatId) return false;
        await this.db.messagePairs.delete(messageId);
        await this.internalIncrementMsgCount(chatId);
        return true;
      },
    );
    return deleted;
  }

  async countMessages(chatId: UUIDv7): Promise<number> {
    return this.db.messagePairs.where("chatId").equals(chatId).count();
  }
}
