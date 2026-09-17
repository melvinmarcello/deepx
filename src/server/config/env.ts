import { z } from "zod";

/**
 * Central, validated access to process.env for the backend/pipeline code.
 *
 * Next.js (app router + API routes) loads `.env*` files automatically.
 * Standalone scripts (migrations, manual test scripts, the cron worker)
 * import "dotenv/config" themselves before importing this module - see
 * scripts/*.ts for the pattern.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  NINEROUTER_BASE_URL: z.string().min(1, "NINEROUTER_BASE_URL is required"),
  NINEROUTER_API_KEY: z.string().min(1, "NINEROUTER_API_KEY is required"),
  NINEROUTER_ORCHESTRATOR_COMBO: z.string().default("orchestrator"),
  NINEROUTER_SUBAGENT_COMBO: z.string().default("subagent"),

  COINMARKETCAP_API_KEY: z.string().min(1, "COINMARKETCAP_API_KEY is required"),
  COINMARKETCAP_BASE_URL: z
    .string()
    .default("https://pro-api.coinmarketcap.com"),

  ETHERSCAN_API_KEY: z.string().min(1, "ETHERSCAN_API_KEY is required"),
  ETHERSCAN_BASE_URL: z.string().default("https://api.etherscan.io/v2/api"),

  ONCHAIN_FLAG_USD_THRESHOLD: z.coerce.number().default(100_000),

  PIPELINE_CRON: z.string().default("0 */2 * * *"),
  PIPELINE_RUN_ON_BOOT: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Lazily validated env accessor. Lazy so that modules can be imported
 * (e.g. for type checking / testing) without immediately requiring every
 * env var to be present - validation happens on first real use.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid/missing environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
