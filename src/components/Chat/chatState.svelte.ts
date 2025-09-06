import { v7 as uuidv7 } from "uuid";
import type { GenModelConfig, Language, RegisteredGenProvider } from "papa-ts";
import { writable, type Writable } from "svelte/store";
import { getPlugin } from "../../lib/state.svelte";
import { getData, type PluginDataStore } from "../../lib/data.svelte";
import type {
  IChatPersistence,
  ChatRecordMeta,
  ListMessagesOptions,
} from "../db/persistance";
import { DexiePersistence } from "../db/dexieChatDb";
import { ChatDB } from "../db/chatDbSchema";

/* -----------------------------------------------------------------------------
 * Shared Types
 * ---------------------------------------------------------------------------*/

export type AssistantState =
  | "idle"
  | "streaming"
  | "success"
  | "error"
  | "cancelled";

export interface UserMessage {
  content: string;
  attachments?: File[];
}

export interface AssistantMessage {
  state: AssistantState;
  content: string;
  nerd_stats?: {
    tokensPerSecond: number;
    retrievedDocsNum: number;
    genModelConfig: GenModelConfig;
  };
  errorCode?: string;
}

export interface MessagePair {
  id: string;
  timestamp: Date;
  model: { provider: RegisteredGenProvider; model: string };
  userMessage: UserMessage;
  assistantMessage: AssistantMessage;
}

export interface ChatPreview {
  id: string;
  title: string;
  lastAccessed: string;
}

export interface ChatModel {
  model: string;
  provider: RegisteredGenProvider;
  modelConfig: GenModelConfig;
}

/**
 * In-memory representation of a chat with (optionally) loaded messages.
 * For compatibility with legacy code that imported/expected `Chat`.
 */
export interface ChatRecord {
  id: string;
  title: string;
  lastAccessed: Date;
  messages: MessagePair[];
}

export type Chat = ChatRecord; // Backward compatibility alias

/* -----------------------------------------------------------------------------
 * ChatSession
 *  - Ephemeral per-chat runtime state (streaming, abort, reactive messages)
 *  - Uses granular persistence API (addMessage + assistant partial updates)
 * ---------------------------------------------------------------------------*/
export class ChatSession {
  readonly chatId: string;
  title: string;
  lastAccessed: Date;

  // Reactive messages store for UI components to subscribe.
  readonly messagesStore: Writable<MessagePair[]>;
  // Local array backing the store.
  private _messages: MessagePair[] = [];

  // Streaming / lifecycle
  private abortController: AbortController | null = null;
  private flushTimer: any = null;
  private pendingText = "";
  private cancelled = false;

  messageState: "idle" | "answering" | "editing" = "idle";

  constructor(
    initial: ChatRecord,
    private persistence: IChatPersistence,
  ) {
    this.chatId = initial.id;
    this.title = initial.title;
    this.lastAccessed = initial.lastAccessed;
    this._messages = initial.messages.slice();
    this.messagesStore = writable(this._messages);
  }

  /** Internal helper: push updates to Svelte store */
  private updateMessagesStore() {
    this.messagesStore.set(this._messages);
  }

  /** Public snapshot (immutable-ish) */
  get snapshot(): ChatRecord {
    return {
      id: this.chatId,
      title: this.title,
      lastAccessed: this.lastAccessed,
      messages: this._messages,
    };
  }

  /** Append a message locally (no persistence). */
  private appendLocal(message: MessagePair) {
    this._messages.push(message);
    this.updateMessagesStore();
  }

  /** Lookup a message by id */
  private findMessage(id: string): MessagePair | undefined {
    return this._messages.find((m) => m.id === id);
  }

  /** Build chat history excluding the last (incomplete) message. */
  private buildChatHistory(): string {
    if (this._messages.length === 0) return "";
    return this._messages
      .slice(0, -1)
      .map(
        (p) =>
          `User: ${p.userMessage.content}\nAssistant: ${p.assistantMessage.content}`,
      )
      .join("\n\n");
  }

  /**
   * Send a user message:
   *  - Create MessagePair (assistant idle)
   *  - Persist via addMessage
   *  - Kick off streaming process
   */
  async sendMessage(
    content: string,
    model: ChatModel,
    attachments: File[] | undefined,
  ): Promise<string> {
    const id = uuidv7();
    const pair: MessagePair = {
      id,
      timestamp: new Date(),
      model: { provider: model.provider, model: model.model },
      userMessage: { content, attachments },
      assistantMessage: { state: "idle", content: "" },
    };

    // Optimistic local update
    this.appendLocal(pair);

    // Persist initial (user) turn
    await this.persistence.addMessage(this.chatId, pair);

    // Update global "last active" marker
    getData().setLastActiveChatId(this.chatId);

    // Stream assistant reply (fire & forget)
    void this.processAssistantReply(id, content, model);

    return id;
  }

  /** Abort current streaming (if any) */
  stopStreaming(): void {
    if (!this.abortController) {
      throw new Error("No active stream to abort");
    }
    this.cancelled = true;
    this.abortController.abort();
  }

  /* ---------------------------------------------------------------------------
   * Streaming logic
   * -------------------------------------------------------------------------*/

  private scheduleFlush(messageId: string) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(async () => {
      const mp = this.findMessage(messageId);
      if (mp) {
        mp.assistantMessage.state = "streaming";
        mp.assistantMessage.content = this.pendingText;
        this.updateMessagesStore();

        // Granular partial persistence (state + content)
        await this.persistence.updateAssistantMessagePartial(
          this.chatId,
          messageId,
          {
            state: "streaming",
            content: this.pendingText,
          },
        );
      }
      this.flushTimer = null;
    }, 110); // ~9fps to reduce churn
  }

  private async handleStreamingChunks(
    messageId: string,
    stream: AsyncIterable<any>,
  ) {
    for await (const chunk of stream) {
      if (chunk?.content !== undefined) {
        this.pendingText = chunk.content;
        this.scheduleFlush(messageId);
      }
    }
  }

  private async finalizeAssistantMessage(
    messageId: string,
    finalState: AssistantState,
  ) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const mp = this.findMessage(messageId);
    if (!mp) return;

    mp.assistantMessage.state = finalState;
    mp.assistantMessage.content = this.pendingText;
    this.updateMessagesStore();

    await this.persistence.updateAssistantMessagePartial(
      this.chatId,
      messageId,
      {
        state: finalState,
        content: this.pendingText,
      },
    );
  }

  private async processAssistantReply(
    messageId: string,
    userContent: string,
    model: ChatModel,
  ) {
    const target = this.findMessage(messageId);
    if (!target) return;

    try {
      this.messageState = "answering";

      // Mark streaming started
      target.assistantMessage.state = "streaming";
      this.updateMessagesStore();
      await this.persistence.updateAssistantMessagePartial(
        this.chatId,
        messageId,
        { state: "streaming" },
      );

      const plugin = getPlugin();
      const input = {
        modelConfig: {
          provider: model.provider,
          model: model.model,
          modelConfig: model.modelConfig,
        },
        userQuery: userContent,
        chatHistory: this.buildChatHistory(),
        lang: "en" as Language,
      };

      const [stream, abortController] = plugin.papa.run(input);
      this.abortController = abortController;

      await this.handleStreamingChunks(messageId, stream);

      // Final success
      await this.finalizeAssistantMessage(messageId, "success");
    } catch (err) {
      const failedState: AssistantState = this.cancelled
        ? "cancelled"
        : "error";
      await this.finalizeAssistantMessage(messageId, failedState);
    } finally {
      this.abortController = null;
      this.cancelled = false;
      this.pendingText = "";
      this.messageState = "idle";
    }
  }

  /* ---------------------------------------------------------------------------
   * Utilities exposed for Messenger / consumers
   * -------------------------------------------------------------------------*/
  getMessages(): MessagePair[] {
    return this._messages;
  }

  addPreloadedMessages(messages: MessagePair[], replace = false) {
    if (replace) {
      this._messages = messages.slice();
    } else {
      // ensure no duplicates
      const existing = new Set(this._messages.map((m) => m.id));
      for (const m of messages) {
        if (!existing.has(m.id)) this._messages.push(m);
      }
    }
    this.updateMessagesStore();
  }
}

/* -----------------------------------------------------------------------------
 * Messenger
 *  - Orchestrates sessions
 *  - Uses granular persistence APIs
 * ---------------------------------------------------------------------------*/
export class Messenger {
  private persistence: IChatPersistence;
  private activeSessions = new Map<string, ChatSession>();
  private pendingLoads = new Map<string, Promise<ChatSession>>();

  constructor(db: ChatDB) {
    this.persistence = new DexiePersistence(db);
  }

  /* ---------------- Chat Creation / Metadata ---------------- */

  async createChat(): Promise<ChatRecord> {
    const data = getData();
    const title = data.defaultChatName;
    const record: ChatRecord = {
      id: uuidv7(),
      title,
      lastAccessed: new Date(),
      messages: [],
    };
    await this.persistence.createChat({
      id: record.id,
      title: record.title,
      lastAccessed: record.lastAccessed,
      messages: [],
    });
    return record;
  }

  async loadChatRecord(
    id: string,
    options?: ListMessagesOptions,
  ): Promise<ChatRecord | null> {
    const meta = await this.persistence.loadChatMeta(id);
    if (!meta) return null;
    const messages = await this.persistence.getMessages(id, options);
    return {
      id: meta.id,
      title: meta.title,
      lastAccessed: meta.lastAccessed,
      messages,
    };
  }

  listChats(): Promise<ChatPreview[]> {
    return this.persistence.listChats();
  }

  async deleteChat(id: string): Promise<boolean> {
    const ok = await this.persistence.deleteChat(id);
    if (ok) {
      this.activeSessions.delete(id);
    }
    return ok;
  }

  /* ---------------- Session Management ---------------- */

  async ensureSession(
    chatId: string,
    preloadAll = true,
    bumpLastAccessed = true,
  ): Promise<ChatSession> {
    const existing = this.activeSessions.get(chatId);
    if (existing) {
      if (bumpLastAccessed) {
        existing.lastAccessed = new Date();
        // Optional: await this.persistence.updateChatMeta(chatId, { lastAccessed: existing.lastAccessed });
      }
      return existing;
    }

    const inflight = this.pendingLoads.get(chatId);
    if (inflight) return inflight;

    const promise = (async () => {
      const meta = await this.persistence.loadChatMeta(chatId);
      if (!meta) throw new Error(`Chat ${chatId} not found`);

      let messages: MessagePair[] = [];
      if (preloadAll) {
        messages = await this.persistence.getMessages(chatId);
      }

      const record: ChatRecord = {
        id: meta.id,
        title: meta.title,
        lastAccessed: bumpLastAccessed ? new Date() : meta.lastAccessed,
        messages,
      };

      if (bumpLastAccessed) {
        await this.persistence.updateChatMeta(chatId, {
          lastAccessed: record.lastAccessed,
        });
      }

      const session = new ChatSession(record, this.persistence);
      this.activeSessions.set(chatId, session);
      return session;
    })();

    this.pendingLoads.set(chatId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(chatId);
    }
  }

  getSession(chatId: string): ChatSession | null {
    return this.activeSessions.get(chatId) ?? null;
  }

  /* ---------------- Sending Messages ---------------- */

  // Overload signatures for backward compatibility
  async sendMessage(
    chatId: string,
    content: string,
    model: ChatModel,
    attachments?: File[],
  ): Promise<string>;
  async sendMessage(
    session: ChatSession,
    content: string,
    model: ChatModel,
    attachments?: File[],
  ): Promise<string>;
  async sendMessage(
    sessionOrId: string | ChatSession,
    content: string,
    model: ChatModel,
    attachments?: File[],
  ): Promise<string> {
    let session: ChatSession;
    if (typeof sessionOrId === "string") {
      session = await this.ensureSession(sessionOrId);
    } else {
      session = sessionOrId;
    }
    return session.sendMessage(content, model, attachments);
  }

  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  /* ---------------- Dirty Response Cleanup ---------------- */

  async findDirtyResponses(): Promise<ChatRecord[]> {
    const previews = await this.listChats();
    const dirty: ChatRecord[] = [];
    for (const p of previews) {
      const rec = await this.loadChatRecord(p.id);
      if (!rec) continue;
      if (rec.messages.some((m) => m.assistantMessage.state === "streaming")) {
        dirty.push(rec);
      }
    }
    return dirty;
  }

  async cleanupDirtyResponses(): Promise<void> {
    const dirtyChats = await this.findDirtyResponses();
    for (const chat of dirtyChats) {
      for (const mp of chat.messages) {
        if (mp.assistantMessage.state === "streaming") {
          mp.assistantMessage.state = "error";
          mp.assistantMessage.content =
            mp.assistantMessage.content || "Response interrupted";
          await this.persistence.updateAssistantMessagePartial(chat.id, mp.id, {
            state: "error",
            content: mp.assistantMessage.content,
          });
        }
      }
    }
  }
}

/* -----------------------------------------------------------------------------
 * Singleton helpers (unchanged pattern)
 * ---------------------------------------------------------------------------*/
let messengerSingleton: Messenger | null = null;

export function createMessenger(db: ChatDB): Messenger {
  if (!messengerSingleton) {
    messengerSingleton = new Messenger(db);
  }
  return messengerSingleton;
}

export function getMessenger(): Messenger | null {
  return messengerSingleton;
}

/**
 * Retrieve the last active chat (if exists) or create a new one.
 */
export async function getLastActiveChatId(
  messenger: Messenger,
  dataStore: PluginDataStore,
): Promise<ChatRecord> {
  // 1. Try stored last active id
  const lastId = dataStore.getLastActiveChatId();
  if (lastId) {
    const rec = await messenger.loadChatRecord(lastId);
    if (rec) return rec;
  }

  // 2. Fallback: if there are existing chats, reuse the most recently accessed
  // (listChats() returns rows ordered by lastAccessed DESC in DexiePersistence)
  const previews = await messenger.listChats();
  if (previews.length) {
    const fallback = await messenger.loadChatRecord(previews[0].id);
    if (fallback) {
      // Persist this as the new last active for next load
      dataStore.setLastActiveChatId(fallback.id);
      return fallback;
    }
  }

  // 3. No existing chats -> create a new one
  const created = await messenger.createChat();
  dataStore.setLastActiveChatId(created.id);
  return created;
}
