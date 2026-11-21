import crypto from "node:crypto";

export interface EncryptedJsonBundle {
  algorithm: "AES-256-GCM";
  iv_hex: string;
  auth_tag_hex: string;
  ciphertext_b64: string;
  sha256: string;
}

const DEFAULT_KIOSK_KEY = "eira-kiosk-edge-sync-key-2026";

function deriveAes256Key(): Buffer {
  const secret = process.env.EIRA_KIOSK_KEY || DEFAULT_KIOSK_KEY;
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypts a JSON-serializable payload using AES-256-GCM for Store-and-Forward /
 * Sneakernet Raspberry Pi kiosk sync packages.
 */
export function encryptJsonBundle(data: unknown): EncryptedJsonBundle {
  const key = deriveAes256Key();
  const iv = crypto.randomBytes(12); // 96-bit recommended IV for GCM
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const sha256 = crypto.createHash("sha256").update(encrypted).digest("hex");

  return {
    algorithm: "AES-256-GCM",
    iv_hex: iv.toString("hex"),
    auth_tag_hex: authTag.toString("hex"),
    ciphertext_b64: encrypted.toString("base64"),
    sha256,
  };
}

/**
 * Verifies SHA-256 integrity and decrypts an AES-256-GCM Store-and-Forward bundle.
 */
export function decryptJsonBundle<T = unknown>(bundle: EncryptedJsonBundle): T {
  if (bundle.algorithm !== "AES-256-GCM") {
    throw new Error(`Algoritmo no soportado: ${String(bundle.algorithm)}`);
  }

  const ciphertext = Buffer.from(bundle.ciphertext_b64, "base64");
  const expectedSha = crypto.createHash("sha256").update(ciphertext).digest("hex");
  const actualShaBuf = Buffer.from(bundle.sha256, "hex");
  const expectedShaBuf = Buffer.from(expectedSha, "hex");

  if (
    actualShaBuf.length !== expectedShaBuf.length ||
    !crypto.timingSafeEqual(actualShaBuf, expectedShaBuf)
  ) {
    throw new Error("Integridad SHA-256 inválida en el paquete cifrado.");
  }

  const key = deriveAes256Key();
  const iv = Buffer.from(bundle.iv_hex, "hex");
  const authTag = Buffer.from(bundle.auth_tag_hex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
