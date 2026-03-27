import Redis from "ioredis";
import type { Logger } from "pino";
import type { EvalCache } from "../types.js";

class MemoryEvalCache<T> implements EvalCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  async get(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: T, ttlSeconds = 300): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async disconnect(): Promise<void> {
    this.store.clear();
  }
}

class RedisEvalCache<T> implements EvalCache<T> {
    constructor(private readonly redis: Redis) {}

    async get(key: string): Promise<T | null> {
        const value = await this.redis.get(key);
        return value ? (JSON.parse(value) as T) : null;
    }

    async set(key: string, value: T, ttlSeconds = 300): Promise<void> {
        await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    }
    async disconnect(): Promise<void> {
        await this.redis.quit();
    }
}

export const createEvalCache = async <T>(
  redisUrl: string | undefined,
  appLogger: Logger,
): Promise<EvalCache<T>> => {
  if (!redisUrl) {
    return new MemoryEvalCache<T>();
  }

  try {
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await redis.connect();
    appLogger.info({ redisUrl }, "Redis cache connected");
    return new RedisEvalCache<T>(redis);
  } catch (error) {
    appLogger.warn({ error }, "Redis unavailable, using in-memory eval cache");
    return new MemoryEvalCache<T>();
  }
};
