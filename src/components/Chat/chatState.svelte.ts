import { nanoid } from "nanoid";
import type { GenModelConfig, Language, RegisteredGenProvider } from "papa-ts";
import { getPlugin } from "../../lib/state.svelte";
import { getData } from "../../lib/data.svelte";

export type ChatMessage = UserMessage | AssistantMessage;

export type ChatModel = {
  model: string;
  provider: RegisteredGenProvider;
  modelConfig: GenModelConfig;
};

const defaultAttachments = [".txt", ".json"];

export type UserMessage = {
  content: string;
  attatchments?: File[];
  id: string;
};

export type AssistantMessage = {
  state: "idle" | "streaming" | "success" | "error" | "cancelled";
  content: string;
  nerd_stats?: {
    tokensPerSecond: number;
    retrievedDocsNum: number;
    genModelConfig: GenModelConfig;
  };
  id: string;
};

export type MessagePair = {
  id: string;
  timestamp: Date;
  model: { provider: RegisteredGenProvider; model: string };
  userMessage: UserMessage;
  assistantMessage: AssistantMessage;
};

export class Chat {
  id: string;
  title: string;
  createdAt: Date;
  lastAccesed: Date;
  messages: MessagePair[];

  constructor(
    id: string,
    title: string,
    createdAt: Date,
    lastAccesed: Date,
    messages: MessagePair[] = [],
  ) {
    this.id = id;
    this.title = title;
    this.createdAt = createdAt;
    this.lastAccesed = lastAccesed;
    this.messages = $state(messages);
  }

  appendMessagePair(messagePair: MessagePair): void {
    this.messages.push(messagePair);
    this.lastAccesed = new Date();
  }

  updateAssistantMessage(
    messageId: string,
    update: Partial<AssistantMessage>,
  ): void {
    const messagePair = this.messages.find((pair) => pair.id === messageId);
    if (messagePair) {
      messagePair.assistantMessage = {
        ...messagePair.assistantMessage,
        ...update,
      };
      this.lastAccesed = new Date();
    }
  }

  getMessagePair(messageId: string): MessagePair | undefined {
    return this.messages.find((pair) => pair.id === messageId);
  }

  static create(title: string): Chat {
    return new Chat(nanoid(), title, new Date(), new Date(), []);
  }
}

export class ChatSession {
  private chat: Chat;
  private abortController: AbortController | null;
  messageState: "idle" | "answering" | "editing";

  constructor(chat: Chat) {
    this.chat = chat;
    this.messageState = "idle";
    this.abortController = null;
  }

  getChat(): Chat {
    return this.chat;
  }

  async sendMessage(
    messageContent: string,
    model: ChatModel,
    attachments?: File[],
  ): Promise<string> {
    const messagePairId = nanoid();
    const userMessage: UserMessage = {
      content: messageContent,
      attatchments: attachments,
      id: nanoid(),
    };

    if (attachments) {
      for (const attachment of attachments) {
        console.log(attachment.type);
      }
    }

    const assistantMessage: AssistantMessage = {
      state: "idle",
      content: "",
      id: nanoid(),
    };

    const messagePair: MessagePair = {
      id: messagePairId,
      timestamp: new Date(),
      model: { provider: model.provider, model: model.model },
      userMessage,
      assistantMessage,
    };

    // Add the message pair to chat immediately
    this.chat.appendMessagePair(messagePair);

    // Start the async response
    this.processResponse(messagePairId, messageContent, model);

    return messagePairId;
  }

  private async processResponse(
    messagePairId: string,
    messageContent: string,
    model: ChatModel,
  ) {
    try {
      this.messageState = "answering";

      // Update state to streaming
      this.chat.updateAssistantMessage(messagePairId, { state: "streaming" });

      const input = {
        modelConfig: {
          provider: model.provider,
          model: model.model,
          modelConfig: model.modelConfig,
        },
        userQuery: messageContent,
        chatHistory: this.buildChatHistory(),
        lang: "en" as Language,
      };

      const plugin = getPlugin();
      const [response, abortController] = plugin.papa.run(input);
      //Todo do i need to check if one already exists
      this.abortController = abortController;
      this.handleStreamingResponse(messagePairId, response);
    } catch (error) {
      this.chat.updateAssistantMessage(messagePairId, {
        state: "error",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      this.abortController = null;
      this.messageState = "idle";
    }
  }

  private async handleStreamingResponse(
    messagePairId: string,
    responseStream: AsyncIterable<any>,
  ) {
    for await (const chunk of responseStream) {
      if (chunk.content) {
        this.chat.updateAssistantMessage(messagePairId, {
          state: "streaming",
          content: chunk.content,
        });
      }
    }

    this.chat.updateAssistantMessage(messagePairId, {
      state: "success",
    });
  }

  stopStreamingResponse(): void {
    if (this.abortController) this.abortController.abort();
    else throw Error(`No AbortController exists for session ${this}`);
  }

  private buildChatHistory(): string {
    return this.chat.messages
      .slice(0, -1) // drops the last pair
      .map((pair) => {
        const user = `User: ${pair.userMessage.content}`;
        const assistant = `Assistant: ${pair.assistantMessage.content}`;
        return `${user}\n${assistant}`;
      })
      .join("\n\n");
  }

  // async regenerateLastMessage(model: chatModel): Promise<string> {
  //   const lastMessage = this.chat.messages[this.chat.messages.length - 1];
  //   if (!lastMessage) {
  //     throw new Error("No messages to regenerate");
  //   }

  //   // Reset the assistant message
  //   this.chat.updateAssistantMessage(lastMessage.id, {
  //     state: "idle",
  //     content: "",
  //   });

  //   return this.processResponse(
  //     lastMessage.id,
  //     lastMessage.userMessage.content,
  //     model,
  //   ).then(() => lastMessage.id);
  // }
}

export class Messenger {
  private chats: Map<string, Chat> = new Map();
  private activeSessions: Map<string, ChatSession> = new Map();

  createChat(): Chat {
    const data = getData();
    const title = data.defaultChatName;
    const chat = Chat.create(title);
    this.chats.set(chat.id, chat);
    return chat;
  }

  getChat(chatId: string): Chat | undefined {
    return this.chats.get(chatId);
  }

  getAllChats(): Chat[] {
    return Array.from(this.chats.values()).sort(
      (a, b) => b.lastAccesed.getTime() - a.lastAccesed.getTime(),
    );
  }

  deleteChat(chatId: string): boolean {
    const deleted = this.chats.delete(chatId);
    if (deleted) {
      this.activeSessions.delete(chatId);
    }
    return deleted;
  }

  getSession(chatId: string): ChatSession {
    const chat = this.chats.get(chatId);
    if (!chat) {
      throw new Error(`Chat with id ${chatId} not found`);
    }

    if (!this.activeSessions.has(chatId)) {
      this.activeSessions.set(chatId, new ChatSession(chat));
    }

    return this.activeSessions.get(chatId)!;
  }

  async sendMessage(
    chatId: string,
    messageContent: string,
    model: ChatModel,
    attachments?: File[],
  ): Promise<string> {
    const session = this.getSession(chatId);
    return session.sendMessage(messageContent, model, attachments);
  }

  // async regenerateLastMessage(
  //   chatId: string,
  //   model: chatModel,
  // ): Promise<string> {
  //   const session = this.getSession(chatId);
  //   return session.regenerateLastMessage(model);
  // }

  // Utility methods
  updateChatTitle(chatId: string, newTitle: string): void {
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.title = newTitle;
      chat.lastAccesed = new Date();
    }
  }

  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }
}

export const messenger = new Messenger();
