import type { Client } from "discord.js";

export class CharacterClientRegistry {
  private readonly clients = new Map<string, Client>();

  register(characterId: string, client: Client): void {
    const id = characterId.trim();

    if (!id) {
      throw new Error("Character ID cannot be empty.");
    }

    if (this.clients.has(id)) {
      throw new Error(
        `A Discord client is already registered for character "${id}".`,
      );
    }

    this.clients.set(id, client);
  }

  getClient(characterId: string): Client | undefined {
    return this.clients.get(characterId);
  }

  hasClient(characterId: string): boolean {
    return this.clients.has(characterId);
  }

  getRegisteredCharacterIds(): string[] {
    return [...this.clients.keys()];
  }
}
