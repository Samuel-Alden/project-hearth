
import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

const token = process.env.DISCORD_TOKEN;

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

  try {
    await interaction.reply(
      "The hearth is lit. I'm awake and ready to begin."
    );
  } catch (error) {
    console.error("Failed to respond to command:", error);
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.login(token).catch((error: unknown) => {
  console.error("Failed to connect to Discord:", error);
  process.exitCode = 1;
});
