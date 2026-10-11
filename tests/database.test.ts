
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/database.js";

const temporaryDirectories: string[] = [];
const openDatabases: Array<ReturnType<typeof createDatabase>> = [];

function createTestDatabase() {
  const directory = mkdtempSync(
    join(tmpdir(), "hearth-test-")
  );

  temporaryDirectories.push(directory);

  const database = createDatabase(
    join(directory, "test.sqlite")
  );

  openDatabases.push(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Hearth database", () => {
  it("saves and retrieves a message", () => {
    const database = createTestDatabase();

    database.saveMessage({
      discordEventId: "event-1",
      channelId: "channel-1",
      speakerType: "user",
      speakerId: "user-1",
      content: "Hello, Hearth!",
      createdAt: "2026-10-11T10:00:00.000Z",
    });

    const messages = database.getRecentMessages("channel-1");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      channelId: "channel-1",
      speakerType: "user",
      speakerId: "user-1",
      content: "Hello, Hearth!",
    });
  });

  it("does not return messages from another channel", () => {
    const database = createTestDatabase();

    database.saveMessage({
      discordEventId: "event-2",
      channelId: "channel-A",
      speakerType: "user",
      speakerId: "user-1",
      content: "Private channel message",
      createdAt: "2026-10-11T10:00:00.000Z",
    });

    expect(
      database.getRecentMessages("channel-B")
    ).toHaveLength(0);
  });

  it("preserves messages after reopening the database", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "hearth-restart-test-")
    );

    temporaryDirectories.push(directory);

    const path = join(directory, "restart.sqlite");
    const first = createDatabase(path);
    openDatabases.push(first);

    first.saveMessage({
      discordEventId: "event-3",
      channelId: "channel-1",
      speakerType: "agent",
      speakerId: "hearth",
      content: "I remember this.",
      createdAt: "2026-10-11T10:00:00.000Z",
    });

    first.close();
    openDatabases.pop();

    const reopened = createDatabase(path);
    openDatabases.push(reopened);

    expect(
      reopened.getRecentMessages("channel-1")[0]?.content
    ).toBe("I remember this.");
  });
});
