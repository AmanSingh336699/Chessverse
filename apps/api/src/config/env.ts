import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const loadEnvFile = (envPath: string) => {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (isQuoted) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

const normalizeOptionalEnvValue = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "stockfish" ||
    normalized === "/absolute/path/to/stockfish" ||
    normalized === "PUT_ABSOLUTE_STOCKFISH_BINARY_PATH_HERE"
  ) {
    return undefined;
  }

  return normalized;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(currentDir, "../../");
const repoRoot = resolve(currentDir, "../../../../");
const envCandidates = [
  resolve(apiRoot, ".env.local"),
  resolve(apiRoot, ".env"),
  resolve(repoRoot, ".env.local"),
  resolve(repoRoot, ".env"),
];

for (const envPath of envCandidates) {
  loadEnvFile(envPath);
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STOCKFISH_PATH: z.string().optional().transform(normalizeOptionalEnvValue),
  OPENING_BOOK_PATH: z.string().optional().transform(normalizeOptionalEnvValue),
  WORKER_POOL_SIZE: z.coerce.number().int().positive().default(3),
  ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  WORKER_QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  STOCKFISH_THREADS: z.coerce.number().int().positive().default(2),
  STOCKFISH_HASH_MB: z.coerce.number().int().positive().default(128),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(20),
  SYZYGY_PATH: z.string().optional().transform(normalizeOptionalEnvValue),
  MAX_WORKER_CRASHES: z.coerce.number().int().positive().default(3),
  WORKER_CRASH_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  CONTEXT_REDIS_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  CONTEXT_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CONTEXT_LOCK_ACQUIRE_MS: z.coerce.number().int().positive().default(500),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  CLASSIFICATION_BEST_MAX: z.coerce.number().positive().default(0.2),
  CLASSIFICATION_EXCELLENT_MAX: z.coerce.number().positive().default(0.5),
  CLASSIFICATION_GOOD_MAX: z.coerce.number().positive().default(1.0),
  CLASSIFICATION_INACCURACY_MAX: z.coerce.number().positive().default(2.0),
  CLASSIFICATION_MISTAKE_MAX: z.coerce.number().positive().default(4.0),
  ANALYSIS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;



