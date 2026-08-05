import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_PATH: z.string().min(1).default("./data/bank.db"),
  BANK_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  FOUNDRY_ADMIN_URL: z.string().url().default("http://127.0.0.1:9000"),
  FOUNDRY_ADMIN_KEY: z.string().min(1),
  BANK_API_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

/** Exported separately from `env` so tests can exercise validation. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid bank environment configuration — ${detail}`);
  }
  return result.data;
}

/**
 * Validated at module load, so a misconfigured deployment fails at boot with a
 * named error rather than on the first request (spec 8.1).
 */
export const env: Env = parseEnv(process.env);