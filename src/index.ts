
import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

import { createDatabase } from "./database.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.DISCORD_TOKEN;

const projectRoot = dirname(
  dirname(fileURLToPath(import.meta.url))
);

const database = createDatabase(
  join(projectRoot, "data", "hearth.sqlite")
);

if (!token) {
  throw new Error(
    "DISCORD_TOKEN is missing. Check your .env file."
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log("Project Hearth is ready.");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "hearth") return;

  const response =
    "The hearth is lit. I'm awake and ready to begin.";

  try {
    await interaction.reply(response);

    const channelId = interaction.channelId ?? "unknown";
    const timestamp = new Date().toISOString();

    database.saveMessage({
      discordEventId: interaction.id,
      channelId,
      speakerType: "user",
      speakerId: interaction.user.id,
      content: "/hearth",
      createdAt: interaction.createdAt.toISOString(),
    });

    database.saveMessage({
      discordEventId: interaction.id,
      channelId,
      speakerType: "agent",
      speakerId: client.user?.id ?? "unknown",
      content: response,
      createdAt: timestamp,
    });

    console.log("Saved command and reply to SQLite.");
  } catch (error) {
    console.error("Command handling failed:", error);
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

function shutdown(): void {
  console.log("Shutting down Project Hearth...");

  client.destroy();
  database.close();

  console.log("Database closed.");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

client.login(token).catch((error: unknown) => {
  console.error("Failed to connect to Discord:", error);
  process.exitCode = 1;
});
