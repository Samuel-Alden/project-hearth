import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  type CharacterProfile,
} from "../src/characters/character-profile.js";
import { hearth } from "../src/characters/hearth.js";

describe("Character profiles", () => {
  it("defines Hearth's identity and social role", () => {
    expect(hearth.id).toBe("hearth");
    expect(hearth.name).toBe("Hearth");
    expect(hearth.role).toContain("social organizer");
  });

  it("builds a prompt containing Hearth's personality", () => {
    const prompt = buildSystemPrompt(hearth);

    expect(prompt).toContain("You are Hearth");
    expect(prompt).toContain("Personality:");
    expect(prompt).toContain("Social behavior:");
    expect(prompt).toContain("Communication guidelines:");
    expect(prompt).toContain("without dominating them");
    expect(prompt).toContain("Never claim to be human");
  });

  it("supports a different character without changing the builder", () => {
    const testCharacter: CharacterProfile = {
      id: "test-character",
      name: "Test Character",
      role: "A quiet observer.",
      personality: ["Thoughtful and reserved."],
      socialBehavior: ["Listen before responding."],
      communicationGuidelines: ["Keep responses brief."],
    };

    const prompt = buildSystemPrompt(testCharacter);

    expect(prompt).toContain("You are Test Character");
    expect(prompt).toContain("Thoughtful and reserved.");
    expect(prompt).toContain("Listen before responding.");
    expect(prompt).toContain("Keep responses brief.");
    expect(prompt).not.toContain("You are Hearth");
  });
});
