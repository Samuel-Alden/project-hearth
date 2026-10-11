import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./database.js";
import { OpenRouterProvider } from "./ai/openrouter-provider.js";
import type { AIMessage } from "./ai/provider.js";

import { hearth } from "./characters/hearth.js";
import { buildSystemPrompt } from "./characters/character-profile.js";

const token = process.env.DISCORD_TOKEN;
const apiKey = process.env.OPENROUTER_API_KEY;

if (!token) {
  throw new Error("DISCORD_TOKEN is missing. Check your .env file.");
}

if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is missing. Check your .env file.");
}

const projectRoot = dirname(
  dirname(fileURLToPath(import.meta.url)),
);

const database = createDatabase(
  join(projectRoot, "data", "hearth.sqlite"),
);

const aiProvider = new OpenRouterProvider({
  apiKey,
  model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
});

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

    // Load previous messages before saving this new request.
    const history = database
      .getRecentMessages(channelId, 10)
      .reverse();

    const messages: AIMessage[] = history.map((message) => ({
      role: message.speakerType === "user" ? "user" : "assistant",
      content: message.content,
    }));

    const userMessage = {
      discordEventId: interaction.id,
      channelId,
      speakerType: "user" as const,
      speakerId: interaction.user.id,
      content: "/hearth",
      createdAt: interaction.createdAt.toISOString(),
    };

    // Save the incoming request before calling the AI.
    database.saveMessage(userMessage);
    messages.push({ role: "user", content: "/hearth" });

    const generatedText = await aiProvider.generateText({
      system: buildSystemPrompt(hearth),
      messages,
      maxOutputTokens: 800,
    });

    // Keep the reply within Discord's message length limit.
    const response =
      generatedText.length > 1900
        ? `${generatedText.slice(0, 1897)}...`
        : generatedText;

    // Persist the reply before sending it to Discord.
    database.saveMessage({
      discordEventId: interaction.id,
      channelId,
      speakerType: "agent",
      speakerId: client.user?.id ?? "unknown",
      content: response,
      createdAt: new Date().toISOString(),
    });

    await interaction.editReply({
      content: response,
      allowedMentions: { parse: [] },
    });

    console.log("AI reply generated and conversation saved.");
  } catch (error) {
    console.error("Failed to handle /hearth:", error);

    try {
      await interaction.editReply(
        "I'm having trouble responding right now. Please try again in a little while.",
      );
    } catch (replyError) {
      console.error("Failed to send the fallback reply:", replyError);
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

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
