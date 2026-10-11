
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SpeakerType = "user" | "agent";

export interface NewMessage {
  discordEventId: string;
  channelId: string;
  speakerType: SpeakerType;
  speakerId: string;
  content: string;
  createdAt: string;
}

const projectRoot = dirname(
  dirname(fileURLToPath(import.meta.url))
);

const dataDirectory = join(projectRoot, "data");

mkdirSync(dataDirectory, { recursive: true });

const databasePath = join(dataDirectory, "hearth.sqlite");

const database = new DatabaseSync(databasePath);

database.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_event_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    speaker_type TEXT NOT NULL
      CHECK (speaker_type IN ('user', 'agent')),
    speaker_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages(channel_id, created_at);
`);

const insertMessage = database.prepare(`
  INSERT INTO messages (
    discord_event_id,
    channel_id,
    speaker_type,
    speaker_id,
    content,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
`);

export function saveMessage(message: NewMessage): void {
  insertMessage.run(
    message.discordEventId,
    message.channelId,
    message.speakerType,
    message.speakerId,
    message.content,
    message.createdAt
  );
}

export function closeDatabase(): void {
  database.close();
}
