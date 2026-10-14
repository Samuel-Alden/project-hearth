import { describe, expect, it } from "vitest";

import { getFallbackCharacterId } from "../src/discord/failure-policy.js";

describe("getFallbackCharacterId", () => {
  it("lets an explicitly addressed character apologise", () => {
    expect(
      getFallbackCharacterId({
        explicitlyAddressed: true,
        selectedCharacterId: "kai",
      }),
    ).toBe("kai");
  });

  it("stays silent when the reply was spontaneous", () => {
    expect(
      getFallbackCharacterId({
        explicitlyAddressed: false,
        selectedCharacterId: "kai",
      }),
    ).toBeUndefined();
  });

  it("stays silent when no character had been selected", () => {
    expect(
      getFallbackCharacterId({
        explicitlyAddressed: true,
        selectedCharacterId: undefined,
      }),
    ).toBeUndefined();
  });

  it("stays silent when nothing was addressed or selected", () => {
    expect(
      getFallbackCharacterId({
        explicitlyAddressed: false,
        selectedCharacterId: undefined,
      }),
    ).toBeUndefined();
  });
});
