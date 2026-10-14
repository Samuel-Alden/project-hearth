import { describe, expect, it, vi } from "vitest";

import { createParticipationDecider } from "../src/conversations/participation-decider.js";

describe("participation decider retry policy", () => {
  it("asks the provider once, without retries", async () => {
    const generateText = vi.fn().mockResolvedValue("YES");

    const decide = createParticipationDecider({
      aiProvider: { generateText },
      database: { getRecentMessages: () => [] },
    });

    const result = await decide(
      {
        eventId: "event-1",
        channelId: "channel-1",
        userId: "member-1",
        content: "I finally finished my programming project today!",
        createdAt: "2026-10-14T00:00:00.000Z",
        authorIsBot: false,
        mentionedCharacterIds: [],
      },
      "hearth",
    );

    expect(result).toBe(true);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    );
  });
});
