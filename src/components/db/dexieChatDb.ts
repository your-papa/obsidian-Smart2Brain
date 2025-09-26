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
import {
  ChatDB,
  ChatRow,
  MessagePairRow,
  ChatMessageRow,
} from "./chatDbSchema";
import { Dexie } from "dexie";
import type { UUIDv7 } from "../../utils/uuid7Validator";
import { Notice } from "obsidian";

/**
 * DexiePersistence
 * Refactored to use `messagePointers` as the association (join) table between chats
 * and message pairs. `MessagePairRow` no longer contains a `chatId`.
 *
 * Public METHODS:
 *  - listChats()
 *  - loadChatMeta()
 *  - createChat()
 *  - updateChatMeta()
 *  - deleteChat()
 *  - getMessages()
 *  - getMessage()
 *  - addMessage()
 *  - upsertMessage()
 *  - dropHistoryAt()
 *  - updateAssistantMessagePartial()
 *  - deleteMessage()
 *  - countMessages()
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
      userMessage: { content: row.userContent },
      assistantMessage: {
        state: row.assistantState,
        content: row.assistantContent,
      },
    };
  }

  private async internalIncrementMsgCount(chatId: UUIDv7): Promise<void> {
    // Recompute count from pointer table to avoid races.
    const count = await this.db.messagePointers
      .where("chatId")
      .equals(chatId)
      .count();
    await this.db.chats.update(chatId, { msgCount: count });
  }

  private async pointerExists(
    chatId: UUIDv7,
    messageId: UUIDv7,
  ): Promise<boolean> {
    return (
      (await this.db.messagePointers
        .where("[chatId+messageId]")
        .equals([chatId, messageId])
        .count()) > 0
    );
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
      lastAccessed: new Date(r.lastAccessed),
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
  }): Promise<UUIDv7> {
    const { id, title, lastAccessed } = chatLike;

    await this.db.chats.add({
      id,
      title,
      lastAccessed: lastAccessed.toISOString(),
      msgCount: 0,
      parentChatId: null,
    });

    return id;
  }
  async branchOffFromMessage(
    newChatId: UUIDv7,
    parentChatId: UUIDv7,
    cutoffMessageId: UUIDv7,
    lastAccessed: Date,
  ): Promise<UUIDv7> {
    return this.db.transaction(
      "rw",
      this.db.chats,
      this.db.messagePointers,
      this.db.messagePairs,
      async () => {
        const parent = await this.db.chats.get(parentChatId);
        if (!parent) throw new Error(`Parent chat ${parentChatId} not found`);

        const cutoffPointer = await this.db.messagePointers
          .where("[chatId+messageId]")
          .equals([parentChatId, cutoffMessageId])
          .first();
        if (!cutoffPointer) {
          throw new Error(
            `cutoffMessageId ${cutoffMessageId} not found in parent chat ${parentChatId}`,
          );
        }

        await this.db.chats.add({
          id: newChatId,
          title: `<Branch> ${parent.title}`,
          lastAccessed: lastAccessed.toISOString(),
          msgCount: 0,
          parentChatId: parentChatId,
        });

        // Collect pointers up to (and including) cutoff
        const parentPointers = await this.db.messagePointers
          .where("[chatId+messageId]")
          .between(
            [parentChatId, Dexie.minKey],
            [parentChatId, cutoffMessageId],
          )
          .toArray();

        if (!parentPointers.length) {
          return [];
        }

        const newPointers: ChatMessageRow[] = parentPointers.map((p) => ({
          chatId: newChatId,
          messageId: p.messageId,
        }));

        await this.db.messagePointers.bulkAdd(newPointers);

        await this.db.chats.update(newChatId, {
          msgCount: newPointers.length,
        });

        return newChatId;
      },
    );
  }

  async updateChatMeta(
    id: UUIDv7,
    patch: Partial<Omit<ChatRecordMeta, "UUIDv7" | "msgCount">>,
  ): Promise<void> {
    const update: Partial<ChatRow> = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.lastAccessed !== undefined)
      update.lastAccessed = patch.lastAccessed.toISOString();
    if (Object.keys(update).length) {
      await this.db.chats.update(id, update);
    }
  }

  async deleteChat(chatId: UUIDv7): Promise<boolean> {
    try {
      const deleted = await this.db.transaction(
        "rw",
        this.db.chats,
        this.db.messagePointers,
        this.db.messagePairs,
        async () => {
          const chatRow = await this.db.chats.get(chatId);
          if (!chatRow) return false;

          // Gather all pointers first
          const pointers = await this.db.messagePointers
            .where("chatId")
            .equals(chatId)
            .toArray();

          const msgIds = [...new Set(pointers.map((p) => p.messageId))];

          // Delete pointers + chat row
          await this.db.messagePointers.where("chatId").equals(chatId).delete();
          await this.db.chats.delete(chatId);

          // Clean up orphaned messagePairs
          if (msgIds.length) {
            const stillReferenced = new Set(
              await this.db.messagePointers
                .where("messageId")
                .anyOf(msgIds)
                .distinct()
                .keys(),
            );
            const orphanIds = msgIds.filter((id) => !stillReferenced.has(id));
            if (orphanIds.length) {
              await this.db.messagePairs.bulkDelete(orphanIds);
            }
          }
          return true;
        },
      );
      return deleted;
    } catch (err: any) {
      new Notice("deleteChat failed: " + err?.message);
      return false;
    }
  }

  /* =========================================================
   * Message-Level APIs
   * =======================================================*/

  async getMessages(
    chatId: UUIDv7,
    options: ListMessagesOptions = {},
  ): Promise<MessagePair[]> {
    const { offset = 0, limit, order = "asc" } = options;

    // Query pointers ordered by messageId (UUIDv7 should preserve chronological order)
    let pointerColl = this.db.messagePointers
      .where("[chatId+messageId]")
      .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]);

    if (order === "desc") pointerColl = pointerColl.reverse();
    if (offset) pointerColl = pointerColl.offset(offset);
    if (limit !== undefined) pointerColl = pointerColl.limit(limit);

    const pointers = await pointerColl.toArray();
    if (!pointers.length) return [];

    const ids = pointers.map((p) => p.messageId);
    const rows = await this.db.messagePairs.bulkGet(ids);

    // Preserve pointer-derived order
    const rowMap = new Map(rows.filter(Boolean).map((r) => [r!.id, r!]));
    return ids
      .map((id) => rowMap.get(id))
      .filter((r): r is MessagePairRow => !!r)
      .map((r) => this.rowToMessagePair(r));
  }

  async getMessage(
    chatId: UUIDv7,
    messageId: UUIDv7,
  ): Promise<MessagePair | null> {
    const pointer = await this.db.messagePointers
      .where("[chatId+messageId]")
      .equals([chatId, messageId])
      .first();
    if (!pointer) return null;
    const row = await this.db.messagePairs.get(messageId);
    if (!row) return null;
    return this.rowToMessagePair(row);
  }

  async addMessage(chatId: UUIDv7, message: MessagePair): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.messagePairs,
      this.db.messagePointers,
      this.db.chats,
      async () => {
        const existingPair = await this.db.messagePairs.get(message.id);
        if (existingPair) {
          throw new Error(
            `Message with id ${message.id} already exists (add to chat ${chatId}).`,
          );
        }

        console.log(`Adding message with id ${message.id} to chat ${chatId}`);

        const row: MessagePairRow = {
          id: message.id,
          model: message.model,
          userContent: message.userMessage.content,
          assistantState: message.assistantMessage.state,
          assistantContent: message.assistantMessage.content,
        };

        await this.db.messagePairs.add(row);
        await this.db.messagePointers.add({
          chatId,
          messageId: message.id,
        });

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
      this.db.messagePointers,
      this.db.chats,
      async () => {
        const prior = await this.db.messagePairs.get(message.id);

        const row: MessagePairRow = {
          id: message.id,
          model: message.model,
          userContent: message.userMessage.content,
          assistantState: message.assistantMessage.state,
          assistantContent: message.assistantMessage.content,
        };

        await this.db.messagePairs.put(row);

        if (!(await this.pointerExists(chatId, message.id))) {
          await this.db.messagePointers.add({
            chatId,
            messageId: message.id,
          } as ChatMessageRow);
        }

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
      this.db.messagePointers,
      this.db.messagePairs,
      this.db.chats,
      async () => {
        // Verify message belongs to chat
        if (!(await this.pointerExists(chatId, messageId))) return false;

        // Get all pointers from target messageId forward
        const pointersToDelete = await this.db.messagePointers
          .where("[chatId+messageId]")
          .between([chatId, messageId], [chatId, Dexie.maxKey])
          .toArray();

        if (!pointersToDelete.length) return false;

        const ids = pointersToDelete.map((p) => p.messageId);

        // Delete those pointers
        await this.db.messagePointers
          .where("[chatId+messageId]")
          .between([chatId, messageId], [chatId, Dexie.maxKey])
          .delete();

        // Remove orphaned messagePairs
        const stillReferenced = new Set(
          await this.db.messagePointers
            .where("messageId")
            .anyOf(ids)
            .distinct()
            .keys(),
        );
        const orphanIds = ids.filter((id) => !stillReferenced.has(id));
        if (orphanIds.length) {
          await this.db.messagePairs.bulkDelete(orphanIds);
        }

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
    if (patch.state !== undefined) allowed.assistantState = patch.state;
    if (patch.content !== undefined) allowed.assistantContent = patch.content;
    if (!Object.keys(allowed).length) return;

    await this.db.transaction(
      "rw",
      this.db.messagePointers,
      this.db.messagePairs,
      async () => {
        const pointer = await this.db.messagePointers
          .where("[chatId+messageId]")
          .equals([chatId, messageId])
          .first();
        if (!pointer) {
          throw new Error(
            `Message ${messageId} does not belong to chat ${chatId}.`,
          );
        }
        await this.db.messagePairs.update(messageId, allowed);
      },
    );
  }

  async deleteMessage(chatId: UUIDv7, messageId: UUIDv7): Promise<boolean> {
    return this.db.transaction(
      "rw",
      this.db.messagePointers,
      this.db.messagePairs,
      this.db.chats,
      async () => {
        const pointer = await this.db.messagePointers
          .where("[chatId+messageId]")
          .equals([chatId, messageId])
          .first();
        if (!pointer) return false;

        // Remove pointer
        await this.db.messagePointers
          .where("[chatId+messageId]")
          .equals([chatId, messageId])
          .delete();

        // If no more pointers reference this message, delete the message row
        const stillRefCount = await this.db.messagePointers
          .where("messageId")
          .equals(messageId)
          .count();
        if (stillRefCount === 0) {
          await this.db.messagePairs.delete(messageId);
        }

        await this.internalIncrementMsgCount(chatId);
        return true;
      },
    );
  }

  async countMessages(chatId: UUIDv7): Promise<number> {
    return this.db.messagePointers.where("chatId").equals(chatId).count();
  }
}
