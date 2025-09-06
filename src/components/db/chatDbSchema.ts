import Dexie, { type Table } from "dexie";
import { type AssistantState } from "../Chat/chatState.svelte";

/**
 * Chat metadata row.
 *
 * NOTE:
 * - `createdAt` was implicitly indexed in the original schema but not present in the interface.
 *   In schema version 2 we formally add it and backfill from `lastAccessed` when missing.
 */
export interface ChatRow {
  id: string;
  title: string;
  lastAccessed: string; // ISO string
  createdAt: string; // ISO string (added formally in v2)
  msgCount: number;
}

/**
 * Individual message pair (user + assistant).
 * Stored separately to avoid rewriting the entire chat document on every message.
 */
export interface MessagePairRow {
  id: string;
  chatId: string;
  timestamp: string; // ISO string (creation time of the user message)
  modelProvider: string;
  modelName: string;
  userContent: string;
  assistantState: AssistantState;
  assistantContent: string;
}

/**
 * Dexie database with:
 * - `chats`       : metadata per chat
 * - `messagePairs`: individual message pairs (one row per user+assistant turn)
 *
 * Index Strategy (v2):
 *  Primary Keys:
 *    - chats: id
 *    - messagePairs: id
 *
 *  Secondary / Compound Indexes:
 *    - chats: lastAccessed, createdAt
 *    - messagePairs:
 *        chatId                (fast filter by chat)
 *        timestamp             (enable global chronological scans if ever needed)
 *        [chatId+timestamp]    (ordered retrieval of messages for a chat)
 *        [chatId+assistantState] (find all messages in a chat by assistant state)
 *        [chatId+modelProvider]  (analytics or filtering per provider)
 *        [chatId+modelName]      (analytics or filtering per model)
 *
 *  Rationale:
 *   - The compound [chatId+timestamp] index allows efficient range queries to fetch
 *     all messages in chronological order without scanning other chats.
 *   - The additional compound indexes are optional "nice to have" for state repair,
 *     analytics, or filtering. Remove if you want to keep schema leaner.
 */
export class ChatDB extends Dexie {
  chats!: Table<ChatRow, string>;
  messagePairs!: Table<MessagePairRow, string>;

  constructor(name = "smart-second-brain-db") {
    super(name);

    /**
     * Version 1 (original):
     *  - chats: "id, lastAccessed, createdAt"
     *  - messagePairs: "id, chatId, timestamp"
     *
     * (Kept for upgrade path; DO NOT REMOVE to allow existing user data migration.)
     */
    this.version(1).stores({
      chats: "id, lastAccessed, createdAt",
      messagePairs: "id, chatId, timestamp",
    });

    /**
     * Version 2:
     *  - Formalize `createdAt` field in ChatRow
     *  - Add compound / analytical indexes on messagePairs
     */
    this.version(2)
      .stores({
        chats: "id, lastAccessed, createdAt",
        // Dexie index string:
        // primaryKey, simple indexes, then compound indexes inside []
        messagePairs:
          "id, chatId, timestamp, [chatId+timestamp], [chatId+assistantState], [chatId+modelProvider], [chatId+modelName]",
      })
      .upgrade(async (tx) => {
        // Backfill createdAt if missing (some rows from v1 might not have it stored)
        await tx
          .table<ChatRow>("chats")
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) {
              row.createdAt = row.lastAccessed || new Date().toISOString();
            }
            // msgCount retained; if ever needed you could recompute via counting messagePairs
          });
        // No structural changes required for messagePairs; existing rows are valid.
      });
  }
}
