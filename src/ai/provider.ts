export type AIMessageRole = "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface GenerateTextInput {
  system: string;
  messages: AIMessage[];
  maxOutputTokens: number;
  /**
   * Retries allowed after the first attempt, for transient failures only.
   * Omit to use the provider's default. Pass 0 for optional calls that
   * should fail fast instead of delaying a real reply.
   */
  maxRetries?: number;
}

export interface AIProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}
