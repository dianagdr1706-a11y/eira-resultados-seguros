import Redis from "ioredis";

type Entry = { v: string; exp: number | null };

interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSec: number): Promise<number>;
  ttl(key: string): Promise<number>;
  backend: "valkey" | "memoria";
}

class MemoryKV implements KV {
  backend = "memoria" as const;
  private m = new Map<string, Entry>();
  private alive(k: string) {
    const e = this.m.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.m.delete(k);
      return null;
    }
    return e;
  }
  async get(k: string) {
    return this.alive(k)?.v ?? null;
  }
  async set(k: string, v: string, ttl?: number) {
    this.m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : null });
  }
  async del(k: string) {
    this.m.delete(k);
  }
  async incr(k: string, ttl: number) {
    const e = this.alive(k);
    const n = (e ? Number(e.v) : 0) + 1;
    this.m.set(k, { v: String(n), exp: e?.exp ?? Date.now() + ttl * 1000 });
    return n;
  }
  async ttl(k: string) {
    const e = this.alive(k);
    if (!e) return -2;
    return e.exp ? Math.round((e.exp - Date.now()) / 1000) : -1;
  }
}

class ValkeyKV implements KV {
  backend = "valkey" as const;
  constructor(private r: Redis) {}
  async get(k: string) {
    return this.r.get(k);
  }
  async set(k: string, v: string, ttl?: number) {
    if (ttl) await this.r.set(k, v, "EX", ttl);
    else await this.r.set(k, v);
  }
  async del(k: string) {
    await this.r.del(k);
  }
  async incr(k: string, ttl: number) {
    const n = await this.r.incr(k);
    if (n === 1) await this.r.expire(k, ttl);
    return n;
  }
  async ttl(k: string) {
    return this.r.ttl(k);
  }
}

const g = globalThis as unknown as { __kv?: Promise<KV> };

async function init(): Promise<KV> {
  const url = process.env.VALKEY_URL ?? "redis://127.0.0.1:6379";
  if (process.env.VALKEY_URL === "off") return new MemoryKV();
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, enableOfflineQueue: false });
  r.on("error", () => {});
  try {
    await r.connect();
    await r.ping();
    return new ValkeyKV(r);
  } catch {
    r.disconnect();
    console.warn("[kv] Valkey no disponible; usando memoria local");
    return new MemoryKV();
  }
}

export function kv(): Promise<KV> {
  if (!g.__kv) g.__kv = init();
  return g.__kv;
}
