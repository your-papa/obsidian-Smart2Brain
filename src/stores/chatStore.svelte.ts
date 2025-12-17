import { getPlugin } from "./state.svelte";
import { getData } from "./dataStore.svelte";
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

export type ToolCallStatus = "running" | "completed";

export interface ToolCallState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: ToolCallStatus;
  output?: unknown;
}

export interface UserMessage {
  content: string;
  attachments?: File[];
}

export interface AssistantMessage {
  state: AssistantState;
  content: string;
  toolCalls?: ToolCallState[];
  nerd_stats?: {
    tokensPerSecond: number;
    retrievedDocsNum: number;
    genModelConfig: any;
  };
  errorCode?: string;
}

export interface MessagePair {
  id: UUIDv7;
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
  provider: any;
  modelConfig: any;
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

type StreamRole = "user" | "assistant" | "tool";

interface NormalizedToolCall {
  id: string;
  name: string;
  arguments?: unknown;
  input?: unknown;
}

interface NormalizedMessage {
  id?: string;
  role: StreamRole;
  content?: unknown;
  toolCalls?: NormalizedToolCall[];
  tool_call_id?: string;
  toolCallId?: string;
  name?: string;
}

type StreamChunk =
  | { type: "token"; token?: string; messages?: NormalizedMessage[] }
  | { type: "result"; result?: { messages?: NormalizedMessage[] } }
  | { type: "message"; messages: NormalizedMessage[] };

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
  private cancelled = false;

  // Reactive UI state (if you read it in the UI)
  messageState = $state<MessageState>(MessageState.idle);

  constructor(initial: ChatRecord) {
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

  // async generateNewTitle(content: string, model: ChatModel) {
  //   const plugin = getPlugin();
  //   const input = {
  //     modelConfig: {
  //       provider: model.provider,
  //       model: model.model,
  //       modelConfig: model.modelConfig,
  //     },
  //     userQuery: content,
  //     chatHistory: "",
  //     lang: "en" as Language,
  //   };
  //   this.setTitle(await plugin.papa.generateTitle(input));
  // }

  async resendMessage(messageId: UUIDv7, model: ChatModel) {
    const message = this.findMessage(messageId);
    const idx = this.findMessageIndex(messageId);
    if (!(message && idx)) return false;

    //Todo: is it safe to splice proxy Objs?
    this.messages.splice(idx);

    const res = await this.sendMessage(
      message.userMessage.content,
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
    attachments: File[] | undefined,
  ): Promise<string> {
    const data = getData();
    // if (data.isGeneratingChatTitle && this.messages.length === 0) {
    //   this.generateNewTitle(content, model);
    // }
    const id = genUUIDv7();

    console.log(id);
    const pair: MessagePair = {
      id,
      userMessage: { content, attachments },
      assistantMessage: { state: AssistantState.idle, content: "" },
    };

    // Optimistic local update (reactive)
    this.appendLocal(pair);

    // Update global "last active" marker
    getData().setLastActiveChatId(this.chatId);

    // Stream assistant reply (fire & forget)
    void this.processAssistantReply(id, content);

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

  private appendToken(message: AssistantMessage, token: string) {
    if (!token) return;
    message.content += token;
  }

  private normalizeToolInput(raw: unknown): Record<string, unknown> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        return { value: parsed };
      } catch {
        return { input: raw };
      }
    }
    if (Array.isArray(raw)) return { value: raw };
    if (typeof raw === "object") return raw as Record<string, unknown>;
    return { value: raw };
  }

  private upsertToolCall(
    message: AssistantMessage,
    tc: NormalizedToolCall,
  ): ToolCallState {
    if (!message.toolCalls) message.toolCalls = [];
    const idx = message.toolCalls.findIndex((t) => t.id === tc.id);
    const base: ToolCallState = {
      id: tc.id,
      name: tc.name,
      input: this.normalizeToolInput(tc.arguments ?? tc.input),
      status: "running",
    };
    if (idx >= 0) {
      message.toolCalls[idx] = {
        ...base,
        output: message.toolCalls[idx].output,
        status: message.toolCalls[idx].status,
      };
      return message.toolCalls[idx];
    }
    message.toolCalls.push(base);
    return base;
  }

  private attachToolOutput(
    message: AssistantMessage,
    toolCallId: string,
    output: unknown,
    name?: string,
  ) {
    if (!message.toolCalls) message.toolCalls = [];
    const idx = message.toolCalls.findIndex((t) => t.id === toolCallId);
    if (idx >= 0) {
      message.toolCalls[idx] = {
        ...message.toolCalls[idx],
        status: "completed",
        output,
      };
      return;
    }
    message.toolCalls.push({
      id: toolCallId,
      name: name ?? "tool",
      input: {},
      status: "completed",
      output,
    });
  }

  private async processAssistantReply(messageId: UUIDv7, userContent: string) {
    const target = this.findMessage(messageId);
    if (!target) return;
    console.log("target foudnd");
    try {
      this.messageState = MessageState.answering;

      // Mark streaming started
      target.assistantMessage.state = AssistantState.streaming;

      const plugin = getPlugin();
      const stream = plugin.agentManager.streamQuery(
        userContent,
        String(this.chatId),
      ) as AsyncIterable<StreamChunk>;

      const assistantMsg = target.assistantMessage;

      const normalizeMessages = (chunk: StreamChunk): NormalizedMessage[] => {
        if (chunk.type === "message") return chunk.messages ?? [];
        if (chunk.type === "result") return chunk.result?.messages ?? [];
        return [];
      };

      const applyNormalizedMessages = (
        normalizedMessages: NormalizedMessage[],
      ) => {
        if (!normalizedMessages.length) return;

        for (const msg of normalizedMessages) {
          switch (msg.role) {
            case "assistant": {
              if (msg.toolCalls?.length) {
                for (const tc of msg.toolCalls) {
                  this.upsertToolCall(assistantMsg, tc);
                }
              }
              if (msg.content !== undefined) {
                assistantMsg.content = String(msg.content ?? "");
              }
              break;
            }
            case "tool": {
              const toolCallId = (msg.tool_call_id ||
                (msg as any).toolCallId) as string | undefined;
              if (toolCallId) {
                this.attachToolOutput(
                  assistantMsg,
                  toolCallId,
                  msg.content,
                  msg.name,
                );
              }
              break;
            }
            default:
              break;
          }
        }
      };

      for await (const chunk of stream) {
        if (chunk.type === "token") {
          console.log(chunk.token);
          this.appendToken(assistantMsg, chunk.token ?? "");
          continue;
        }

        const normalizedMessages = normalizeMessages(chunk);
        applyNormalizedMessages(normalizedMessages);

        if (chunk.type === "result" && normalizedMessages.length) {
          const lastMsg = normalizedMessages[normalizedMessages.length - 1];
          if (lastMsg.role === "assistant") {
            assistantMsg.content = String(lastMsg.content ?? "");
          }
        }
      }

      target.assistantMessage.state = AssistantState.success;
    } catch (err) {
      const failedState: AssistantState = this.cancelled
        ? AssistantState.cancelled
        : AssistantState.error;
      target.assistantMessage.state = failedState;
    } finally {
      this.abortController = null;
      this.cancelled = false;
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
  private sessions = new Map<string, ChatSession>();
  private records = new Map<string, ChatRecord>();
  private pendingLoads = new Map<string, Promise<ChatSession>>();

  constructor() {}

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
    this.records.set(record.id, record);
    return record;
  }

  async setTitle(id: UUIDv7, title: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.title === title) return true;
    record.title = title;
    const session = this.sessions.get(id);
    if (session) session.setTitle(title);
    return true;
  }

  async loadChatRecord(id: UUIDv7): Promise<ChatRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listChats(): Promise<ChatPreview[]> {
    return Array.from(this.records.values()).map((r) => ({
      id: r.id,
      title: r.title,
      lastAccessed: r.lastAccessed,
    }));
  }

  async deleteChat(id: UUIDv7): Promise<boolean> {
    this.sessions.delete(id);
    return this.records.delete(id);
  }

  async branchOffFromMessage(
    chatId: UUIDv7,
    cutoffMessageId: UUIDv7,
  ): Promise<UUIDv7> {
    const source = this.records.get(chatId);
    if (!source) return genUUIDv7();
    const cutoffIndex = source.messages.findIndex(
      (m) => m.id === cutoffMessageId,
    );
    const sliceEnd =
      cutoffIndex >= 0 ? cutoffIndex + 1 : source.messages.length;
    const newChatId = genUUIDv7();
    const cloned: ChatRecord = {
      id: newChatId,
      title: `${source.title} (branch)`,
      lastAccessed: new Date(),
      messages: source.messages.slice(0, sliceEnd).map((m) => ({
        ...m,
        id: genUUIDv7(),
      })),
    };
    this.records.set(newChatId, cloned);
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
      }
      return existing;
    }

    const inflight = this.pendingLoads.get(chatId);
    if (inflight) return inflight;

    const promise = (async () => {
      const record = this.records.get(chatId);
      if (!record) throw new Error(`Chat ${chatId} not found`);

      const hydrated: ChatRecord = {
        ...record,
        lastAccessed: bumpLastAccessed ? new Date() : record.lastAccessed,
        messages: preloadAll ? record.messages.slice() : [],
      };

      if (bumpLastAccessed) {
        record.lastAccessed = hydrated.lastAccessed;
      }

      const session = new ChatSession(hydrated);
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
    content: string,

    attachments?: File[],
    currentSession?: CurrentSession | null,
  ): Promise<string> {
    let session = currentSession?.session ?? null;

    if (!session) {
      const newChat = await this.createChat();
      new Notice("New chat created");
      session = await this.ensureSession(newChat.id);
      if (currentSession) currentSession.session = session;
    }

    return session.sendMessage(content, attachments);
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
        }
      }
    }
  }
}

/* -----------------------------------------------------------------------------
 * Singleton helpers (unchanged pattern)
 * ---------------------------------------------------------------------------*/
let messengerSingleton: Messenger | null = null;

export function createMessenger(): Messenger {
  if (!messengerSingleton) {
    messengerSingleton = new Messenger();
  }
  return messengerSingleton;
}

export function getMessenger(): Messenger | null {
  return messengerSingleton;
}

let currentThreadId = $state<string | null>(null);

export function getCurrentThreadId(): string | null {
  return currentThreadId;
}

export function setCurrentThreadId(id: string | null) {
  currentThreadId = id;
}

export class CurrentSession {
  session: ChatSession | null = $state(null);
}
