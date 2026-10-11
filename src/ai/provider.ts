
export type AIMessageRole = "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface GenerateTextInput {
  system: string;
  messages: AIMessage[];
  maxOutputTokens: number;
}

export interface AIProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}
