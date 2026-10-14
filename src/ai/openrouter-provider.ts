import type {
  AIProvider,
  GenerateTextInput,
} from "./provider.js";
import {
  AIProviderError,
  type AIProviderErrorKind,
} from "./provider-error.js";

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
    code?: number | string;
    metadata?: {
      provider_name?: string;
      is_byok?: boolean;
    };
  };
  metadata?: {
    raw?: string;
    provider_name?: string;
    provider_error_code?: string;
    limit_source?: string;
    remedy_hint?: string;
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Retries after the first attempt for transient failures. Default 2. */
  maxRetries?: number;
  /** First backoff delay; doubles on each retry. Default 500 ms. */
  retryBaseDelayMs?: number;
  /** Replaceable so tests never wait in real time. */
  sleepImpl?: (milliseconds: number) => Promise<void>;
  /** Replaceable so tests get deterministic backoff jitter. */
  random?: () => number;
}

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES_LIMIT = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

// If the API asks us to wait longer than this, fail now rather than leaving
// a Discord conversation hanging.
const MAX_RETRY_AFTER_MS = 5_000;

function validateMaxRetries(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_RETRIES_LIMIT) {
    throw new Error(
      `maxRetries must be an integer from 0 to ${MAX_RETRIES_LIMIT}.`,
    );
  }
}

function kindForStatus(status: number): AIProviderErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status >= 500 && status <= 599) return "server";

  // 400, 401, 402, 403, 404...: a retry would fail the same way.
  return "client";
}

// Only the "seconds" form of Retry-After is supported. The HTTP-date form
// is ignored and ordinary backoff is used instead.
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !value.trim()) return undefined;

  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds < 0) return undefined;

  return Math.round(seconds * 1_000);
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
    ? error.name
    : undefined;
}

function providerNameOf(
  apiError: OpenRouterResponse["error"],
): string | undefined {
  const name = apiError?.metadata?.provider_name;

  return typeof name === "string" ? name : undefined;
}

export class OpenRouterProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(config: OpenRouterConfig) {
    if (!config.apiKey.trim()) {
      throw new Error("OpenRouter API key is required.");
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? "openrouter/free";
    this.baseUrl =
      config.baseUrl ?? "https://openrouter.ai/api/v1";
    this.fetchImpl = config.fetchImpl ?? fetch;

    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    validateMaxRetries(this.maxRetries);

    this.retryBaseDelayMs =
      config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.sleep =
      config.sleepImpl ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = config.random ?? Math.random;
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

    const maxRetries = input.maxRetries ?? this.maxRetries;
    validateMaxRetries(maxRetries);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce(input);
      } catch (error) {
        // Give up on non-provider errors, deterministic failures, and an
        // exhausted retry budget. The caller sees the real error.
        if (
          !(error instanceof AIProviderError) ||
          !error.retryable ||
          attempt >= maxRetries
        ) {
          throw error;
        }

        const delayMs = this.getRetryDelayMs(
          attempt,
          error.retryAfterMs,
        );

        // The API asked for a wait that is too long to be worth it.
        if (delayMs === undefined) throw error;

        // Never log the prompt, the key, or the raw provider payload.
        console.warn(
          `OpenRouter attempt ${attempt + 1} of ${maxRetries + 1} failed ` +
          `(kind=${error.kind}, status=${error.status ?? "n/a"}, ` +
          `provider=${error.provider ?? "unknown"}); ` +
          `retrying in ${delayMs}ms.`,
        );

        await this.sleep(delayMs);
      }
    }
  }

  // Exponential backoff with jitter (50% to 100% of the nominal delay).
  // A server-provided Retry-After is honored when it asks for longer.
  private getRetryDelayMs(
    attempt: number,
    retryAfterMs: number | undefined,
  ): number | undefined {
    const backoffMs =
      this.retryBaseDelayMs *
      2 ** attempt *
      (0.5 + 0.5 * this.random());

    if (retryAfterMs === undefined) return Math.round(backoffMs);

    if (retryAfterMs > MAX_RETRY_AFTER_MS) return undefined;

    return Math.round(Math.max(backoffMs, retryAfterMs));
  }

  // One request with no retry logic. Every failure is thrown as an
  // AIProviderError whose kind says whether trying again can help.
  private async requestOnce(
    input: GenerateTextInput,
  ): Promise<string> {
    let response: Response;

    try {
      response = await this.fetchImpl(
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );
    } catch (error) {
      const name = errorName(error);

      if (name === "TimeoutError" || name === "AbortError") {
        throw new AIProviderError(
          "timeout",
          `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1_000}s.`,
          { cause: error },
        );
      }

      throw new AIProviderError(
        "network",
        `OpenRouter network error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    const body: unknown = await response.json().catch(() => null);
    const data = body as OpenRouterResponse | null;

    if (!response.ok) {
      const apiError = data?.error;

      const message =
        typeof apiError?.message === "string"
          ? apiError.message
          : `HTTP ${response.status}`;

      throw new AIProviderError(
        kindForStatus(response.status),
        `OpenRouter request failed (${response.status}): ${message}`,
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(
            response.headers.get("retry-after"),
          ),
          provider: providerNameOf(apiError),
        },
      );
    }

    if (data === null) {
      throw new AIProviderError(
        "malformed",
        `OpenRouter returned an unreadable response (HTTP ${response.status}).`,
        { status: response.status },
      );
    }

    const choice = data.choices?.[0];
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
      throw new AIProviderError(
        "refusal",
        `The AI model declined the request: ${message.refusal}`,
      );
    }

    // OpenRouter can report a failure as an error object inside an
    // HTTP 200 response. Classify it by its code instead of calling it an
    // "empty response".
    if (data.error) {
      const code = Number(data.error.code);
      const status =
        Number.isInteger(code) && code >= 100 && code <= 599
          ? code
          : undefined;
      const errorMessage =
        typeof data.error.message === "string"
          ? data.error.message
          : "unknown error";

      throw new AIProviderError(
        // An error with no usable code is treated as a transient
        // provider failure.
        status === undefined ? "server" : kindForStatus(status),
        `OpenRouter request failed (${status ?? response.status}): ${errorMessage}`,
        {
          status,
          provider: providerNameOf(data.error),
        },
      );
    }

    const model = data.model ?? this.model;
    const finishReason = choice?.finish_reason ?? "unknown";
    const contentType =
      content === null
        ? "null"
        : Array.isArray(content)
          ? "array"
          : typeof content;

    const diagnostics =
      `OpenRouter returned no text content ` +
      `(model=${model}, finish_reason=${finishReason}, ` +
      `content_type=${contentType}).`;

    // A reasoning model can spend the whole token budget thinking. Retrying
    // with the same budget would fail the same way, so this is not retried.
    if (finishReason === "length") {
      throw new AIProviderError(
        "truncated",
        `${diagnostics} The model used its token budget before producing visible text.`,
      );
    }

    throw new AIProviderError("empty", diagnostics);
  }
}
