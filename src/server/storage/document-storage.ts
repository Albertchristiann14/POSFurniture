import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { InvalidDocumentError } from "@/shared/errors";
import { UploadDocumentValidationSchema, DocumentType } from "@/modules/credit/validators";

export interface StoredDocumentResult {
  storageKey: string;
  fileHashSha256: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface DocumentStorageDriver {
  save(buffer: Buffer, filename: string): Promise<string>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

/**
 * Local filesystem driver for secure document storage
 */
class LocalDocumentStorageDriver implements DocumentStorageDriver {
  private baseDir: string;

  constructor(baseDir = "./storage/documents") {
    this.baseDir = path.resolve(baseDir);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async save(buffer: Buffer, filename: string): Promise<string> {
    await this.ensureDir();
    const safeFilename = `${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const targetPath = path.join(this.baseDir, safeFilename);
    await fs.writeFile(targetPath, buffer);
    return safeFilename;
  }

  async get(storageKey: string): Promise<Buffer> {
    const targetPath = path.join(this.baseDir, path.basename(storageKey));
    return await fs.readFile(targetPath);
  }

  async delete(storageKey: string): Promise<void> {
    const targetPath = path.join(this.baseDir, path.basename(storageKey));
    try {
      await fs.unlink(targetPath);
    } catch {
      // Ignore if already deleted
    }
  }
}

export class DocumentStorageService {
  private driver: DocumentStorageDriver;

  constructor(driver?: DocumentStorageDriver) {
    this.driver = driver || new LocalDocumentStorageDriver();
  }

  /**
   * Validasi dan simpan dokumen pelanggan kredit
   */
  async uploadAndSecureDocument(params: {
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    documentType: DocumentType;
    customerId: string;
    tenantId: string;
  }): Promise<StoredDocumentResult> {
    const { buffer, originalFilename, mimeType, documentType } = params;

    // 1. Validasi Zod schema
    const validation = UploadDocumentValidationSchema.safeParse({
      documentType,
      mimeType,
      fileSizeBytes: buffer.length,
    });

    if (!validation.success) {
      throw new InvalidDocumentError(validation.error.errors[0].message);
    }

    // 2. Verifikasi Magic Bytes untuk mencegah spoofing extension
    this.validateMagicBytes(buffer, mimeType);

    // 3. Hitung SHA-256 Checksum Integritas
    const fileHashSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    // 4. Simpan ke driver storage terisolasi
    const storageKey = await this.driver.save(buffer, originalFilename);

    return {
      storageKey,
      fileHashSha256,
      fileSizeBytes: buffer.length,
      mimeType,
    };
  }

  /**
   * Mengambil konten dokumen dan memverifikasi integritas hash
   */
  async retrieveDocument(storageKey: string, expectedHash?: string): Promise<Buffer> {
    const buffer = await this.driver.get(storageKey);
    if (expectedHash) {
      const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (actualHash !== expectedHash) {
        throw new InvalidDocumentError(
          "Integritas dokumen terkompromi: SHA-256 hash tidak cocok dengan database!"
        );
      }
    }
    return buffer;
  }

  /**
   * Validasi magic bytes header file
   */
  private validateMagicBytes(buffer: Buffer, mimeType: string): void {
    if (buffer.length < 4) {
      throw new InvalidDocumentError("Ukuran file terlalu kecil atau korup");
    }

    if (mimeType === "image/jpeg") {
      // JPEG starts with FF D8 FF
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new InvalidDocumentError("Header file bukan gambar JPEG yang valid");
      }
    } else if (mimeType === "image/png") {
      // PNG starts with 89 50 4E 47
      if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
        throw new InvalidDocumentError("Header file bukan gambar PNG yang valid");
      }
    } else if (mimeType === "application/pdf") {
      // PDF starts with %PDF (25 50 44 46)
      if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
        throw new InvalidDocumentError("Header file bukan dokumen PDF yang valid");
      }
    }
  }
}

export const documentStorageService = new DocumentStorageService();

