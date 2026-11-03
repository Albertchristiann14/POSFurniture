import { describe, it, expect } from "vitest";
import {
  encryptPii,
  decryptPii,
  generateNikBlindIndex,
  maskNik,
  maskPhone,
  maskName,
} from "@/modules/credit/encryption";

describe("Cryptographic & PII Protection (UU PDP)", () => {
  it("harus mengenkripsi dan mendekripsi data sensitif secara tepat dengan AES-256-GCM", () => {
    const rawNik = "3201123456780001";
    const rawAddress = "Jl. Sudirman No. 45, RT 02 / RW 05, Jakarta Pusat";

    const encryptedNik = encryptPii(rawNik);
    const encryptedAddress = encryptPii(rawAddress);

    expect(encryptedNik).not.toBe(rawNik);
    expect(encryptedAddress).not.toBe(rawAddress);

    // Format harus iv:authTag:ciphertext
    expect(encryptedNik.split(":").length).toBe(3);

    const decryptedNik = decryptPii(encryptedNik);
    const decryptedAddress = decryptPii(encryptedAddress);

    expect(decryptedNik).toBe(rawNik);
    expect(decryptedAddress).toBe(rawAddress);
  });

  it("harus menghasilkan ciphertext berbeda untuk plaintext yang sama karena IV acak", () => {
    const text = "3201123456780001";
    const enc1 = encryptPii(text);
    const enc2 = encryptPii(text);

    expect(enc1).not.toBe(enc2);
    expect(decryptPii(enc1)).toBe(text);
    expect(decryptPii(enc2)).toBe(text);
  });

  it("harus menolak ciphertext yang diutak-atik (tampered) karena proteksi Auth Tag GCM", () => {
    const text = "Rahasia Negara";
    const enc = encryptPii(text);
    const parts = enc.split(":");

    // Modifikasi 1 karakter di ciphertext
    const tamperedCipher = parts[2].slice(0, -2) + "ff";
    const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    expect(() => decryptPii(tamperedPayload)).toThrow();
  });

  it("harus menghasilkan Blind Index yang deterministik dan unik per tenant", () => {
    const nik = "3201123456780001";
    const tenantA = "tenant-a-uuid";
    const tenantB = "tenant-b-uuid";

    const indexA1 = generateNikBlindIndex(nik, tenantA);
    const indexA2 = generateNikBlindIndex(nik, tenantA);
    const indexB = generateNikBlindIndex(nik, tenantB);

    // Deterministik untuk tenant yang sama
    expect(indexA1).toBe(indexA2);
    // Berbeda jika tenant berbeda (mencegah rainbow table antar-tenant)
    expect(indexA1).not.toBe(indexB);
  });

  it("harus mem-masking data sensitif di tampilan DTO/UI", () => {
    expect(maskNik("3201123456780001")).toBe("3201********0001");
    expect(maskPhone("081234567890")).toBe("0812****7890");
    expect(maskName("Budi Santoso")).toBe("B*** S******");
  });
});
