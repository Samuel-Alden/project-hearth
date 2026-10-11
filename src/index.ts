import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
} from "discord.js";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./database.js";
import { OpenRouterProvider } from "./ai/openrouter-provider.js";

import { hearth } from "./characters/hearth.js";
import { kai } from "./characters/kai.js";

import { CharacterClientRegistry } from "./discord/character-client-registry.js";
import { ConversationService } from "./conversations/conversation-service.js";
import {
  ConversationCoordinator,
  type CharacterResponder,
} from "./conversations/conversation-coordinator.js";

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

// Shared AI provider
const aiProvider = new OpenRouterProvider({
  apiKey,
  model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
});

// One conversation service per character
const hearthConversationService = new ConversationService({
  database,
  aiProvider,
  character: hearth,
});

const kaiConversationService = new ConversationService({
  database,
  aiProvider,
  character: kai,
});

// Discord clients
// Both clients need these intents to read ordinary guild messages.
const messageIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

const client = new Client({ intents: messageIntents });

const kaiClient = kaiToken
  ? new Client({ intents: messageIntents })
  : undefined;

// Map character IDs to their Discord clients
const characterClients = new CharacterClientRegistry();

characterClients.register(hearth.id, client);

if (kaiClient) {
  characterClients.register(kai.id, kaiClient);
}

// Register only characters whose Discord accounts are configured.
const characterResponders = new Map<string, CharacterResponder>();

characterResponders.set(hearth.id, hearthConversationService);

if (kaiClient) {
  characterResponders.set(kai.id, kaiConversationService);
}

// Shared coordinator
const conversationCoordinator = new ConversationCoordinator(
  characterResponders,
);

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

client.on(Events.Error, (error) => {
  console.error("Hearth Discord client error:", error);
});

kaiClient?.on(Events.Error, (error) => {
  console.error("Kai Discord client error:", error);
});

// Send a message using the selected character's own Discord account.
async function sendAsCharacter(
  characterId: string,
  sourceMessage: Message,
  content: string,
): Promise<void> {
  const targetClient = characterClients.getClient(characterId);

  if (!targetClient) {
    throw new Error(`No Discord client registered for "${characterId}".`);
  }

  const targetChannel = await targetClient.channels.fetch(
    sourceMessage.channelId,
  );

  if (
    !targetChannel ||
    !targetChannel.isTextBased() ||
    !("send" in targetChannel) ||
    typeof targetChannel.send !== "function"
  ) {
    throw new Error(
      `Character "${characterId}" cannot send messages to this channel.`,
    );
  }

  await targetChannel.send({
    content,
    reply: {
      messageReference: sourceMessage.id,
      failIfNotExists: false,
    },
    allowedMentions: { parse: [] },
  });
}

// Display the typing indicator as the character that will respond.
async function showTypingAsCharacter(
  characterId: string,
  channelId: string,
): Promise<void> {
  const targetClient = characterClients.getClient(characterId);

  if (!targetClient) return;

  const channel = await targetClient.channels.fetch(channelId);

  if (
    !channel ||
    !channel.isTextBased() ||
    !("sendTyping" in channel) ||
    typeof channel.sendTyping !== "function"
  ) {
    return;
  }

  await channel.sendTyping();
}


async function handleCharacterMessage(message: Message): Promise<void> {
  // Never let the characters trigger one another.
  if (message.author.bot) return;
  if (!message.inGuild()) return;

  const content = message.content.trim();
  if (!content) return;

  const registeredIds =
    characterClients.getRegisteredCharacterIds();

  // Find characters explicitly mentioned in the message.
  const mentionedCharacterIds = registeredIds.filter(
    (characterId) => {
      const characterClient =
        characterClients.getClient(characterId);

      return characterClient?.user
        ? message.mentions.has(characterClient.user)
        : false;
    },
  );

  // Find the character being replied to, if any.
  let repliedToCharacterId: string | undefined;

  if (message.reference?.messageId) {
    try {
      const referenceChannelId = message.reference.channelId;

      if (
        !referenceChannelId ||
        referenceChannelId === message.channelId
      ) {
        const referencedMessage =
          await message.channel.messages.fetch(
            message.reference.messageId,
          );

        repliedToCharacterId = registeredIds.find(
          (characterId) => {
            const characterClient =
              characterClients.getClient(characterId);

            return (
              characterClient?.user?.id ===
              referencedMessage.author.id
            );
          },
        );
      }
    } catch (error) {
      console.warn(
        "Could not identify the replied-to character:",
        error,
      );
    }
  }

  // Prefer a valid reply target, then an explicit mention.
  const targetCharacterId =
    (
      repliedToCharacterId &&
      characterResponders.has(repliedToCharacterId)
        ? repliedToCharacterId
        : undefined
    ) ??
    mentionedCharacterIds.find((id) =>
      characterResponders.has(id),
    );

  // Remove only Hearth/Kai mentions, preserving other user mentions.
  const characterUserIds = new Set(
    registeredIds.flatMap((characterId) => {
      const characterClient =
        characterClients.getClient(characterId);

      return characterClient?.user
        ? [characterClient.user.id]
        : [];
    }),
  );

  const cleanedContent = content
    .replace(
      /<@!?(\d+)>/g,
      (mention, mentionedUserId: string) =>
        characterUserIds.has(mentionedUserId) ? "" : mention,
    )
    .trim();

  // A mention without accompanying text gets a simple prompt.
  if (!cleanedContent) {
    if (!targetCharacterId) return;

    if (handledEmptyMentionEvents.has(message.id)) return;
    handledEmptyMentionEvents.add(message.id);

    try {
      await sendAsCharacter(
        targetCharacterId,
        message,
        "Hey! What would you like to talk about?",
      );
    } catch (error) {
      console.error(
        "Failed to send the character prompt:",
        error,
      );
    }

    return;
  }

  // The coordinator may select a character spontaneously, so we
  // update this when it chooses who will respond.
  let respondingCharacterId = targetCharacterId;

  try {
    const result = await conversationCoordinator.handleMessage({
      eventId: message.id,
      channelId: message.channelId,
      userId: message.author.id,
      content: cleanedContent,
      createdAt: message.createdAt.toISOString(),
      authorIsBot: message.author.bot,
      mentionedCharacterIds,
      repliedToCharacterId,

      onResponseSelected: async (characterId) => {
        respondingCharacterId = characterId;

        await showTypingAsCharacter(
          characterId,
          message.channelId,
        );
      },
    });

    // No response is normal: the coordinator may decide to stay quiet.
    if (!result) return;

    // Always send from the character selected by the coordinator.
    await sendAsCharacter(
      result.characterId,
      message,
      result.content,
    );

    console.log(
      `${result.characterId} responded in ${message.channelId}.`,
    );
  } catch (error) {
    console.error(
      "Failed to handle ordinary Discord message:",
      error,
    );

    // If the AI failed after selecting a character, send the fallback
    // as that character rather than as the account that received the event.
    if (!respondingCharacterId) return;

    try {
      await sendAsCharacter(
        respondingCharacterId,
        message,
        "I'm having trouble responding right now. Please try again shortly.",
      );
    } catch (replyError) {
      console.error(
        "Failed to send fallback reply:",
        replyError,
      );
    }
  }
}

// Keep track of mention-only messages because they bypass AI processing.
const handledEmptyMentionEvents = new Set<string>();

// Both clients use the same handler and coordinator.
client.on(Events.MessageCreate, handleCharacterMessage);
kaiClient?.on(Events.MessageCreate, handleCharacterMessage);

// Preserve the existing /hearth slash command.
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

    const response =
      await hearthConversationService.handleMessage({
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

// Start both configured Discord clients.
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
      console.error(
        "A Discord client failed to log in:",
        result.reason,
      );
      process.exitCode = 1;
    }
  }
}

void start().catch((error: unknown) => {
  console.error("Failed to start Project Hearth:", error);
  process.exitCode = 1;
});
