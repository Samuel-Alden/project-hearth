import type { HandleMessageInput } from "./conversation-service.js";

export interface CoordinatedMessage extends HandleMessageInput {
  authorIsBot: boolean;
  mentionedCharacterIds: string[];
  repliedToCharacterId?: string;
  onResponseSelected?: (characterId: string) => Promise<void>;
}

export interface CharacterResponder {
  handleMessage(input: HandleMessageInput): Promise<string>;
}

export interface CoordinatorResponse {
  characterId: string;
  content: string;
}

export interface ConversationCoordinatorOptions {
  spontaneousResponseChance?: number;
  spontaneousCooldownMs?: number;
  minSpontaneousMessageLength?: number;
  maxRememberedEvents?: number;
  conversationalFocusDurationMs?: number;
  random?: () => number;
  now?: () => number;
  shouldRespond?: (
    message: CoordinatedMessage,
    characterId: string,
  ) => Promise<boolean>;
}

const DEFAULT_OPTIONS = {
  spontaneousResponseChance: 1,
  spontaneousCooldownMs: 1_000,
  minSpontaneousMessageLength: 5,
  maxRememberedEvents: 5000,
  conversationalFocusDurationMs: 5 * 60 * 1_000,
};

interface ConversationalFocus {
  characterId: string;
  expiresAt: number;
}

export class ConversationCoordinator {
  private readonly processedEventIds = new Set<string>();
  private readonly spontaneousRespondedAt = new Map<string, number>();
  private readonly conversationalFocus = new Map<string, ConversationalFocus>();

  private readonly spontaneousResponseChance: number;
  private readonly spontaneousCooldownMs: number;
  private readonly minSpontaneousMessageLength: number;
  private readonly maxRememberedEvents: number;
  private readonly conversationalFocusDurationMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly shouldRespond: (
    message: CoordinatedMessage,
    characterId: string,
  ) => Promise<boolean>;

  constructor(
    private readonly responders: ReadonlyMap<string, CharacterResponder>,
    options: ConversationCoordinatorOptions = {},
  ) {
    this.spontaneousResponseChance =
      options.spontaneousResponseChance ??
      DEFAULT_OPTIONS.spontaneousResponseChance;

    this.spontaneousCooldownMs =
      options.spontaneousCooldownMs ??
      DEFAULT_OPTIONS.spontaneousCooldownMs;

    this.minSpontaneousMessageLength =
      options.minSpontaneousMessageLength ??
      DEFAULT_OPTIONS.minSpontaneousMessageLength;

    this.maxRememberedEvents = Math.max(
      100,
      Math.floor(
        options.maxRememberedEvents ??
          DEFAULT_OPTIONS.maxRememberedEvents,
      ),
    );

    this.conversationalFocusDurationMs =
      options.conversationalFocusDurationMs ??
      DEFAULT_OPTIONS.conversationalFocusDurationMs;

    this.random = options.random ?? Math.random;
    this.shouldRespond = options.shouldRespond ?? (async () => true);
    this.now = options.now ?? Date.now;

    if (
      this.spontaneousResponseChance < 0 ||
      this.spontaneousResponseChance > 1
    ) {
      throw new Error(
        "Spontaneous response chance must be between 0 and 1.",
      );
    }

    if (this.spontaneousCooldownMs < 0) {
      throw new Error("Spontaneous cooldown cannot be negative.");
    }

    if (this.conversationalFocusDurationMs < 0) {
      throw new Error("Conversational focus duration cannot be negative.");
    }
  }

  async handleMessage(
    message: CoordinatedMessage,
  ): Promise<CoordinatorResponse | null> {
    // Record every event, including ignored messages. Both Discord clients
    // can receive the same event, and must not make separate decisions.
    if (this.processedEventIds.has(message.eventId)) {
      return null;
    }

    this.rememberEvent(message.eventId);

    if (message.authorIsBot) return null;

    // Explicit replies take priority over direct mentions.
    let characterId =
      message.repliedToCharacterId &&
      this.responders.has(message.repliedToCharacterId)
        ? message.repliedToCharacterId
        : message.mentionedCharacterIds.find((id) =>
            this.responders.has(id),
          );

    const isSpontaneous = !characterId;
    let spontaneousTimestamp: number | undefined;

    if (isSpontaneous) {
      const content = message.content.trim();

      if (content.length < this.minSpontaneousMessageLength) {
        return null;
      }

      const currentTime = this.now();
      const lastResponseTime = this.spontaneousRespondedAt.get(
        message.channelId,
      );

      if (
        lastResponseTime !== undefined &&
        currentTime - lastResponseTime < this.spontaneousCooldownMs
      ) {
        return null;
      }

      if (this.random() >= this.spontaneousResponseChance) {
        return null;
      }

      const eligibleCharacterIds = [...this.responders.keys()];

      if (eligibleCharacterIds.length === 0) {
        return null;
      }

      // Prefer the character the user has been talking to. A focus expires
      // after a quiet period, so an old conversation cannot own the channel
      // indefinitely. When there is no active focus, choose one character.
      const focusedCharacterId = this.getFocusedCharacter(
        message.channelId,
        currentTime,
      );
      if (
        focusedCharacterId &&
        eligibleCharacterIds.includes(focusedCharacterId)
      ) {
        characterId = focusedCharacterId;
      } else {
        const selection = this.random();
        const index = Math.min(
          eligibleCharacterIds.length - 1,
          Math.floor(
            Math.max(0, Math.min(0.999999999, selection)) *
              eligibleCharacterIds.length,
          ),
        );

        characterId = eligibleCharacterIds[index];
      }

      if (!characterId) return null;

      spontaneousTimestamp = currentTime;
      this.spontaneousRespondedAt.set(
        message.channelId,
        currentTime,
      );
    }

    // Explicit mentions/replies establish focus; subsequent unaddressed
    // follow-ups keep it alive. This remains channel-specific.
    if (characterId) {
      this.setConversationalFocus(message.channelId, characterId, this.now());
    }

    // Ensure a character was selected and preserve the narrowed type.
    if (!characterId) return null;

    const selectedCharacterId = characterId;

    if (
      isSpontaneous &&
      characterId &&
      spontaneousTimestamp !== undefined
    ) {
      let approved: boolean;

      try {
        approved = await this.shouldRespond(message, characterId);
      } catch (error) {
        // Permit a retry if the decision check fails.
        this.processedEventIds.delete(message.eventId);

        if (
          this.spontaneousRespondedAt.get(message.channelId) ===
          spontaneousTimestamp
        ) {
          this.spontaneousRespondedAt.delete(message.channelId);
        }

        throw error;
      }

      if (!approved) {
        // A declined response should not consume the channel cooldown.
        if (
          this.spontaneousRespondedAt.get(message.channelId) ===
          spontaneousTimestamp
        ) {
          this.spontaneousRespondedAt.delete(message.channelId);
        }

        return null;
      }
    }
    const responder = this.responders.get(selectedCharacterId);

    if (!responder) return null;

    try {
      // Let the Discord integration show the typing indicator before
      // the AI request starts. A typing failure should not break a reply.
      try {
        await message.onResponseSelected?.(selectedCharacterId);
      } catch {
        // The indicator is optional; continue generating the response.
      }

      const response = await responder.handleMessage({
        eventId: message.eventId,
        channelId: message.channelId,
        userId: message.userId,
        content: message.content,
        createdAt: message.createdAt,
      });

      return {
        characterId: selectedCharacterId,
        content: response,
      };
    } catch (error) {
      // Permit a retry after a failed response.
      this.processedEventIds.delete(message.eventId);

      if (
        isSpontaneous &&
        spontaneousTimestamp !== undefined &&
        this.spontaneousRespondedAt.get(message.channelId) ===
          spontaneousTimestamp
      ) {
        this.spontaneousRespondedAt.delete(message.channelId);
      }

      throw error;
    }
  }

  private getFocusedCharacter(
    channelId: string,
    currentTime: number,
  ): string | undefined {
    const focus = this.conversationalFocus.get(channelId);

    if (!focus) return undefined;

    if (
      focus.expiresAt <= currentTime ||
      !this.responders.has(focus.characterId)
    ) {
      this.conversationalFocus.delete(channelId);
      return undefined;
    }

    return focus.characterId;
  }

  private setConversationalFocus(
    channelId: string,
    characterId: string,
    currentTime: number,
  ): void {
    // Refreshing a channel moves it to the end of the map. Keep the focus
    // cache bounded for long-running bots that see many channels.
    this.conversationalFocus.delete(channelId);
    this.conversationalFocus.set(channelId, {
      characterId,
      expiresAt: currentTime + this.conversationalFocusDurationMs,
    });

    while (this.conversationalFocus.size > this.maxRememberedEvents) {
      const oldestChannelId =
        this.conversationalFocus.keys().next().value;

      if (oldestChannelId === undefined) break;

      this.conversationalFocus.delete(oldestChannelId);
    }
  }

  private rememberEvent(eventId: string): void {
    this.processedEventIds.add(eventId);

    // Bound memory use during long-running sessions.
    while (this.processedEventIds.size > this.maxRememberedEvents) {
      const oldestEventId =
        this.processedEventIds.values().next().value;

      if (oldestEventId === undefined) break;

      this.processedEventIds.delete(oldestEventId);
    }
  }
}
