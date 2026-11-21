import crypto from "node:crypto";

export function newId(prefix: string) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(data: Buffer | string) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function hashSecret(secret: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(secret, salt, 32).toString("hex");
  return `${salt}:${h}`;
}

export function verifySecret(secret: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [salt, h] = stored.split(":");
  const calc = crypto.scryptSync(secret, salt, 32);
  const buf = Buffer.from(h, "hex");
  return buf.length === calc.length && crypto.timingSafeEqual(buf, calc);
}

export function randomDigits(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}

export function maskPhone(p: string | null) {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  return `•••• •• ${d.slice(-4)}`;
}

export function maskEmail(e: string | null) {
  if (!e) return "—";
  const [u, dom] = e.split("@");
  return `${u.slice(0, 2)}•••@${dom}`;
}
