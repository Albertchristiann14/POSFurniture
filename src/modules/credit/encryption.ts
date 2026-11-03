import crypto from "node:crypto";

/**
 * PII Cryptographic Utilities for Krevia POS (UU PDP Compliance)
 * Uses AES-256-GCM for Authenticated Encryption at rest
 * Uses HMAC-SHA256 Blind Index for searchable/unique encrypted NIK
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

function getEncryptionKey(): Buffer {
  const hexKey = process.env.DATA_ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    // Default fallback for development/testing if not configured
    return crypto.createHash("sha256").update("krevia_pos_furniture_default_dev_key_2026").digest();
  }
  return Buffer.from(hexKey, "hex");
}

function getBlindIndexSalt(): string {
  return process.env.BLIND_INDEX_SALT || "krevia_furniture_blind_index_salt_dev_2026";
}

/**
 * Enkripsi data sensitif (AES-256-GCM)
 * Output format: `ivHex:authTagHex:ciphertextHex`
 */
export function encryptPii(plainText: string): string {
  if (!plainText) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Dekripsi data sensitif (AES-256-GCM)
 * Memverifikasi keaslian via Auth Tag
 */
export function decryptPii(cipherComposite: string): string {
  if (!cipherComposite) return "";
  const parts = cipherComposite.split(":");
  if (parts.length !== 3) {
    throw new Error("Format ciphertext tidak valid");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Menghasilkan Blind Index deterministik untuk pencarian NIK (HMAC-SHA256)
 * Memungkinkan constraint unik di database tanpa menyimpan NIK plaintext
 */
export function generateNikBlindIndex(nik: string, tenantId?: string): string {
  const normalized = nik.trim().replace(/\s+/g, "");
  const salt = getBlindIndexSalt();
  const context = tenantId ? `${salt}:${tenantId}` : salt;
  return crypto.createHmac("sha256", context).update(normalized).digest("hex");
}

/**
 * Masking NIK untuk tampilan UI (hanya 4 digit awal & 4 digit akhir terlihat)
 * Contoh: 3201123456780001 -> 3201********0001
 */
export function maskNik(nik: string): string {
  if (!nik || nik.length < 8) return "****************";
  const start = nik.slice(0, 4);
  const end = nik.slice(-4);
  const maskedLength = Math.max(0, nik.length - 8);
  return `${start}${"*".repeat(maskedLength)}${end}`;
}

/**
 * Masking nomor telepon untuk tampilan UI
 * Contoh: 081234567890 -> 0812****7890
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return "08**********";
  const start = phone.slice(0, 4);
  const end = phone.slice(-4);
  return `${start}****${end}`;
}

/**
 * Masking nama lengkap
 * Contoh: Budi Santoso -> B*** S******
 */
export function maskName(fullName: string): string {
  if (!fullName) return "";
  return fullName
    .split(" ")
    .map((word) => {
      if (word.length <= 1) return word;
      return word[0] + "*".repeat(word.length - 1);
    })
    .join(" ");
}
