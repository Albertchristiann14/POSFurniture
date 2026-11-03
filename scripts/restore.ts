import crypto from "node:crypto";
import fs from "node:fs/promises";

/**
 * Script Verifikasi & Dekripsi Restore Database PostgreSQL Terenkripsi Krevia POS
 */

function getBackupEncryptionKey(): Buffer {
  const keyHex = process.env.BACKUP_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    return crypto.createHash("sha256").update("krevia_backup_default_salt_2026").digest();
  }
  return Buffer.from(keyHex, "hex");
}

export async function decryptAndVerifyBackup(
  encryptedFilePath: string,
  expectedChecksum?: string
): Promise<string> {
  const rawFile = await fs.readFile(encryptedFilePath);

  if (rawFile.length < 28) {
    throw new Error("File backup korup atau tidak valid (ukuran kurang dari 28 bytes)");
  }

  // Ekstrak IV (12 bytes), AuthTag (16 bytes), dan Ciphertext
  const iv = rawFile.subarray(0, 12);
  const authTag = rawFile.subarray(12, 28);
  const ciphertext = rawFile.subarray(28);

  const key = getBackupEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);

  const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Validasi SHA-256 Checksum jika tersedia
  if (expectedChecksum) {
    const actualChecksum = crypto.createHash("sha256").update(decryptedBuffer).digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Integritas backup terkompromi! Checksum aktual (${actualChecksum}) != manifest (${expectedChecksum})`
      );
    }
  }

  return decryptedBuffer.toString("utf8");
}
