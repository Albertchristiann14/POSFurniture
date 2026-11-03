import crypto from "node:crypto";

/**
 * Generator Nomor Kontrak Kredit Unik & Terstruktur
 * Format: KTR-YYMMDD-XXXX
 * Contoh: KTR-261103-0001
 */
export function generateContractNumber(sequence = 1, customDate = new Date()): string {
  const yy = customDate.getFullYear().toString().slice(-2);
  const mm = (customDate.getMonth() + 1).toString().padStart(2, "0");
  const dd = customDate.getDate().toString().padStart(2, "0");
  const seqStr = sequence.toString().padStart(4, "0");

  return `KTR-${yy}${mm}${dd}-${seqStr}`;
}

/**
 * Generator Idempotency Key acak unik (UUID v4)
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

