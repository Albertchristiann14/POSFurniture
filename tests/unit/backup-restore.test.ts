import { describe, it, expect } from "vitest";
import { createEncryptedBackup } from "../../scripts/backup";
import { decryptAndVerifyBackup } from "../../scripts/restore";
import fs from "node:fs/promises";

describe("Database Backup Encryption & Verification (Disaster Recovery)", () => {
  const tempDir = "./storage/backups_test";

  it("harus mengenkripsi payload SQL dengan AES-256-GCM dan berhasil mendekripsi serta memvalidasi checksum SHA-256", async () => {
    const mockSqlDump = "-- KREVIA POS DATABASE DUMP\nCREATE TABLE tenants (id text primary key);\nINSERT INTO tenants VALUES ('tenant-1');";

    // 1. Eksekusi Backup Terenkripsi
    const { backupFile, sha256Checksum } = await createEncryptedBackup(mockSqlDump, tempDir);
    expect(backupFile).toContain(".sql.enc");
    expect(sha256Checksum.length).toBe(64);

    // 2. Eksekusi Restore & Verifikasi Integritas
    const restoredSql = await decryptAndVerifyBackup(backupFile, sha256Checksum);
    expect(restoredSql).toBe(mockSqlDump);

    // 3. Uji Tampering Checksum Mismatch
    await expect(
      decryptAndVerifyBackup(backupFile, "fake_checksum_00000000000000000000000000000000000000000000000000000000")
    ).rejects.toThrow(/Integritas backup terkompromi/);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
