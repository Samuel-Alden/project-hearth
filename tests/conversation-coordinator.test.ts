import { describe, expect, it, vi } from "vitest";
import {
  ConversationCoordinator,
  type CharacterResponder,
} from "../src/conversations/conversation-coordinator.js";

function createResponder(response: string): CharacterResponder {
  return {
    handleMessage: vi.fn().mockResolvedValue(response),
  };
}

function createMessage(
  overrides: Partial<Parameters<
    ConversationCoordinator["handleMessage"]
  >[0]> = {},
) {
  return {
    eventId: "event-1",
    channelId: "channel-1",
    userId: "user-1",
    content: "Hello!",
    createdAt: new Date().toISOString(),
    authorIsBot: false,
    mentionedCharacterIds: [],
    ...overrides,
  };
}

describe("ConversationCoordinator", () => {
  it("routes a mention to the mentioned character", async () => {
    const hearth = createResponder("Hello from Hearth!");
    const kai = createResponder("Hey from Kai!");
    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth], ["kai", kai]]),
    );

    const result = await coordinator.handleMessage(
      createMessage({ mentionedCharacterIds: ["kai"] }),
    );

    expect(result).toEqual({
      characterId: "kai",
      content: "Hey from Kai!",
    });
    expect(kai.handleMessage).toHaveBeenCalledOnce();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });

  it("prefers a valid reply target over a mention", async () => {
    const hearth = createResponder("Hearth reply");
    const kai = createResponder("Kai reply");
    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth], ["kai", kai]]),
    );

    const result = await coordinator.handleMessage(
      createMessage({
        mentionedCharacterIds: ["hearth"],
        repliedToCharacterId: "kai",
      }),
    );

    expect(result?.characterId).toBe("kai");
    expect(kai.handleMessage).toHaveBeenCalledOnce();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });

  it("ignores messages from bots", async () => {
    const hearth = createResponder("Hello!");
    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
    );

    const result = await coordinator.handleMessage(
      createMessage({
        authorIsBot: true,
        mentionedCharacterIds: ["hearth"],
      }),
    );

    expect(result).toBeNull();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });


  it("ignores messages with no eligible character", async () => {
    const hearth = createResponder("Hello!");

    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
      {
        // Test explicit routing without spontaneous responses.
        spontaneousResponseChance: 0,
      },
    );

    const result = await coordinator.handleMessage(
      createMessage({ mentionedCharacterIds: ["unknown"] }),
    );

    expect(result).toBeNull();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });

  it("does not process the same event twice", async () => {
    const hearth = createResponder("Hello!");
    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
    );
    const message = createMessage({
      mentionedCharacterIds: ["hearth"],
    });

    await coordinator.handleMessage(message);
    const duplicate = await coordinator.handleMessage(message);

    expect(duplicate).toBeNull();
    expect(hearth.handleMessage).toHaveBeenCalledOnce();
  });

  it("allows retry when the responder fails", async () => {
    const hearth: CharacterResponder = {
      handleMessage: vi.fn()
        .mockRejectedValueOnce(new Error("Temporary failure"))
        .mockResolvedValueOnce("Recovered!"),
    };
    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
    );
    const message = createMessage({
      mentionedCharacterIds: ["hearth"],
    });

    await expect(coordinator.handleMessage(message))
      .rejects.toThrow("Temporary failure");

    const retry = await coordinator.handleMessage(message);

    expect(retry?.content).toBe("Recovered!");
    expect(hearth.handleMessage).toHaveBeenCalledTimes(2);
  });


  it("can spontaneously select one character", async () => {
    const hearth = createResponder("Hello from Hearth!");
    const kai = createResponder("Hey from Kai!");

    const coordinator = new ConversationCoordinator(
      new Map([
        ["hearth", hearth],
        ["kai", kai],
      ]),
      {
        spontaneousResponseChance: 1,
        random: () => 0,
      },
    );

    const result = await coordinator.handleMessage(
      createMessage({
        content: "I finally finished my programming project today!",
      }),
    );

    expect(result?.characterId).toBe("hearth");
    expect(hearth.handleMessage).toHaveBeenCalledOnce();
    expect(kai.handleMessage).not.toHaveBeenCalled();
  });

  it("enforces the spontaneous channel cooldown", async () => {
    const hearth = createResponder("Hello!");
    let currentTime = 1000;

    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
      {
        spontaneousResponseChance: 1,
        spontaneousCooldownMs: 90_000,
        random: () => 0,
        now: () => currentTime,
      },
    );

    const first = await coordinator.handleMessage(
      createMessage({
        eventId: "event-1",
        content: "I had a pretty interesting day at school today.",
      }),
    );

    currentTime += 1000;

    const second = await coordinator.handleMessage(
      createMessage({
        eventId: "event-2",
        content: "Something else happened that was quite interesting.",
      }),
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(hearth.handleMessage).toHaveBeenCalledOnce();
  });

  it("ignores short messages for spontaneous participation", async () => {
    const hearth = createResponder("Hello!");

    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
      {
        spontaneousResponseChance: 1,
        random: () => 0,
      },
    );

    const result = await coordinator.handleMessage(
      createMessage({ content: "ok" }),
    );

    expect(result).toBeNull();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });

  it("does not reconsider an ignored event from another client", async () => {
    const hearth = createResponder("Hello!");
    const random = vi.fn(() => 0.99);

    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
      {
        spontaneousResponseChance: 0.1,
        random,
      },
    );

    const message = createMessage({
      content: "I finally finished my programming project today!",
    });

    await coordinator.handleMessage(message);
    await coordinator.handleMessage(message);

    expect(random).toHaveBeenCalledOnce();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });


  it("can decline a spontaneous response", async () => {
    const hearth = createResponder("Hello!");
    const shouldRespond = vi.fn().mockResolvedValue(false);

    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
      {
        spontaneousResponseChance: 1,
        random: () => 0,
        shouldRespond,
      },
    );

    const result = await coordinator.handleMessage(
      createMessage({
        content: "I finally finished my programming project today!",
      }),
    );

    expect(result).toBeNull();
    expect(shouldRespond).toHaveBeenCalledOnce();
    expect(hearth.handleMessage).not.toHaveBeenCalled();
  });

  it("does not apply the spontaneous decision check to direct mentions", async () => {
    const hearth = createResponder("Hello!");
    const shouldRespond = vi.fn().mockResolvedValue(false);

    const coordinator = new ConversationCoordinator(
      new Map([["hearth", hearth]]),
      {
        shouldRespond,
      },
    );

    const result = await coordinator.handleMessage(
      createMessage({
        mentionedCharacterIds: ["hearth"],
      }),
    );

    expect(result?.characterId).toBe("hearth");
    expect(hearth.handleMessage).toHaveBeenCalledOnce();
    expect(shouldRespond).not.toHaveBeenCalled();
  });
});
