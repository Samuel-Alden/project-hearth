import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConversationService,
} from "../src/conversations/conversation-service.js";

import type {
  AIProvider,
} from "../src/ai/provider.js";

import type {
  CharacterProfile,
} from "../src/characters/character-profile.js";

import type {
  NewMessage,
  StoredMessage,
} from "../src/database.js";

const character: CharacterProfile = {
  id: "hearth",
  name: "Hearth",
  role: "A social organizer.",
  personality: ["Friendly and playful."],
  socialBehavior: ["Help conversations get started."],
  communicationGuidelines: ["Be natural and concise."],
};

const input = {
  eventId: "event-123",
  channelId: "channel-123",
  userId: "user-123",
  content: "  Hello, Hearth!  ",
  createdAt: "2026-10-11T10:00:00.000Z",
};

function storedMessage(
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  return {
    id: 1,
    discordEventId: "old-event",
    channelId: "channel-123",
    speakerType: "user",
    speakerId: "user-123",
    content: "Earlier message",
    createdAt: "2026-10-11T09:00:00.000Z",
    ...overrides,
  };
}

describe("ConversationService", () => {
  let saveMessage: ReturnType<
    typeof vi.fn<(message: NewMessage) => void>
  >;

  let getRecentMessages: ReturnType<
    typeof vi.fn<
      (channelId: string, limit?: number) => StoredMessage[]
    >
  >;

  let generateText: ReturnType<
    typeof vi.fn<AIProvider["generateText"]>
  >;

  let service: ConversationService;

  beforeEach(() => {
    saveMessage = vi.fn<(message: NewMessage) => void>();

    getRecentMessages = vi.fn<
      (channelId: string, limit?: number) => StoredMessage[]
    >().mockReturnValue([]);

    generateText = vi.fn<AIProvider["generateText"]>()
      .mockResolvedValue("Hello! Great to see you.");

    service = new ConversationService({
      database: {
        saveMessage,
        getRecentMessages,
      },
      aiProvider: { generateText },
      character,
    });
  });

  it("saves the real user message and generated reply", async () => {
    const response = await service.handleMessage(input);

    expect(response).toBe("Hello! Great to see you.");

    expect(saveMessage).toHaveBeenCalledTimes(2);

    expect(saveMessage).toHaveBeenNthCalledWith(1, {
      discordEventId: "event-123",
      channelId: "channel-123",
      speakerType: "user",
      speakerId: "user-123",
      content: "Hello, Hearth!",
      createdAt: input.createdAt,
    });

    expect(saveMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        discordEventId: "event-123",
        channelId: "channel-123",
        speakerType: "agent",
        speakerId: "hearth",
        content: "Hello! Great to see you.",
      }),
    );
  });

  it("uses recent history and the character profile", async () => {
    getRecentMessages.mockReturnValue([
      storedMessage({
        id: 2,
        speakerType: "agent",
        speakerId: "hearth",
        content: "Earlier reply",
      }),
      storedMessage({
        id: 1,
        content: "Earlier message",
      }),
    ]);

    await service.handleMessage(input);

    expect(getRecentMessages).toHaveBeenCalledWith(
      "channel-123",
      21,
    );

    expect(generateText).toHaveBeenCalledWith({
      system: expect.stringContaining("You are Hearth"),
      messages: [
        {
          role: "user",
          content: "[Discord member user-123]: Earlier message",
        },
        {
          role: "assistant",
          content: "[hearth]: Earlier reply",
        },
        {
          role: "user",
          content: "Hello, Hearth!",
        },
      ],
      maxOutputTokens: 800,
    });
  });

  it("does not generate a reply for an empty message", async () => {
    await expect(
      service.handleMessage({
        ...input,
        content: "   ",
      }),
    ).rejects.toThrow("Message cannot be empty.");

    expect(saveMessage).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("does not save an assistant reply when generation fails", async () => {
    generateText.mockRejectedValue(
      new Error("Simulated provider failure"),
    );

    await expect(
      service.handleMessage(input),
    ).rejects.toThrow("Simulated provider failure");

    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerType: "user",
        content: "Hello, Hearth!",
      }),
    );
  });

  it("ignores legacy command-only history", async () => {
    getRecentMessages.mockReturnValue([
      storedMessage({
        id: 2,
        content: "/hearth",
      }),
      storedMessage({
        id: 1,
        content: "A real earlier message",
      }),
    ]);

    await service.handleMessage(input);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: "[Discord member user-123]: A real earlier message" },
          { role: "user", content: "Hello, Hearth!" },
        ],
      }),
    );
  });
});
