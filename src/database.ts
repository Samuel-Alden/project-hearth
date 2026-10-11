import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SpeakerType = "user" | "agent";

export interface NewMessage {
  discordEventId: string;
  channelId: string;
  speakerType: SpeakerType;
  speakerId: string;
  content: string;
  createdAt: string;
}

export interface StoredMessage extends NewMessage {
  id: number;
}

export function createDatabase(databasePath: string) {
  mkdirSync(dirname(databasePath), { recursive: true });

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

  const recentMessages = database.prepare(`
    SELECT
      id,
      discord_event_id AS discordEventId,
      channel_id AS channelId,
      speaker_type AS speakerType,
      speaker_id AS speakerId,
      content,
      created_at AS createdAt
    FROM messages
    WHERE channel_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);

  return {
    saveMessage(message: NewMessage): void {
      insertMessage.run(
        message.discordEventId,
        message.channelId,
        message.speakerType,
        message.speakerId,
        message.content,
        message.createdAt
      );
    },

    getRecentMessages(
      channelId: string,
      limit = 20
    ): StoredMessage[] {
      const safeLimit = Math.max(
        1,
        Math.min(Math.floor(limit), 100)
      );

      return recentMessages.all(
        channelId,
        safeLimit
      ) as unknown as StoredMessage[];
    },

    close(): void {
      database.close();
    },
  };
}
