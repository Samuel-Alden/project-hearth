/**
 * Why a provider call failed. The kind decides whether retrying can help.
 */
export type AIProviderErrorKind =
  | "rate_limit" // HTTP 429 or an equivalent error body
  | "server" // 5xx or an unclassified provider failure
  | "timeout" // the request timed out
  | "network" // the request never completed (DNS, connection reset...)
  | "empty" // a valid response with no usable text
  | "truncated" // the token budget ran out before any visible text
  | "refusal" // the model declined the request
  | "client" // 4xx: bad key, bad request, unknown model, no credits...
  | "malformed"; // the response body could not be read

// Transient failures that a fresh attempt can plausibly fix. "truncated" is
// deliberately excluded: the same budget would be exhausted again.
const RETRYABLE_KINDS: ReadonlySet<AIProviderErrorKind> = new Set([
  "rate_limit",
  "server",
  "timeout",
  "network",
  "empty",
  "malformed",
]);

export interface AIProviderErrorOptions {
  status?: number;
  retryAfterMs?: number;
  provider?: string;
  cause?: unknown;
}

export class AIProviderError extends Error {
  readonly kind: AIProviderErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly provider?: string;

  constructor(
    kind: AIProviderErrorKind,
    message: string,
    options: AIProviderErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = "AIProviderError";
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.provider = options.provider;
  }
}
