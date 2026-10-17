import { describe, expect, it, vi } from "vitest";
import {
  ConversationCoordinator,
  type CharacterResponder,
  type CoordinatedMessage,
} from "../src/conversations/conversation-coordinator.js";

function setup(options: {
  focusDurationMs?: number;
  random?: () => number;
  shouldRespond?: (
    message: CoordinatedMessage,
    characterId: string,
  ) => Promise<boolean>;
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
    shouldRespond: options.shouldRespond,
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

  it("does not focus a character whose spontaneous reply was declined", async () => {
    // Message 1: roll 0, select Hearth. Message 2: roll 0.99, select Kai.
    const picks = [0, 0, 0.99, 0.99];
    // Both candidates decline message 1; every later decision approves.
    const shouldRespond = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { coordinator, hearth, kai, advanceTime } = setup({
      random: () => picks.shift() ?? 0.99,
      shouldRespond,
    });

    const declined = await coordinator.handleMessage(makeMessage("event-1"));
    expect(declined).toBeNull();

    advanceTime(1_001);
    const response = await coordinator.handleMessage(makeMessage("event-2"));

    expect(response?.characterId).toBe("kai");
    expect(hearth.handleMessage).not.toHaveBeenCalled();
    expect(kai.handleMessage).toHaveBeenCalledTimes(1);
  });

  it("does not focus a character whose spontaneous reply failed", async () => {
    const picks = [0, 0, 0.99, 0.99];
    const { coordinator, hearth, kai, advanceTime } = setup({
      random: () => picks.shift() ?? 0.99,
    });
    vi.mocked(hearth.handleMessage).mockRejectedValueOnce(
      new Error("Temporary failure"),
    );

    await expect(
      coordinator.handleMessage(makeMessage("event-1")),
    ).rejects.toThrow("Temporary failure");

    advanceTime(1_001);
    const response = await coordinator.handleMessage(makeMessage("event-2"));

    expect(response?.characterId).toBe("kai");
    expect(kai.handleMessage).toHaveBeenCalledTimes(1);
  });

  it("answers follow-ups to the focused character without asking the decider", async () => {
    const shouldRespond = vi.fn().mockResolvedValue(false);
    const { coordinator, kai, advanceTime } = setup({ shouldRespond });

    await coordinator.handleMessage(
      makeMessage("event-1", {
        content: "Kai, wanna game?",
        mentionedCharacterIds: ["kai"],
      }),
    );

    advanceTime(1_001);
    const followUp = await coordinator.handleMessage(
      makeMessage("event-2", { content: "What about something co-op?" }),
    );

    expect(followUp?.characterId).toBe("kai");
    expect(kai.handleMessage).toHaveBeenCalledTimes(2);
    expect(shouldRespond).not.toHaveBeenCalled();
  });

  it("restarts the focus window on each reply and lets it lapse after silence", async () => {
    const { coordinator, hearth, kai, advanceTime } = setup({
      focusDurationMs: 1_000,
      random: () => 0,
    });

    // t=1000: focus on Kai until t=2000.
    await coordinator.handleMessage(
      makeMessage("event-1", {
        content: "Kai, you there?",
        mentionedCharacterIds: ["kai"],
      }),
    );

    // t=1900: Kai replies; focus now lasts until t=2900.
    advanceTime(900);
    const second = await coordinator.handleMessage(makeMessage("event-2"));

    // t=2800: past the original expiry, inside the refreshed one.
    advanceTime(900);
    const third = await coordinator.handleMessage(makeMessage("event-3"));

    // t=3900: more than 1000ms after Kai's last reply, so focus has lapsed
    // and random() = 0 selects Hearth instead.
    advanceTime(1_100);
    const lapsed = await coordinator.handleMessage(makeMessage("event-4"));

    expect(second?.characterId).toBe("kai");
    expect(third?.characterId).toBe("kai");
    expect(lapsed?.characterId).toBe("hearth");
    expect(kai.handleMessage).toHaveBeenCalledTimes(3);
    expect(hearth.handleMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps focus per member so one conversation does not capture another's", async () => {
    const { coordinator, hearth, kai, advanceTime } = setup({
      random: () => 0,
    });

    await coordinator.handleMessage(
      makeMessage("event-1", {
        userId: "member-1",
        content: "Kai, wanna game?",
        mentionedCharacterIds: ["kai"],
      }),
    );

    // Member 2 has no focus, so this is an ordinary unaddressed message
    // (random() = 0 selects Hearth) rather than a follow-up to Kai.
    advanceTime(1_001);
    const other = await coordinator.handleMessage(
      makeMessage("event-2", { userId: "member-2" }),
    );

    // Member 1's own conversation with Kai is still intact.
    advanceTime(1_001);
    const own = await coordinator.handleMessage(
      makeMessage("event-3", {
        userId: "member-1",
        content: "What about something co-op?",
      }),
    );

    expect(other?.characterId).toBe("hearth");
    expect(own?.characterId).toBe("kai");
    expect(kai.handleMessage).toHaveBeenCalledTimes(2);
    expect(hearth.handleMessage).toHaveBeenCalledTimes(1);
  });
});
