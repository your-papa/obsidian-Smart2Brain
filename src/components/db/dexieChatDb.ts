import type {
  ChatPreview,
  MessagePair,
  AssistantMessage,
} from "../Chat/chatState.svelte";
import type { Chat } from "../Chat/chatState.svelte";
import type {
  IChatPersistence,
  ChatRecordMeta,
  ListMessagesOptions,
} from "./persistance";
import type { ChatDB, ChatRow, MessagePairRow } from "./chatDbSchema";
import { Dexie } from "dexie";

/**
 * DexiePersistence
 * Implements granular, per-message CRUD operations while keeping the old
 * "saveChat(chatId, messagePair)" API for backward compatibility.
 *
 * NEW (preferred) METHODS:
 *  - loadChatMeta()
 *  - getMessages()
 *  - addMessage()
 *  - upsertMessage()
 *  - updateAssistantMessagePartial()
 *  - deleteMessage()
 *
 * LEGACY (still supported):
 *  - loadChat()
 *  - saveChat()
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
      timestamp: new Date(row.timestamp),
      model: {
        provider: row.modelProvider as any,
        model: row.modelName,
      },
      userMessage: {
        content: row.userContent,
      },
      assistantMessage: {
        state: row.assistantState,
        content: row.assistantContent,
      },
    };
  }

  private async internalIncrementMsgCount(chatId: string): Promise<void> {
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
      lastAccessed: r.lastAccessed, // Keep ISO string format for preview
    }));
  }

  /**
   * Legacy full load: returns a Chat instance (to not break existing code).
   * Newer code should prefer: loadChatMeta() + getMessages()
   */
  async loadChat(id: string): Promise<Chat | null> {
    const row = await this.db.chats.get(id);
    if (!row) return null;

    const pairs = await this.db.messagePairs
      .where("[chatId+timestamp]")
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .sortBy("timestamp");

    const messages = pairs.map((p) => this.rowToMessagePair(p));

    // Return plain object matching Chat (ChatRecord) shape for legacy callers
    return {
      id: row.id,
      title: row.title,
      lastAccessed: new Date(row.lastAccessed),
      messages,
    } as Chat;
  }

  async loadChatMeta(id: string): Promise<ChatRecordMeta | null> {
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
    id: string;
    title: string;
    lastAccessed: Date;
    messages?: MessagePair[];
  }): Promise<string> {
    const { id, title, lastAccessed } = chatLike;

    await this.db.chats.add({
      id,
      title,
      lastAccessed: lastAccessed.toISOString(),
      createdAt: lastAccessed.toISOString(),
      msgCount: 0,
    });

    // If initial messages were provided (should be rare), add them:
    if (chatLike.messages && chatLike.messages.length) {
      await this.db.transaction("rw", this.db.messagePairs, async () => {
        for (const m of chatLike.messages!) {
          const row: MessagePairRow = {
            id: m.id,
            chatId: id,
            timestamp: m.timestamp.toISOString(),
            modelProvider: m.model.provider as any,
            modelName: m.model.model,
            userContent: m.userMessage.content,
            assistantState: m.assistantMessage.state,
            assistantContent: m.assistantMessage.content,
          };
          await this.db.messagePairs.put(row);
        }
      });
      await this.internalIncrementMsgCount(id);
    }

    return id;
  }

  async updateChatMeta(
    id: string,
    patch: Partial<Omit<ChatRecordMeta, "id" | "msgCount">>,
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

  async deleteChat(id: string): Promise<boolean> {
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
    chatId: string,
    options: ListMessagesOptions = {},
  ): Promise<MessagePair[]> {
    const { offset = 0, limit, order = "asc" } = options;

    // Retrieve ordered by timestamp via compound index
    let collection = this.db.messagePairs
      .where("[chatId+timestamp]")
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
    chatId: string,
    messageId: string,
  ): Promise<MessagePair | null> {
    const row = await this.db.messagePairs.get(messageId);
    if (!row || row.chatId !== chatId) return null;
    return this.rowToMessagePair(row);
  }

  async addMessage(chatId: string, message: MessagePair): Promise<void> {
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
          timestamp: message.timestamp.toISOString(),
          modelProvider: message.model.provider as any,
          modelName: message.model.model,
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

  async upsertMessage(chatId: string, message: MessagePair): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.messagePairs,
      this.db.chats,
      async () => {
        const prior = await this.db.messagePairs.get(message.id);

        const row: MessagePairRow = {
          id: message.id,
          chatId,
          timestamp: message.timestamp.toISOString(),
          modelProvider: message.model.provider as any,
          modelName: message.model.model,
          userContent: message.userMessage.content,
          assistantState: message.assistantMessage.state,
          assistantContent: message.assistantMessage.content,
        };

        await this.db.messagePairs.put(row);

        await this.db.chats.update(chatId, {
          lastAccessed: new Date().toISOString(),
        });

        if (!prior) {
          // new message -> adjust count
          await this.internalIncrementMsgCount(chatId);
        }
      },
    );
  }

  async updateAssistantMessagePartial(
    chatId: string,
    messageId: string,
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

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
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

  async countMessages(chatId: string): Promise<number> {
    return this.db.messagePairs.where("chatId").equals(chatId).count();
  }

  /* =========================================================
   * Backward Compatibility Aliases
   * =======================================================*/

  /**
   * DEPRECATED: Historically saved "the chat" by passing just the new/updated messagePair.
   * Kept for compatibility; now simply delegates to upsertMessage.
   */
  async saveChat(chatId: string, messagePair: MessagePair): Promise<void> {
    await this.upsertMessage(chatId, messagePair);
  }
}
