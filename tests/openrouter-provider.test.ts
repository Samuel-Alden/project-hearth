
import { describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "../src/ai/openrouter-provider.js";

function createProvider(fetchMock: typeof fetch) {
  return new OpenRouterProvider({
    apiKey: "test-key-not-real",
    fetchImpl: fetchMock,
  });
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

    const request = fetchMock.mock.calls[0];
    const options = request?.[1];

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
