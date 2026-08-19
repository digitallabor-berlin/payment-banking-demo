import { z } from "zod";

const schema = z.object({
 PORT: z.coerce.number().int().positive().default(3000),
 DATABASE_PATH: z.string().min(1).default("./data/merchant.db"),
 MERCHANT_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
 FOUNDRY_ADMIN_URL: z.string().url().default("http://127.0.0.1:9000"),
 FOUNDRY_ADMIN_KEY: z.string().min(1),
 BANK_API_URL: z.string().url().default("http://localhost:3001"),
 BANK_API_KEY: z.string().min(1),
 MERCHANT_NAME: z.string().min(1).default("Demo Shop"),
 /**
  * The payee identifier sent as `transaction_data.payload.payee.id`.
  *
  * Required, with no default, unlike MERCHANT_NAME. This value is hashed into
  * `transaction_data_hashes` and shown to the holder at authorization time, so
  * a placeholder default would put an untrue identifier inside a signed
  * payment authorization — the class of failure spec §8.1 wants to surface as
  * a boot crash rather than a silent bad demo.
  */
 MERCHANT_PAYEE_ID: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

/** Exported separately from `env` so tests can exercise validation. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
 const result = schema.safeParse(raw);
 if (!result.success) {
  const detail = result.error.issues
   .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
   .join("; ");
  throw new Error(`Invalid merchant environment configuration — ${detail}`);
 }
 return result.data;
}

/**
 * Validated at module load. On its own this only fires once something
 * imports this module — see src/instrumentation.ts, which forces that to
 * happen at server boot rather than on whichever route happens to be hit
 * first (spec §8.1; the full story is in Plan 1 Task 13's final commit).
 */
export const env: Env = parseEnv(process.env);
