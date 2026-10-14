import { describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "../src/ai/openrouter-provider.js";
import { AIProviderError } from "../src/ai/provider-error.js";

function createProvider(fetchMock: typeof fetch) {
  return new OpenRouterProvider({
    apiKey: "test-key-not-real",
    fetchImpl: fetchMock,
  });
}

// A provider whose retries never wait and whose jitter is fixed, so the
// backoff delays are exactly 500 ms, then 1000 ms.
function createRetryProvider(fetchMock: typeof fetch) {
  const sleep = vi.fn(async (_milliseconds: number) => {});

  const provider = new OpenRouterProvider({
    apiKey: "test-key-not-real",
    fetchImpl: fetchMock,
    sleepImpl: sleep,
    random: () => 1,
  });

  return { provider, sleep };
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), init);
}

function okBody(text: string) {
  return { choices: [{ message: { content: text } }] };
}

const request = {
  system: "You are a character.",
  messages: [{ role: "user" as const, content: "Hello" }],
  maxOutputTokens: 100,
};

// Resolves to the AIProviderError the call rejected with.
async function failureOf(promise: Promise<unknown>): Promise<AIProviderError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(AIProviderError);

  return error as AIProviderError;
}

describe("OpenRouterProvider", () => {
  it("sends chat messages and returns generated text", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Hello from a simulated model.",
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const provider = createProvider(fetchMock);

    const result = await provider.generateText({
      system: "You are a friendly character.",
      messages: [
        { role: "user", content: "Hello!" },
      ],
      maxOutputTokens: 100,
    });

    expect(result).toBe("Hello from a simulated model.");
    expect(fetchMock).toHaveBeenCalledOnce();

    const call = fetchMock.mock.calls[0];
    const options = call?.[1];

    expect(options?.method).toBe("POST");

    const body = JSON.parse(String(options?.body));

    expect(body.model).toBe("openrouter/free");
    expect(body.messages).toEqual([
      {
        role: "system",
        content: "You are a friendly character.",
      },
      {
        role: "user",
        content: "Hello!",
      },
    ]);
    expect(body.max_tokens).toBe(100);
  });

  it("reports API errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Rate limit exceeded" },
        }),
        { status: 429 }
      )
    );

    const provider = createProvider(fetchMock);

    await expect(
      provider.generateText({
        system: "You are a character.",
        messages: [
          { role: "user", content: "Hello" },
        ],
        maxOutputTokens: 100,
        // A mocked Response can only be read once, so no retries here.
        maxRetries: 0,
      })
    ).rejects.toThrow("Rate limit exceeded");
  });

  it("rejects empty model responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "   " } },
          ],
        }),
        { status: 200 }
      )
    );

    const provider = createProvider(fetchMock);

    await expect(
      provider.generateText({
        system: "You are a character.",
        messages: [
          { role: "user", content: "Hello" },
        ],
        maxOutputTokens: 100,
        // A mocked Response can only be read once, so no retries here.
        maxRetries: 0,
      })
    ).rejects.toThrow("no text content");
  });

  it("rejects invalid token limits before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = createProvider(fetchMock);

    await expect(
      provider.generateText({
        system: "You are a character.",
        messages: [],
        maxOutputTokens: 0,
      })
    ).rejects.toThrow("maxOutputTokens");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenRouterProvider retries", () => {
  it("retries a rate limit and then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "Rate limit exceeded" } },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(okBody("Recovered")));
    const { provider, sleep } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([500]);
  });

  it("gives up after the retry limit with exponential backoff", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse(
          { error: { message: "Rate limit exceeded" } },
          { status: 429 },
        ),
      );
    const { provider, sleep } = createRetryProvider(fetchMock);

    const error = await failureOf(provider.generateText(request));

    expect(error.kind).toBe("rate_limit");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("Rate limit exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([500, 1000]);
  });

  it("retries server errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "Service unavailable" } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(okBody("Back up")));
    const { provider, sleep } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Back up");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry client errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { message: "No auth credentials found" } },
          { status: 401 },
        ),
      );
    const { provider, sleep } = createRetryProvider(fetchMock);

    const error = await failureOf(provider.generateText(request));

    expect(error.kind).toBe("client");
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors a Retry-After header", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "Rate limit exceeded" } },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(okBody("Recovered")));
    const { provider, sleep } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Recovered");
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2000]);
  });

  it("fails fast when Retry-After asks for a long wait", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { message: "Rate limit exceeded" } },
          { status: 429, headers: { "retry-after": "60" } },
        ),
      );
    const { provider, sleep } = createRetryProvider(fetchMock);

    const error = await failureOf(provider.generateText(request));

    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBe(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries an error body delivered with HTTP 200", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          error: { code: 429, message: "Provider returned error" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(okBody("Recovered")));
    const { provider, sleep } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries an empty reply once and then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okBody("   ")))
      .mockResolvedValueOnce(jsonResponse(okBody("Now with text")));
    const { provider } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Now with text");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a reply that ran out of token budget", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: "test/model",
        choices: [
          { finish_reason: "length", message: { content: null } },
        ],
      }),
    );
    const { provider, sleep } = createRetryProvider(fetchMock);

    const error = await failureOf(provider.generateText(request));

    expect(error.kind).toBe("truncated");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("finish_reason=length");
    expect(error.message).toContain("content_type=null");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry a refusal", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              refusal: "I can't help with that.",
            },
          },
        ],
      }),
    );
    const { provider } = createRetryProvider(fetchMock);

    const error = await failureOf(provider.generateText(request));

    expect(error.kind).toBe("refusal");
    expect(error.message).toContain("I can't help with that.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries network failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(okBody("Connected")));
    const { provider, sleep } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Connected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("classifies a timed-out request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
    const { provider } = createRetryProvider(fetchMock);

    const error = await failureOf(
      provider.generateText({ ...request, maxRetries: 0 }),
    );

    expect(error.kind).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("timed out");
  });

  it("retries an unreadable successful response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(okBody("Readable now")));
    const { provider } = createRetryProvider(fetchMock);

    const result = await provider.generateText(request);

    expect(result).toBe("Readable now");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("makes a single attempt when the request sets maxRetries to 0", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { message: "Rate limit exceeded" } },
          { status: 429 },
        ),
      );
    const { provider, sleep } = createRetryProvider(fetchMock);

    const error = await failureOf(
      provider.generateText({ ...request, maxRetries: 0 }),
    );

    expect(error.kind).toBe("rate_limit");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects an invalid maxRetries before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const { provider } = createRetryProvider(fetchMock);

    await expect(
      provider.generateText({ ...request, maxRetries: 9 }),
    ).rejects.toThrow("maxRetries");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
