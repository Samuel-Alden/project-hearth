import { describe, expect, it } from "vitest";

import {
  characters,
  getCharacterById,
} from "../src/characters/registry.js";

describe("Character registry", () => {
  it("registers all four initial characters", () => {
    expect(characters.map((character) => character.id)).toEqual([
      "hearth",
      "kai",
      "mira",
      "ren",
    ]);
  });

  it("contains unique character IDs", () => {
    const ids = characters.map((character) => character.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides valid profiles for every character", () => {
    for (const character of characters) {
      expect(character.id.trim()).not.toBe("");
      expect(character.name.trim()).not.toBe("");
      expect(character.role.trim()).not.toBe("");

      expect(character.personality.length).toBeGreaterThan(0);
      expect(character.socialBehavior.length).toBeGreaterThan(0);
      expect(character.communicationGuidelines.length).toBeGreaterThan(0);

      for (const entries of [
        character.personality,
        character.socialBehavior,
        character.communicationGuidelines,
      ]) {
        for (const entry of entries) {
          expect(entry.trim()).not.toBe("");
        }
      }
    }
  });

  it("retrieves characters by ID", () => {
    expect(getCharacterById("hearth")?.name).toBe("Hearth");
    expect(getCharacterById("kai")?.name).toBe("Kai");
    expect(getCharacterById("mira")?.name).toBe("Mira");
    expect(getCharacterById("ren")?.name).toBe("Ren");
  });

  it("returns undefined for an unknown character", () => {
    expect(getCharacterById("unknown")).toBeUndefined();
  });
});
