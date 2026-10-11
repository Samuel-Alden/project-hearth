import type { HandleMessageInput } from "./conversation-service.js";

export interface CoordinatedMessage extends HandleMessageInput {
  authorIsBot: boolean;
  mentionedCharacterIds: string[];
  repliedToCharacterId?: string;
}

export interface CharacterResponder {
  handleMessage(input: HandleMessageInput): Promise<string>;
}

export interface CoordinatorResponse {
  characterId: string;
  content: string;
}

export class ConversationCoordinator {
  private readonly processedEventIds = new Set<string>();

  constructor(
    private readonly responders: ReadonlyMap<string, CharacterResponder>,
  ) {}

  async handleMessage(
    message: CoordinatedMessage,
  ): Promise<CoordinatorResponse | null> {
    if (message.authorIsBot) return null;

    if (this.processedEventIds.has(message.eventId)) return null;

    const characterId =
      (message.repliedToCharacterId &&
        this.responders.has(message.repliedToCharacterId)
        ? message.repliedToCharacterId
        : undefined) ??
      message.mentionedCharacterIds.find((id) =>
        this.responders.has(id),
      );

    if (!characterId) return null;

    // Reserve the event before awaiting the AI provider.
    this.processedEventIds.add(message.eventId);

    try {
      const responder = this.responders.get(characterId)!;
      const content = await responder.handleMessage(message);

      return { characterId, content };
    } catch (error) {
      // Allow a retry if processing failed.
      this.processedEventIds.delete(message.eventId);
      throw error;
    }
  }
}
