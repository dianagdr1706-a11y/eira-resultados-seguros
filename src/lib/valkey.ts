import Redis from "ioredis";
import { getDb } from "./db";

/**
 * Valkey-compatible TTL store (Redis protocol).
 * Uses VALKEY_URL when configured (e.g. redis://127.0.0.1:6379),
 * and seamlessly falls back to SQLite kv_ttl_store for zero-friction local demos.
 */
declare global {
  // eslint-disable-next-line no-var
  var __eiraValkey: Redis | null | undefined;
}

function getValkeyClient(): Redis | null {
  if (global.__eiraValkey !== undefined) return global.__eiraValkey;
  const url = process.env.VALKEY_URL;
  if (!url) {
    global.__eiraValkey = null;
    return null;
  }
  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 800,
      lazyConnect: true,
    });
    client.on("error", () => {
      // Fall back gracefully if Valkey daemon is unavailable
    });
    global.__eiraValkey = client;
    return client;
  } catch {
    global.__eiraValkey = null;
    return null;
  }
}

export function getValkeyBackendInfo(): { mode: "valkey" | "sqlite_ttl_fallback"; url_configured: boolean } {
  return {
    mode: process.env.VALKEY_URL ? "valkey" : "sqlite_ttl_fallback",
    url_configured: Boolean(process.env.VALKEY_URL),
  };
}

export async function ttlSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = getValkeyClient();
  if (client) {
    try {
      await client.set(key, value, "EX", ttlSeconds);
      return;
    } catch {
      // Fallback to SQLite TTL store
    }
  }
  const db = getDb();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  db.prepare("INSERT OR REPLACE INTO kv_ttl_store (key, value, expires_at) VALUES (?, ?, ?)").run(
    key,
    value,
    expiresAt
  );
}

export async function ttlGet(key: string): Promise<string | null> {
  const client = getValkeyClient();
  if (client) {
    try {
      return await client.get(key);
    } catch {
      // Fallback to SQLite TTL store
    }
  }
  const db = getDb();
  const row = db
    .prepare("SELECT value, expires_at FROM kv_ttl_store WHERE key = ?")
    .get(key) as { value: string; expires_at: number } | undefined;
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare("DELETE FROM kv_ttl_store WHERE key = ?").run(key);
    return null;
  }
  return row.value;
}

export async function ttlDelete(key: string): Promise<void> {
  const client = getValkeyClient();
  if (client) {
    try {
      await client.del(key);
      return;
    } catch {
      // Fallback to SQLite TTL store
    }
  }
  const db = getDb();
  db.prepare("DELETE FROM kv_ttl_store WHERE key = ?").run(key);
}

export async function ttlIncrementRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const currentRaw = await ttlGet(key);
  const current = currentRaw ? parseInt(currentRaw, 10) : 0;
  if (current >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  await ttlSet(key, String(current + 1), windowSeconds);
  return { allowed: true, remaining: Math.max(0, maxRequests - (current + 1)) };
}
