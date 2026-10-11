import { describe, expect, it } from "vitest";
import { Client } from "discord.js";

import { CharacterClientRegistry } from "../src/discord/character-client-registry.js";

describe("CharacterClientRegistry", () => {
  it("registers and retrieves a client by character ID", () => {
    const registry = new CharacterClientRegistry();
    const hearthClient = new Client({ intents: [] });

    registry.register("hearth", hearthClient);

    expect(registry.getClient("hearth")).toBe(hearthClient);
    expect(registry.hasClient("hearth")).toBe(true);

    hearthClient.destroy();
  });

  it("keeps different characters mapped to different clients", () => {
    const registry = new CharacterClientRegistry();
    const hearthClient = new Client({ intents: [] });
    const kaiClient = new Client({ intents: [] });

    registry.register("hearth", hearthClient);
    registry.register("kai", kaiClient);

    expect(registry.getClient("hearth")).toBe(hearthClient);
    expect(registry.getClient("kai")).toBe(kaiClient);
    expect(registry.getClient("hearth")).not.toBe(
      registry.getClient("kai"),
    );

    hearthClient.destroy();
    kaiClient.destroy();
  });

  it("returns undefined for an unknown character", () => {
    const registry = new CharacterClientRegistry();

    expect(registry.getClient("unknown")).toBeUndefined();
    expect(registry.hasClient("unknown")).toBe(false);
  });

  it("rejects an empty character ID", () => {
    const registry = new CharacterClientRegistry();
    const client = new Client({ intents: [] });

    expect(() => registry.register("  ", client)).toThrow(
      "Character ID cannot be empty.",
    );

    client.destroy();
  });

  it("rejects duplicate character IDs", () => {
    const registry = new CharacterClientRegistry();
    const firstClient = new Client({ intents: [] });
    const secondClient = new Client({ intents: [] });

    registry.register("hearth", firstClient);

    expect(() => registry.register("hearth", secondClient)).toThrow(
      'A Discord client is already registered for character "hearth".',
    );

    firstClient.destroy();
    secondClient.destroy();
  });

  it("lists registered character IDs", () => {
    const registry = new CharacterClientRegistry();

    const hearthClient = new Client({ intents: [] });
    const kaiClient = new Client({ intents: [] });

    registry.register("hearth", hearthClient);
    registry.register("kai", kaiClient);

    expect(registry.getRegisteredCharacterIds()).toEqual([
      "hearth",
      "kai",
    ]);

    hearthClient.destroy();
    kaiClient.destroy();
  });
});
