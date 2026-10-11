
import type {
  AIProvider,
  GenerateTextInput,
} from "./provider.js";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenRouterProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenRouterConfig) {
    if (!config.apiKey.trim()) {
      throw new Error("OpenRouter API key is required.");
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? "openrouter/free";
    this.baseUrl =
      config.baseUrl ?? "https://openrouter.ai/api/v1";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateText(input: GenerateTextInput): Promise<string> {
    if (!input.system.trim()) {
      throw new Error("System instructions cannot be empty.");
    }

    if (
      !Number.isInteger(input.maxOutputTokens) ||
      input.maxOutputTokens < 1 ||
      input.maxOutputTokens > 4096
    ) {
      throw new Error(
        "maxOutputTokens must be an integer from 1 to 4096."
      );
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            ...input.messages,
          ],
          max_tokens: input.maxOutputTokens,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const errorBody = body as OpenRouterResponse | null;
      const message =
        typeof errorBody?.error?.message === "string"
          ? errorBody.error.message
          : `HTTP ${response.status}`;

      throw new Error(`OpenRouter request failed: ${message}`);
    }

    const data = body as OpenRouterResponse | null;
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      throw new Error(
        "OpenRouter returned no text content."
      );
    }

    return content.trim();
  }
}
