
import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./database.js";
import { OpenRouterProvider } from "./ai/openrouter-provider.js";
import { hearth } from "./characters/hearth.js";
import { ConversationService } from "./conversations/conversation-service.js";

// --------------------------------------------------
// Environment configuration
// --------------------------------------------------

const token = process.env.DISCORD_TOKEN;
const apiKey = process.env.OPENROUTER_API_KEY;

if (!token) {
  throw new Error(
    "DISCORD_TOKEN is missing. Check your .env file.",
  );
}

if (!apiKey) {
  throw new Error(
    "OPENROUTER_API_KEY is missing. Check your .env file.",
  );
}

// --------------------------------------------------
// Database
// --------------------------------------------------

const projectRoot = dirname(
  dirname(fileURLToPath(import.meta.url)),
);

const database = createDatabase(
  join(projectRoot, "data", "hearth.sqlite"),
);

// --------------------------------------------------
// AI provider
// --------------------------------------------------

const aiProvider = new OpenRouterProvider({
  apiKey,
  model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
});

// --------------------------------------------------
// Conversation service
// --------------------------------------------------

const conversationService = new ConversationService({
  database,
  aiProvider,
  character: hearth,
});

// --------------------------------------------------
// Discord client
// --------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log("Project Hearth is ready.");
});

// --------------------------------------------------
// Interaction handling
// --------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "hearth") return;

  // Acknowledge promptly. If Discord rejects the interaction,
  // stop instead of generating an undeliverable response.
  try {
    await interaction.deferReply();
  } catch (error) {
    console.error(
      "Could not acknowledge Discord interaction; skipping it:",
      error,
    );
    return;
  }

  try {
    const channelId = interaction.channelId;

    if (!channelId) {
      await interaction.editReply(
        "I couldn't identify this conversation's channel.",
      );
      return;
    }

    const userContent = interaction.options
      .getString("message", true)
      .trim();

    if (!userContent) {
      await interaction.editReply(
        "Your message cannot be empty. Try saying something!",
      );
      return;
    }

    const response = await conversationService.handleMessage({
      eventId: interaction.id,
      channelId,
      userId: interaction.user.id,
      content: userContent,
      createdAt: interaction.createdAt.toISOString(),
    });

    await interaction.editReply({
      content: response,
      allowedMentions: { parse: [] },
    });

    console.log("Conversation handled and reply delivered.");
  } catch (error) {
    console.error("Failed to handle /hearth:", error);

    try {
      await interaction.editReply(
        "I'm having trouble responding right now. Please try again in a little while.",
      );
    } catch (replyError) {
      console.error(
        "Failed to send the fallback reply:",
        replyError,
      );
    }
  }
});

// --------------------------------------------------
// Discord errors
// --------------------------------------------------

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

// --------------------------------------------------
// Graceful shutdown
// --------------------------------------------------

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("Shutting down Project Hearth...");

  client.destroy();

  try {
    database.close();
    console.log("Database closed.");
  } catch (error) {
    console.error("Failed to close the database:", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// --------------------------------------------------
// Start bot
// --------------------------------------------------

client.login(token).catch((error: unknown) => {
  console.error("Failed to connect to Discord:", error);
  process.exitCode = 1;
});
