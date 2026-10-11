import { kai } from "./characters/kai.js";
import { CharacterClientRegistry } from "./discord/character-client-registry.js";

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

// Environment configuration
const token = process.env.DISCORD_TOKEN;
const apiKey = process.env.OPENROUTER_API_KEY;
const kaiToken = process.env.KAI_DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is missing. Check your .env file.");
}

if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is missing. Check your .env file.");
}

// Database
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const database = createDatabase(
  join(projectRoot, "data", "hearth.sqlite"),
);

// AI provider
const aiProvider = new OpenRouterProvider({
  apiKey,
  model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
});

// Conversation service
const conversationService = new ConversationService({
  database,
  aiProvider,
  character: hearth,
});

// Discord clients
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const kaiClient = kaiToken
  ? new Client({
      intents: [GatewayIntentBits.Guilds],
    })
  : undefined;

const characterClients = new CharacterClientRegistry();

characterClients.register(hearth.id, client);

if (kaiClient) {
  characterClients.register(kai.id, kaiClient);
}

console.log(
  "Registered character clients:",
  characterClients.getRegisteredCharacterIds().join(", "),
);

// Hearth connection events
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Hearth connected as ${readyClient.user.tag}`);
  console.log("Project Hearth is ready.");
});

// Kai connection events
kaiClient?.once(Events.ClientReady, (readyClient) => {
  console.log(`Kai connected as ${readyClient.user.tag}`);
});

kaiClient?.on(Events.Error, (error) => {
  console.error("Kai Discord client error:", error);
});

// Hearth message handling
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "hearth") return;

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

// General Discord client errors
client.on(Events.Error, (error) => {
  console.error("Hearth Discord client error:", error);
});

// Graceful shutdown
let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("Shutting down Project Hearth...");

  client.destroy();
  kaiClient?.destroy();

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

// Start the Discord clients
async function start(): Promise<void> {
  const loginTasks: Promise<void>[] = [];

  console.log("Attempting to connect Hearth...");

  loginTasks.push(
    client.login(token).then(() => {
      console.log("Hearth login completed.");
    }),
  );

  if (kaiClient && kaiToken) {
    console.log("Attempting to connect Kai...");

    loginTasks.push(
      kaiClient.login(kaiToken).then(() => {
        console.log("Kai login completed.");
      }),
    );
  } else {
    console.log(
      "Kai is not configured; only Hearth will connect.",
    );
  }

  const results = await Promise.allSettled(loginTasks);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("A Discord client failed to log in:", result.reason);
      process.exitCode = 1;
    }
  }
}

void start().catch((error: unknown) => {
  console.error("Failed to start Project Hearth:", error);
  process.exitCode = 1;
});
