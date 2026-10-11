
import {
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";


const token = process.env.DISCORD_TOKEN;
const rawClientId = process.env.DISCORD_CLIENT_ID;
const rawGuildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN is missing.");
}

if (!rawClientId) {
  throw new Error("DISCORD_CLIENT_ID is missing.");
}

if (!rawGuildId) {
  throw new Error("DISCORD_GUILD_ID is missing.");
}

const clientId: string = rawClientId;
const guildId: string = rawGuildId;


const commands = [
  new SlashCommandBuilder()
    .setName("hearth")
    .setDescription("Talk with Hearth.")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("What would you like to say?")
        .setRequired(true)
        .setMaxLength(1500),
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(token);

async function main(): Promise<void> {
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );

  console.log("Registered /hearth in the test server.");
}

main().catch((error: unknown) => {
  console.error("Command registration failed:", error);
  process.exitCode = 1;
});
