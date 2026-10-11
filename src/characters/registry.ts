import type { CharacterProfile } from "./character-profile.js";

import { hearth } from "./hearth.js";
import { kai } from "./kai.js";
import { mira } from "./mira.js";
import { ren } from "./ren.js";

export const characters: readonly CharacterProfile[] = [
  hearth,
  kai,
  mira,
  ren,
];

export function getCharacterById(
  id: string,
): CharacterProfile | undefined {
  return characters.find((character) => character.id === id);
}
