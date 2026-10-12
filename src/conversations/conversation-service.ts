
import type { AIMessage, AIProvider } from "../ai/provider.js";
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

    // Fetch the current message plus up to 20 recent messages.
    // getRecentMessages returns messages newest-first.
    const recentMessages = this.database.getRecentMessages(
      input.channelId,
      21,
    );

    // Ordinary Discord messages may already have been stored by
    // the message handler. Slash-command inputs are stored here.
    const currentMessageAlreadyStored = recentMessages.some(
      (message) =>
        message.discordEventId === input.eventId &&
        message.speakerType === "user",
    );

    // Exclude the current event from history so it is not
    // included twice in the AI prompt.
    const history = recentMessages
      .filter(
        (message) => message.discordEventId !== input.eventId,
      )
      .filter((message) => message.content !== "/hearth")
      .slice(0, 20)
      .reverse();

    // Preserve chronological order and distinguish characters
    // from Discord members in the conversation context.
    const messages: AIMessage[] = history.map((message) => ({
      role: message.speakerType === "user"
        ? "user"
        : "assistant",
      content: message.speakerType === "user"
        ? `[Discord member ${message.speakerId}]: ${message.content}`
        : `[${message.speakerId}]: ${message.content}`,
    }));

    // Add the current message exactly once to the AI context.
    messages.push({
      role: "user",
      content,
    });

    // Persist slash-command input here. Ordinary messages are
    // already stored by the Discord message handler.
    if (!currentMessageAlreadyStored) {
      this.database.saveMessage({
        discordEventId: input.eventId,
        channelId: input.channelId,
        speakerType: "user",
        speakerId: input.userId,
        content,
        createdAt: input.createdAt,
      });
    }

    // Generate a reply using this character's own personality
    // and the shared recent conversation history.
    const generatedText = await this.aiProvider.generateText({
      system: buildSystemPrompt(this.character),
      messages,
      maxOutputTokens: 800,
    });

    if (!generatedText.trim()) {
      throw new Error(
        "The AI provider returned an empty response.",
      );
    }

    // Stay safely within Discord's regular message length limit.
    const response = generatedText.length > 1900
      ? `${generatedText.slice(0, 1897)}...`
      : generatedText;

    // Save the response before returning it to the Discord handler.
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
