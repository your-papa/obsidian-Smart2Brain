import type { GenModelConfig, Language, RegisteredGenProvider } from "papa-ts";
import { getPlugin } from "./state.svelte";
import { getData, type PluginDataStore } from "./dataStore.svelte";
import type {
  IChatPersistence,
  ChatRecordMeta,
  ListMessagesOptions,
} from "../db/persistance";
import { DexiePersistence } from "../db/dexieChatDb";
import { ChatDB } from "../db/chatDbSchema";
import { Notice } from "obsidian";
import { genUUIDv7, type UUIDv7 } from "../utils/uuid7Validator";

/* -----------------------------------------------------------------------------
 * Shared Types
 * ---------------------------------------------------------------------------*/

export enum AssistantState {
  "idle",
  "streaming",
  "success",
  "error",
  "cancelled",
}

export enum MessageState {
  "idle",
  "answering",
  "editing",
}

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
  id: UUIDv7;
  model: ChatModel;
  userMessage: UserMessage;
  assistantMessage: AssistantMessage;
}

export interface ChatPreview {
  id: UUIDv7;
  title: string;
  lastAccessed: Date;
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
  id: UUIDv7;
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
// ChatSession.svelte.ts

export class ChatSession {
  readonly chatId: UUIDv7;
  #title = $state<string>("");
  lastAccessed: Date;
  // Reactive messages array (mutate with push/splice/etc.)
  messages: MessagePair[] = $state<MessagePair[]>([]);

  // Streaming / lifecycle
  private abortController: AbortController | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingText = "";
  private cancelled = false;

  // Reactive UI state (if you read it in the UI)
  messageState = $state<MessageState>(MessageState.idle);

  constructor(
    initial: ChatRecord,
    private persistence: IChatPersistence,
  ) {
    this.chatId = initial.id;
    this.#title = initial.title;
    this.lastAccessed = initial.lastAccessed;

    // Seed messages reactively
    this.messages = initial.messages.slice();
  }

  /** Public snapshot (immutable-ish) */
  get snapshot(): ChatRecord {
    return {
      id: this.chatId,
      title: this.#title,
      lastAccessed: this.lastAccessed,
      messages: this.messages.slice(),
    };
  }

  getTitle(): string {
    return this.#title;
  }

  setTitle(title: string) {
    if (this.#title !== title) {
      this.#title = title;
      this.persistence.updateChatMeta(this.chatId, { title });
    }
  }

  /** Append a message locally (no persistence). */
  private appendLocal(message: MessagePair) {
    this.messages.push(message);
  }

  /** Lookup a message by id */
  private findMessage(id: UUIDv7): MessagePair | undefined {
    return this.messages.find((m) => m.id === id);
  }

  private findMessageIndex(id: UUIDv7): number | undefined {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return undefined;
    return idx;
  }
  /** Build chat history excluding the last (incomplete) message. */
  private buildChatHistory(): string {
    if (this.messages.length === 0) return "";
    return this.messages
      .slice(0, -1)
      .map(
        (p) =>
          `User: ${p.userMessage.content}\nAssistant: ${p.assistantMessage.content}`,
      )
      .join("\n\n");
  }

  async generateNewTitle(content: string, model: ChatModel) {
    const plugin = getPlugin();
    const input = {
      modelConfig: {
        provider: model.provider,
        model: model.model,
        modelConfig: model.modelConfig,
      },
      userQuery: content,
      chatHistory: "",
      lang: "en" as Language,
    };
    this.setTitle(await plugin.papa.generateTitle(input));
  }

  async resendMessage(messageId: UUIDv7, model: ChatModel) {
    const message = this.findMessage(messageId);
    const idx = this.findMessageIndex(messageId);
    if (!(message && idx)) return false;

    //Todo: is it safe to splice proxy Objs?
    this.messages.splice(idx);
    console.log(await this.persistence.dropHistoryAt(this.chatId, messageId));

    const res = await this.sendMessage(
      message.userMessage.content,
      model,
      message.userMessage.attachments,
    );
    if (res) return true;
    return false;
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
    const data = getData();
    if (data.isGeneratingChatTitle && this.messages.length === 0) {
      this.generateNewTitle(content, model);
    }
    const id = genUUIDv7();

    console.log(id);
    const pair: MessagePair = {
      id,
      model: JSON.parse(JSON.stringify(model)),
      userMessage: { content, attachments },
      assistantMessage: { state: AssistantState.idle, content: "" },
    };

    // Optimistic local update (reactive)
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

  /* -----------------------------------------------------------------------
   * Streaming logic
   * ---------------------------------------------------------------------*/

  private scheduleFlush(messageId: UUIDv7) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(async () => {
      const mp = this.findMessage(messageId);
      if (mp) {
        mp.assistantMessage.state = AssistantState.streaming;
        mp.assistantMessage.content = this.pendingText;

        // Granular partial persistence (state + content)
        // await this.persistence.updateAssistantMessagePartial(
        //   this.chatId,
        //   messageId,
        //   {
        //     state: AssistantState.streaming,
        //     content: this.pendingText,
        //   },
        // );
      }
      this.flushTimer = null;
    }, 30); // ~9fps to reduce churn
  }

  private async handleStreamingChunks(
    messageId: UUIDv7,
    stream: AsyncIterable<any>,
  ) {
    for await (const event of stream) {
      if (event.event === "on_parser_stream" && event.data.chunk) {
        this.pendingText += event.data.chunk;
        this.scheduleFlush(messageId);
      }
    }
  }
  private async finalizeAssistantMessage(
    messageId: UUIDv7,
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
    messageId: UUIDv7,
    userContent: string,
    model: ChatModel,
  ) {
    const target = this.findMessage(messageId);
    if (!target) return;

    try {
      this.messageState = MessageState.answering;

      // Mark streaming started
      target.assistantMessage.state = AssistantState.streaming;
      await this.persistence.updateAssistantMessagePartial(
        this.chatId,
        messageId,
        { state: AssistantState.streaming },
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
      await this.finalizeAssistantMessage(messageId, AssistantState.success);
    } catch (err) {
      const failedState: AssistantState = this.cancelled
        ? AssistantState.cancelled
        : AssistantState.error;
      await this.finalizeAssistantMessage(messageId, failedState);
    } finally {
      this.abortController = null;
      this.cancelled = false;
      this.pendingText = "";
      this.messageState = MessageState.idle;
    }
  }

  /* -----------------------------------------------------------------------
   * Utilities exposed for Messenger / consumers
   * ---------------------------------------------------------------------*/

  // If you don't want callers to mutate the array, you can expose a copy,
  // but for reactivity in the UI it’s typical to read session.messages directly.
  getMessages(): MessagePair[] {
    return this.messages;
  }

  addPreloadedMessages(messages: MessagePair[], replace = false) {
    if (replace) {
      this.messages = messages.slice();
    } else {
      // ensure no duplicates
      const existing = new Set(this.messages.map((m) => m.id));
      for (const m of messages) {
        if (!existing.has(m.id)) this.messages.push(m);
      }
    }
  }
}

/* -----------------------------------------------------------------------------
 * Messenger
 *  - Orchestrates sessions
 *  - Uses granular persistence APIs
 * ---------------------------------------------------------------------------*/
export class Messenger {
  private persistence: IChatPersistence;
  private sessions = new Map<string, ChatSession>();
  private pendingLoads = new Map<string, Promise<ChatSession>>();

  constructor(db: ChatDB) {
    this.persistence = new DexiePersistence(db);
  }

  /* ---------------- Chat Creation / Metadata ---------------- */

  async createChat(): Promise<ChatRecord> {
    const data = getData();
    const title = data.defaultChatName;
    const record: ChatRecord = {
      id: genUUIDv7(),
      title,
      lastAccessed: new Date(),
      messages: [],
    };
    await this.persistence.createChat({
      id: record.id,
      title: record.title,
      lastAccessed: record.lastAccessed,
    });
    return record;
  }

  async setTitle(id: UUIDv7, title: string): Promise<boolean> {
    const session = await this.loadChatRecord(id);
    if (!session) return false;
    if (session.title === title) return true;
    await this.persistence.updateChatMeta(id, { title });
    session.title = title;
    return true;
  }

  async loadChatRecord(
    id: UUIDv7,
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

  async deleteChat(id: UUIDv7): Promise<boolean> {
    const info = this.sessions.delete(id);
    console.info("Was an active session", info);
    const ok = await this.persistence.deleteChat(id);
    if (ok) {
      this.sessions.delete(id);
    }
    return ok;
  }

  async branchOffFromMessage(
    chatId: UUIDv7,
    cutoffMessageId: UUIDv7,
  ): Promise<UUIDv7> {
    const lastAccessed = new Date();
    const newChatId = await this.persistence.branchOffFromMessage(
      genUUIDv7(),
      chatId,
      cutoffMessageId,
      lastAccessed,
    );

    return newChatId;
  }

  /* ---------------- Session Management ---------------- */

  async ensureSession(
    chatId: UUIDv7,
    preloadAll = true,
    bumpLastAccessed = true,
  ): Promise<ChatSession> {
    const existing = this.sessions.get(chatId);
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
      this.sessions.set(chatId, session);
      return session;
    })();

    this.pendingLoads.set(chatId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(chatId);
    }
  }

  getSessions(chatId: UUIDv7 | null): ChatSession | null {
    if (!chatId) return null;
    return this.sessions.get(chatId) ?? null;
  }

  /* ---------------- Sending Messages ---------------- */

  async sendMessage(
    currentSession: CurrentSession,
    content: string,
    model: ChatModel,
    attachments?: File[],
  ): Promise<string> {
    if (!currentSession.session) {
      const newChat = await this.createChat();
      new Notice("New chat created");
      currentSession.session = await this.ensureSession(newChat.id);
    }
    return currentSession.session.sendMessage(content, model, attachments);
  }

  getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  /* ---------------- Dirty Response Cleanup ---------------- */

  async findDirtyResponses(): Promise<ChatRecord[]> {
    const previews = await this.listChats();
    const dirty: ChatRecord[] = [];
    for (const p of previews) {
      const rec = await this.loadChatRecord(p.id);
      if (!rec) continue;
      if (
        rec.messages.some(
          (m) => m.assistantMessage.state === AssistantState.streaming,
        )
      ) {
        dirty.push(rec);
      }
    }
    return dirty;
  }

  async cleanupDirtyResponses(): Promise<void> {
    const dirtyChats = await this.findDirtyResponses();
    for (const chat of dirtyChats) {
      for (const mp of chat.messages) {
        if (mp.assistantMessage.state === AssistantState.streaming) {
          mp.assistantMessage.state = AssistantState.error;
          mp.assistantMessage.content =
            mp.assistantMessage.content || "Response interrupted";
          await this.persistence.updateAssistantMessagePartial(chat.id, mp.id, {
            state: AssistantState.error,
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

export class CurrentSession {
  session: ChatSession | null = $state(null);
}
