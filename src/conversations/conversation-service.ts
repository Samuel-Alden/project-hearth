import type {
  AIMessage,
  AIProvider,
} from "../ai/provider.js";

import {
  buildSystemPrompt,
  type CharacterProfile,
} from "../characters/character-profile.js";

import type {
  NewMessage,
  StoredMessage,
} from "../database.js";

interface ConversationDatabase {
  saveMessage(message: NewMessage): void;

  getRecentMessages(
    channelId: string,
    limit?: number,
  ): StoredMessage[];
}

export interface HandleMessageInput {
  eventId: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface ConversationServiceOptions {
  database: ConversationDatabase;
  aiProvider: AIProvider;
  character: CharacterProfile;
}

export class ConversationService {
  private readonly database: ConversationDatabase;
  private readonly aiProvider: AIProvider;
  private readonly character: CharacterProfile;

  constructor(options: ConversationServiceOptions) {
    this.database = options.database;
    this.aiProvider = options.aiProvider;
    this.character = options.character;
  }

  async handleMessage(
    input: HandleMessageInput,
  ): Promise<string> {
    const content = input.content.trim();

    if (!content) {
      throw new Error("Message cannot be empty.");
    }

    // Load recent messages before saving the current request.
    // The database returns newest first, so restore chronological order.
    // Ignore legacy command-only entries from the early prototype.
    const history = this.database
      .getRecentMessages(input.channelId, 20)
      .filter((message) => message.content !== "/hearth")
      .reverse();

    const messages: AIMessage[] = history.map((message) => ({
      role: message.speakerType === "user" ? "user" : "assistant",
      content: message.content,
    }));

    messages.push({
      role: "user",
      content,
    });

    // Persist the user's message before calling the model.
    this.database.saveMessage({
      discordEventId: input.eventId,
      channelId: input.channelId,
      speakerType: "user",
      speakerId: input.userId,
      content,
      createdAt: input.createdAt,
    });

    const generatedText = await this.aiProvider.generateText({
      system: buildSystemPrompt(this.character),
      messages,
      maxOutputTokens: 800,
    });

    if (!generatedText.trim()) {
      throw new Error("The AI provider returned an empty response.");
    }

    // Discord messages have a 2,000-character limit.
    const response =
      generatedText.length > 1900
        ? `${generatedText.slice(0, 1897)}...`
        : generatedText;

    // Persist the reply only after generation succeeds.
    this.database.saveMessage({
      discordEventId: input.eventId,
      channelId: input.channelId,
      speakerType: "agent",
      speakerId: this.character.id,
      content: response,
      createdAt: new Date().toISOString(),
    });

    return response;
  }
}
