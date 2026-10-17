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
  /**
   * The most characters the participation decider may be asked about one
   * unaddressed message, in turn. Each call is an AI request, so this is
   * the cost cap. 1 asks a single character; the default is 2.
   */
  maxDeciderCalls?: number;
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
  maxDeciderCalls: 2,
};

interface ConversationalFocus {
  characterId: string;
  expiresAt: number;
}

export class ConversationCoordinator {
  private readonly processedEventIds = new Set<string>();
  private readonly spontaneousRespondedAt = new Map<string, number>();

  // Focus belongs to one member in one channel (see focusKey), so a
  // conversation between one person and a character does not capture
  // unrelated messages from other people in the same channel.
  private readonly conversationalFocus = new Map<string, ConversationalFocus>();

  private readonly spontaneousResponseChance: number;
  private readonly spontaneousCooldownMs: number;
  private readonly minSpontaneousMessageLength: number;
  private readonly maxRememberedEvents: number;
  private readonly conversationalFocusDurationMs: number;
  private readonly maxDeciderCalls: number;
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

    this.maxDeciderCalls =
      options.maxDeciderCalls ?? DEFAULT_OPTIONS.maxDeciderCalls;

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

    if (
      !Number.isInteger(this.maxDeciderCalls) ||
      this.maxDeciderCalls < 1
    ) {
      throw new Error("maxDeciderCalls must be an integer of at least 1.");
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
    const explicitCharacterId =
      message.repliedToCharacterId &&
      this.responders.has(message.repliedToCharacterId)
        ? message.repliedToCharacterId
        : message.mentionedCharacterIds.find((id) =>
            this.responders.has(id),
          );

    // Characters to consider for this message, in order. An explicit
    // address or an active focus yields exactly one and needs no decision.
    let candidateIds: string[] = [];

    // Only an unaddressed message with no active focus needs the
    // participation decider. A follow-up to the focused character does not.
    let needsDecision = false;
    let spontaneousTimestamp: number | undefined;

    if (explicitCharacterId) {
      candidateIds = [explicitCharacterId];

      // The member chose this character, so it owns their conversation from
      // now on, whether or not this particular reply succeeds.
      this.setConversationalFocus(
        message.channelId,
        message.userId,
        explicitCharacterId,
        this.now(),
      );
    } else {
      if (
        message.content.trim().length < this.minSpontaneousMessageLength
      ) {
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

      const focusedCharacterId = this.getFocusedCharacter(
        message.channelId,
        message.userId,
        currentTime,
      );

      if (focusedCharacterId) {
        // A follow-up inside an active conversation: the focused character
        // answers. This must not depend on the optional AI decision, which
        // fails silently, and it must not be randomly skipped.
        candidateIds = [focusedCharacterId];
      } else {
        // Nobody has this member's attention yet: maybe a character joins.
        if (this.random() >= this.spontaneousResponseChance) {
          return null;
        }

        const eligibleCharacterIds = [...this.responders.keys()];

        if (eligibleCharacterIds.length === 0) {
          return null;
        }

        const selection = this.random();
        const firstIndex = Math.min(
          eligibleCharacterIds.length - 1,
          Math.floor(
            Math.max(0, Math.min(0.999999999, selection)) *
              eligibleCharacterIds.length,
          ),
        );

        // The first candidate is picked at random. Later candidates follow
        // it in registry order, wrapping around, so every character gets
        // an equal chance to be asked first. The number asked is capped
        // because every candidate costs one AI request.
        const candidateCount = Math.min(
          this.maxDeciderCalls,
          eligibleCharacterIds.length,
        );

        candidateIds = Array.from(
          { length: candidateCount },
          (_, offset) =>
            eligibleCharacterIds[
              (firstIndex + offset) % eligibleCharacterIds.length
            ],
        );

        needsDecision = true;
      }

      spontaneousTimestamp = currentTime;
      this.spontaneousRespondedAt.set(
        message.channelId,
        currentTime,
      );
    }

    let selectedCharacterId: string | undefined;

    if (needsDecision) {
      // Ask in order; the first YES wins, so at most one character replies
      // and later candidates are never asked once someone accepts.
      for (const candidateId of candidateIds) {
        let approved: boolean;

        try {
          approved = await this.shouldRespond(message, candidateId);
        } catch (error) {
          // Permit a retry if the decision check fails.
          this.processedEventIds.delete(message.eventId);
          this.releaseSpontaneousCooldown(
            message.channelId,
            spontaneousTimestamp,
          );

          throw error;
        }

        if (approved) {
          selectedCharacterId = candidateId;
          break;
        }
      }

      if (selectedCharacterId === undefined) {
        // Every candidate declined. This consumes no cooldown and creates
        // no focus: the member never spoke to any of these characters.
        this.releaseSpontaneousCooldown(
          message.channelId,
          spontaneousTimestamp,
        );

        return null;
      }
    } else {
      selectedCharacterId = candidateIds[0];
    }

    // Ensure a character was selected and preserve the narrowed type.
    if (selectedCharacterId === undefined) return null;

    const chosenCharacterId = selectedCharacterId;
    const responder = this.responders.get(chosenCharacterId);

    if (!responder) return null;

    try {
      // Let the Discord integration show the typing indicator before
      // the AI request starts. A typing failure should not break a reply.
      try {
        await message.onResponseSelected?.(chosenCharacterId);
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

      // A generated reply (re)starts this member's focus window. Declined,
      // ignored, and failed spontaneous messages never do, so focus can
      // only lapse after real silence. A character that joined an
      // unaddressed message gains focus the same way.
      this.setConversationalFocus(
        message.channelId,
        message.userId,
        chosenCharacterId,
        this.now(),
      );

      return {
        characterId: chosenCharacterId,
        content: response,
      };
    } catch (error) {
      // Permit a retry after a failed response.
      this.processedEventIds.delete(message.eventId);
      this.releaseSpontaneousCooldown(
        message.channelId,
        spontaneousTimestamp,
      );

      throw error;
    }
  }

  private focusKey(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
  }

  private getFocusedCharacter(
    channelId: string,
    userId: string,
    currentTime: number,
  ): string | undefined {
    const key = this.focusKey(channelId, userId);
    const focus = this.conversationalFocus.get(key);

    if (!focus) return undefined;

    if (
      focus.expiresAt <= currentTime ||
      !this.responders.has(focus.characterId)
    ) {
      this.conversationalFocus.delete(key);
      return undefined;
    }

    return focus.characterId;
  }

  private setConversationalFocus(
    channelId: string,
    userId: string,
    characterId: string,
    currentTime: number,
  ): void {
    const key = this.focusKey(channelId, userId);

    // Refreshing moves the entry to the end of the map. Keep the focus
    // cache bounded for long-running bots that see many members.
    this.conversationalFocus.delete(key);
    this.conversationalFocus.set(key, {
      characterId,
      expiresAt: currentTime + this.conversationalFocusDurationMs,
    });

    while (this.conversationalFocus.size > this.maxRememberedEvents) {
      const oldestKey = this.conversationalFocus.keys().next().value;

      if (oldestKey === undefined) break;

      this.conversationalFocus.delete(oldestKey);
    }
  }

  // Only clear the cooldown this message set; a newer message may
  // have replaced it.
  private releaseSpontaneousCooldown(
    channelId: string,
    timestamp: number | undefined,
  ): void {
    if (
      timestamp !== undefined &&
      this.spontaneousRespondedAt.get(channelId) === timestamp
    ) {
      this.spontaneousRespondedAt.delete(channelId);
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
