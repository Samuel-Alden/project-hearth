import { describe, expect, it, vi } from "vitest";
import {
  ConversationCoordinator,
  type CharacterResponder,
  type CoordinatedMessage,
} from "./conversation-coordinator.js";

function setup(options: {
  focusDurationMs?: number;
  random?: () => number;
} = {}) {
  let currentTime = 1_000;

  const hearth: CharacterResponder = {
    handleMessage: vi.fn(async () => "Hearth's reply"),
  };
  const kai: CharacterResponder = {
    handleMessage: vi.fn(async () => "Kai's reply"),
  };

  const responders = new Map<string, CharacterResponder>([
    ["hearth", hearth],
    ["kai", kai],
  ]);

  const coordinator = new ConversationCoordinator(responders, {
    conversationalFocusDurationMs: options.focusDurationMs ?? 5 * 60 * 1_000,
    spontaneousCooldownMs: 0,
    minSpontaneousMessageLength: 1,
    random: options.random ?? (() => 0.99),
    now: () => currentTime,
  });

  return {
    coordinator,
    hearth,
    kai,
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

describe("ConversationCoordinator conversational focus", () => {
  it("keeps the addressed character for an unmentioned follow-up", async () => {
    const { coordinator, hearth, kai, advanceTime } = setup();

    const first = await coordinator.handleMessage(
      makeMessage("event-1", {
        content: "Hey Kai, what game should we play?",
        mentionedCharacterIds: ["kai"],
      }),
    );
    expect(first?.characterId).toBe("kai");

    advanceTime(1_001);
    const followUp = await coordinator.handleMessage(
      makeMessage("event-2", {
        content: "What about something co-op?",
      }),
    );

    expect(followUp?.characterId).toBe("kai");
    expect(kai.handleMessage).toHaveBeenCalledTimes(2);
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });

  it("switches focus when another character is explicitly addressed", async () => {
    const { coordinator, hearth, kai, advanceTime } = setup();

    await coordinator.handleMessage(
      makeMessage("event-1", {
        content: "Kai, what do you think?",
        mentionedCharacterIds: ["kai"],
      }),
    );

    const switchResponse = await coordinator.handleMessage(
      makeMessage("event-2", {
        content: "Hearth, what do you think?",
        mentionedCharacterIds: ["hearth"],
      }),
    );
    expect(switchResponse?.characterId).toBe("hearth");

    advanceTime(1_001);
    const followUp = await coordinator.handleMessage(
      makeMessage("event-3", { content: "And what else?" }),
    );

    expect(followUp?.characterId).toBe("hearth");
    expect(kai.handleMessage).toHaveBeenCalledTimes(1);
    expect(hearth.handleMessage).toHaveBeenCalledTimes(2);
  });

  it("lets focus expire so a later spontaneous reply can choose another character", async () => {
    const { coordinator, hearth, kai, advanceTime } = setup({
      focusDurationMs: 500,
      random: () => 0.99,
    });

    await coordinator.handleMessage(
      makeMessage("event-1", {
        content: "Hearth, answer this first.",
        mentionedCharacterIds: ["hearth"],
      }),
    );

    advanceTime(501);
    const response = await coordinator.handleMessage(
      makeMessage("event-2", { content: "A new topic now." }),
    );

    expect(response?.characterId).toBe("kai");
    expect(hearth.handleMessage).toHaveBeenCalledTimes(1);
    expect(kai.handleMessage).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch the same Discord event twice", async () => {
    const { coordinator, kai } = setup();

    const event = makeMessage("same-event", {
      content: "Kai, you there?",
      mentionedCharacterIds: ["kai"],
    });

    const first = await coordinator.handleMessage(event);
    const duplicate = await coordinator.handleMessage(event);

    expect(first?.characterId).toBe("kai");
    expect(duplicate).toBeNull();
    expect(kai.handleMessage).toHaveBeenCalledTimes(1);
  });
});
