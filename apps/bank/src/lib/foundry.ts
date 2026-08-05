import { FoundryClient } from "@demo/foundry-client";
import { env } from "../env.js";

let instance: FoundryClient | null = null;

/** Memoized client pointed at foundry's admin listener. */
export function getFoundry(): FoundryClient {
  instance ??= new FoundryClient({
    adminUrl: env.FOUNDRY_ADMIN_URL,
    adminKey: env.FOUNDRY_ADMIN_KEY,
  });
  return instance;
}