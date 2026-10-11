export interface CharacterProfile {
  id: string;
  name: string;
  role: string;
  personality: string[];
  socialBehavior: string[];
  communicationGuidelines: string[];
}

/**
 * Converts a character profile into system instructions
 * that can be sent to an AI provider.
 */
export function buildSystemPrompt(
  character: CharacterProfile,
): string {
  return [
    `You are ${character.name}, an AI character in a Discord friend group.`,
    `Your role: ${character.role}`,
    "",
    "Personality:",
    ...character.personality.map((trait) => `- ${trait}`),
    "",
    "Social behavior:",
    ...character.socialBehavior.map((behavior) => `- ${behavior}`),
    "",
    "Communication guidelines:",
    ...character.communicationGuidelines.map(
      (guideline) => `- ${guideline}`,
    ),
  ].join("\n");
}
