import { describe, expect, it, vi } from "vitest";
import {
  ConversationCoordinator,
  type CharacterResponder,
  type CoordinatedMessage,
} from "../src/conversations/conversation-coordinator.js";

function createCoordinator(options: {
  ids?: string[];
  maxDeciderCalls?: number;
  cooldownMs?: number;
  shouldRespond?: (
    message: CoordinatedMessage,
    characterId: string,
  ) => Promise<boolean>;
} = {}) {
  let currentTime = 1_000;

  const responders = new Map<string, CharacterResponder>();

  for (const id of options.ids ?? ["hearth", "kai"]) {
    responders.set(id, {
      handleMessage: vi.fn(async () => `${id}'s reply`),
    });
  }

  const coordinator = new ConversationCoordinator(responders, {
    spontaneousCooldownMs: options.cooldownMs ?? 0,
    minSpontaneousMessageLength: 1,
    // random() = 0 always picks the first character as the first candidate.
    random: () => 0,
    now: () => currentTime,
    shouldRespond: options.shouldRespond,
    maxDeciderCalls: options.maxDeciderCalls,
  });

  return {
    coordinator,
    handlerOf: (id: string) =>
      vi.mocked(responders.get(id)!.handleMessage),
    advanceTime: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function makeMessage(
  eventId: string,
  overrides: Partial<CoordinatedMessage> = {},
): CoordinatedMessage {
  return {
    eventId,
    channelId: "channel-1",
    userId: "member-1",
    content: "What do you think about this?",
    createdAt: "2026-01-01T00:00:00.000Z",
    authorIsBot: false,
    mentionedCharacterIds: [],
    ...overrides,
  };
}

describe("ConversationCoordinator joining", () => {
  it("asks a second character when the first declines", async () => {
    const shouldRespond = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { coordinator, handlerOf } = createCoordinator({ shouldRespond });

    const result = await coordinator.handleMessage(makeMessage("event-1"));

    expect(result?.characterId).toBe("kai");
    expect(shouldRespond.mock.calls.map((call) => call[1])).toEqual([
      "hearth",
      "kai",
    ]);
    expect(handlerOf("hearth")).not.toHaveBeenCalled();
    expect(handlerOf("kai")).toHaveBeenCalledTimes(1);
  });

  it("stays silent and releases the cooldown when every candidate declines", async () => {
    const shouldRespond = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { coordinator, advanceTime } = createCoordinator({
      shouldRespond,
      cooldownMs: 60_000,
    });

    const silent = await coordinator.handleMessage(makeMessage("event-1"));
    expect(silent).toBeNull();
    expect(shouldRespond).toHaveBeenCalledTimes(2);

    // Well inside the 60 s cooldown: a held cooldown would block this.
    advanceTime(1_000);
    const retry = await coordinator.handleMessage(makeMessage("event-2"));

    expect(retry?.characterId).toBe("hearth");
    expect(shouldRespond).toHaveBeenCalledTimes(3);
  });

  it("asks only one character when the first approves", async () => {
    const shouldRespond = vi.fn().mockResolvedValue(true);
    const { coordinator, handlerOf } = createCoordinator({ shouldRespond });

    const result = await coordinator.handleMessage(makeMessage("event-1"));

    expect(result?.characterId).toBe("hearth");
    expect(shouldRespond).toHaveBeenCalledTimes(1);
    expect(handlerOf("kai")).not.toHaveBeenCalled();
  });

  it("never asks a second character when maxDeciderCalls is 1", async () => {
    const shouldRespond = vi.fn().mockResolvedValue(false);
    const { coordinator } = createCoordinator({
      shouldRespond,
      maxDeciderCalls: 1,
    });

    const result = await coordinator.handleMessage(makeMessage("event-1"));

    expect(result).toBeNull();
    expect(shouldRespond.mock.calls.map((call) => call[1])).toEqual([
      "hearth",
    ]);
  });

  it("makes a single call when only one character is registered", async () => {
    const shouldRespond = vi.fn().mockResolvedValue(false);
    const { coordinator } = createCoordinator({
      ids: ["hearth"],
      shouldRespond,
    });

    const result = await coordinator.handleMessage(makeMessage("event-1"));

    expect(result).toBeNull();
    expect(shouldRespond).toHaveBeenCalledTimes(1);
  });

  it("asks at most two of three characters with the default cap", async () => {
    const shouldRespond = vi.fn().mockResolvedValue(false);
    const { coordinator } = createCoordinator({
      ids: ["hearth", "kai", "mira"],
      shouldRespond,
    });

    const result = await coordinator.handleMessage(makeMessage("event-1"));

    expect(result).toBeNull();
    expect(shouldRespond.mock.calls.map((call) => call[1])).toEqual([
      "hearth",
      "kai",
    ]);
  });

  it("gives focus to the character who joined, so follow-ups skip the decider", async () => {
    const shouldRespond = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      // If the decider were consulted again it would say NO.
      .mockResolvedValue(false);
    const { coordinator, handlerOf, advanceTime } = createCoordinator({
      shouldRespond,
    });

    const joined = await coordinator.handleMessage(makeMessage("event-1"));
    expect(joined?.characterId).toBe("kai");

    advanceTime(1_001);
    const followUp = await coordinator.handleMessage(
      makeMessage("event-2", { content: "What about something co-op?" }),
    );

    expect(followUp?.characterId).toBe("kai");
    expect(handlerOf("kai")).toHaveBeenCalledTimes(2);
    expect(shouldRespond).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid maxDeciderCalls", () => {
    expect(
      () => new ConversationCoordinator(new Map(), { maxDeciderCalls: 0 }),
    ).toThrow("maxDeciderCalls");

    expect(
      () => new ConversationCoordinator(new Map(), { maxDeciderCalls: 1.5 }),
    ).toThrow("maxDeciderCalls");
  });
});
