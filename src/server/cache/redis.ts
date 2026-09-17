import Redis from "ioredis";
import { getEnv } from "../config/env";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(getEnv().REDIS_URL, {
      // Fail fast on connection issues rather than buffering commands
      // indefinitely - the pipeline should treat cache misses as
      // non-fatal (see market-data agent's try/catch around cache reads).
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}

const PRICE_CACHE_TTL_SECONDS = 10 * 60; // 10 min, within the spec's 5-15 min window

export function priceCacheKey(coinId: string) {
  return `price:${coinId}`;
}

export async function getCachedPrice<T>(coinId: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(priceCacheKey(coinId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.warn(`[redis] getCachedPrice(${coinId}) failed:`, err);
    return null; // cache is never a source of truth - treat failures as a miss
  }
}

export async function setCachedPrice(
  coinId: string,
  value: unknown,
  ttlSeconds: number = PRICE_CACHE_TTL_SECONDS
): Promise<void> {
  try {
    await getRedis().set(
      priceCacheKey(coinId),
      JSON.stringify(value),
      "EX",
      ttlSeconds
    );
  } catch (err) {
    console.warn(`[redis] setCachedPrice(${coinId}) failed:`, err);
  }
}
