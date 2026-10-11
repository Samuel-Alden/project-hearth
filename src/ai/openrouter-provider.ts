import type {
  AIProvider,
  GenerateTextInput,
} from "./provider.js";


interface OpenRouterResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: unknown;
      refusal?: unknown;
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
    const choice = data?.choices?.[0];
    const message = choice?.message;
    const content = message?.content;

    let textContent: string | undefined;

    if (typeof content === "string") {
      textContent = content;
    } else if (Array.isArray(content)) {
      // Some compatible APIs return content as text blocks.
      textContent = content
        .map((part) => {
          if (
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }

          return "";
        })
        .join("");
    }

    if (textContent?.trim()) {
      return textContent.trim();
    }

    if (
      typeof message?.refusal === "string" &&
      message.refusal.trim()
    ) {
      throw new Error(
        `The AI model declined the request: ${message.refusal}`,
      );
    }

    const model = data?.model ?? this.model;
    const finishReason = choice?.finish_reason ?? "unknown";
    const contentType =
      content === null
        ? "null"
        : Array.isArray(content)
          ? "array"
          : typeof content;

    throw new Error(
      `OpenRouter returned no text content ` +
      `(model=${model}, finish_reason=${finishReason}, ` +
      `content_type=${contentType}).`,
    );
  }
}
