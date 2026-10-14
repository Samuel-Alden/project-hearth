import type { CharacterProfile } from "../characters/character-profile.js";
import { getCharacterById } from "../characters/registry.js";
import type { StoredMessage } from "../database.js";

export interface CurrentMessage {
  userId: string;
  content: string;
}

/**
 * One transcript line. Continuation lines are indented so message text can
 * never begin a line with a speaker label of its own (for example a member
 * typing "Kai: ..."), which would forge a turn in the transcript.
 */
function formatLine(label: string, content: string): string {
  return `${label}: ${content.replace(/\r?\n/g, "\n  ")}`;
}

/**
 * Builds readable transcript lines from chronological history plus the
 * message being answered. Discord members get temporary "Member N" labels
 * (numbered per prompt) so raw Discord IDs are never sent to the AI provider.
 * Characters are labelled with their display names, so each character can
 * tell its own earlier lines apart from other characters' lines.
 */
export function buildTranscript(
  history: readonly StoredMessage[],
  current: CurrentMessage,
): string[] {
  const memberLabels = new Map<string, string>();

  const memberLabel = (speakerId: string): string => {
    let label = memberLabels.get(speakerId);

    if (!label) {
      label = `Member ${memberLabels.size + 1}`;
      memberLabels.set(speakerId, label);
    }

    return label;
  };

  const lines = history.map((entry) => {
    const speaker =
      entry.speakerType === "user"
        ? memberLabel(entry.speakerId)
        : (getCharacterById(entry.speakerId)?.name ?? "Character");

    return formatLine(speaker, entry.content);
  });

  lines.push(
    formatLine(
      `${memberLabel(current.userId)} (latest message)`,
      current.content,
    ),
  );

  return lines;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes this character's own speaker label when a model echoes it at the
 * very start of a reply, e.g. "[hearth]: [hearth]: hi" or "Hearth: hi".
 *
 * Deliberately narrow: only the character's own ID or name, only at the
 * start, so ordinary dialogue such as "Note: bring snacks" or another
 * character's name is never altered.
 */
export function stripLeadingSpeakerLabel(
  text: string,
  character: Pick<CharacterProfile, "id" | "name">,
): string {
  const names = [
    ...new Set([character.id, character.name].map(escapeRegExp)),
  ].join("|");

  const pattern = new RegExp(
    `^\\s*(?:\\[(?:${names})\\]|(?:${names}))\\s*:\\s*`,
    "i",
  );

  let result = text;
  let previous: string;

  // Repeat, because models sometimes echo the label several times.
  do {
    previous = result;
    result = result.replace(pattern, "");
  } while (result !== previous);

  return result;
}
