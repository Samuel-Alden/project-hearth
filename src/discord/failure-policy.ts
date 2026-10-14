export interface FallbackReplyInput {
  /** True when the user replied to, or @mentioned, a configured character. */
  explicitlyAddressed: boolean;
  /** The character chosen to respond before the failure, if any. */
  selectedCharacterId: string | undefined;
}

/**
 * Returns the character that should post a public "I'm having trouble"
 * message after reply generation failed, or undefined to stay silent.
 *
 * Only a user who explicitly addressed a character is waiting for an
 * answer. A spontaneous reply nobody asked for should fail quietly,
 * otherwise an optional contribution turns into visible error spam.
 */
export function getFallbackCharacterId(
  input: FallbackReplyInput,
): string | undefined {
  if (!input.explicitlyAddressed) return undefined;

  return input.selectedCharacterId;
}
