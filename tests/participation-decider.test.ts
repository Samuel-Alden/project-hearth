import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../src/ai/provider.js";
import type { StoredMessage } from "../src/database.js";
import {
  createParticipationDecider,
} from "../src/conversations/participation-decider.js";
import type {
  CoordinatedMessage,
} from "../src/conversations/conversation-coordinator.js";

function createStoredMessage(
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  return {
    id: 1,
    discordEventId: "earlier-event",
    channelId: "channel-1",
    speakerType: "user",
    speakerId: "user-1",
    content: "Earlier message",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function createMessage(
  overrides: Partial<CoordinatedMessage> = {},
): CoordinatedMessage {
  return {
    eventId: "current-event",
    channelId: "channel-1",
    userId: "user-1",
    content: "I finally finished my programming project today!",
    createdAt: new Date().toISOString(),
    authorIsBot: false,
    mentionedCharacterIds: [],
    ...overrides,
  };
}

describe("createParticipationDecider", () => {
  it("approves a clear YES decision", async () => {
    const aiProvider: AIProvider = {
      generateText: vi.fn().mockResolvedValue("YES"),
    };

    const database = {
      getRecentMessages: vi.fn().mockReturnValue([
        createStoredMessage(),
      ]),
    };

    const decider = createParticipationDecider({
      aiProvider,
      database,
    });

    const result = await decider(createMessage(), "hearth");

    expect(result).toBe(true);
    expect(aiProvider.generateText).toHaveBeenCalledOnce();

    expect(aiProvider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 128,
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Earlier message"),
          }),
        ],
      }),
    );
  });

  it("declines a NO decision", async () => {
    const aiProvider: AIProvider = {
      generateText: vi.fn().mockResolvedValue("NO"),
    };

    const database = {
      getRecentMessages: vi.fn().mockReturnValue([]),
    };

    const decider = createParticipationDecider({
      aiProvider,
      database,
    });

    const result = await decider(createMessage(), "hearth");

    expect(result).toBe(false);
  });

  it("does not include the current event twice", async () => {
    const aiProvider: AIProvider = {
      generateText: vi.fn().mockResolvedValue("YES"),
    };

    const database = {
      getRecentMessages: vi.fn().mockReturnValue([
        createStoredMessage({
          id: 2,
          discordEventId: "current-event",
          content: "I finally finished my programming project today!",
        }),
        createStoredMessage({
          id: 1,
          discordEventId: "earlier-event",
          content: "Earlier conversation",
        }),
      ]),
    };

    const decider = createParticipationDecider({
      aiProvider,
      database,
    });

    await decider(createMessage(), "hearth");

    const call = vi.mocked(aiProvider.generateText).mock.calls[0]?.[0];

    expect(call).toBeDefined();

    const prompt = call!.messages[0]?.content ?? "";

    expect(prompt).toContain("Earlier conversation");
    expect(prompt).toContain("I finally finished my programming project today!");
    expect(prompt.match(/I finally finished my programming project today!/g))
      .toHaveLength(1);
  });

  it("declines unknown characters without calling the AI", async () => {
    const aiProvider: AIProvider = {
      generateText: vi.fn(),
    };

    const database = {
      getRecentMessages: vi.fn().mockReturnValue([]),
    };

    const decider = createParticipationDecider({
      aiProvider,
      database,
    });

    const result = await decider(createMessage(), "unknown-character");

    expect(result).toBe(false);
    expect(aiProvider.generateText).not.toHaveBeenCalled();
  });
});
