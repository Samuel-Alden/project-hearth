
import { OpenRouterProvider } from "./openrouter-provider.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL ?? "openrouter/free";

if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is missing from .env.");
}

const provider = new OpenRouterProvider({
  apiKey,
  model,
});

async function main(): Promise<void> {
  console.log(`Testing AI provider with model: ${model}`);

  const response = await provider.generateText({
    system:
      "You are Hearth, a friendly fictional character. " +
      "Reply in one short sentence.",
    messages: [
      { role: "user", content: "Say hello to me." },
    ],
    maxOutputTokens: 100,
  });

  console.log("\nModel response:");
  console.log(response);
}

main().catch((error: unknown) => {
  console.error("AI smoke test failed:", error);
  process.exitCode = 1;
});
