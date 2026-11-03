import { describe, it, expect, beforeEach } from "vitest";
import {
  CreditCustomerService,
  InMemoryCustomerRepository,
  UserContext,
} from "@/modules/credit/customer-service";
import {
  CreditSchemeService,
  InMemorySchemeRepository,
} from "@/modules/credit/scheme-service";
import {
  DocumentStorageService,
  DocumentStorageDriver,
} from "@/server/storage/document-storage";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";
import {
  AppError,
  DuplicateCustomerError,
  TenantMismatchError,
  NotFoundError,
  UnauthorizedAccessError,
  CreditLimitExceededError,
  InvalidDocumentError,
} from "@/shared/errors";
import { decryptPii } from "@/modules/credit/encryption";

class MockMemoryStorageDriver implements DocumentStorageDriver {
  public files = new Map<string, Buffer>();

  async save(buffer: Buffer, filename: string): Promise<string> {
    const key = `mock-${Date.now()}-${filename}`;
    this.files.set(key, buffer);
    return key;
  }

  async get(storageKey: string): Promise<Buffer> {
    const buf = this.files.get(storageKey);
    if (!buf) throw new Error("File not found");
    return buf;
  }

  async delete(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
  }
}

describe("Fase K1: Modul Kredit Internal (Nasabah, Berkas, Skema & Simulator)", () => {
  let customerRepo: InMemoryCustomerRepository;
  let schemeRepo: InMemorySchemeRepository;
  let auditRepo: InMemoryAuditRepository;
  let auditLogger: AuditLogger;
  let storageDriver: MockMemoryStorageDriver;
  let storageService: DocumentStorageService;
  let customerService: CreditCustomerService;
  let schemeService: CreditSchemeService;

  const tenantA = "tenant-furniture-001";
  const tenantB = "tenant-furniture-002";

  const managerContextTenantA: UserContext = {
    userId: "user-mgr-1",
    tenantId: tenantA,
    role: "MANAGER",
    ipAddress: "192.168.1.10",
    userAgent: "Mozilla/5.0 POS Tablet",
  };

  const cashierContextTenantA: UserContext = {
    userId: "user-cashier-1",
    tenantId: tenantA,
    role: "CASHIER",
    ipAddress: "192.168.1.15",
  };

  const warehouseContextTenantA: UserContext = {
    userId: "user-wh-1",
    tenantId: tenantA,
    role: "WAREHOUSE",
    ipAddress: "192.168.1.20",
  };

  const managerContextTenantB: UserContext = {
    userId: "user-mgr-2",
    tenantId: tenantB,
    role: "MANAGER",
    ipAddress: "192.168.2.10",
  };

  beforeEach(() => {
    customerRepo = new InMemoryCustomerRepository();
    schemeRepo = new InMemorySchemeRepository();
    auditRepo = new InMemoryAuditRepository();
    auditLogger = new AuditLogger(auditRepo);
    storageDriver = new MockMemoryStorageDriver();
    storageService = new DocumentStorageService(storageDriver);
    customerService = new CreditCustomerService(customerRepo, storageService, auditLogger);
    schemeService = new CreditSchemeService(schemeRepo, auditLogger);
  });

  describe("1. Pendaftaran Nasabah & Enkripsi Data Sensitif (UU PDP)", () => {
    const validCustomerInput = {
      nik: "3201123456780001",
      fullName: "Budi Santoso",
      phone: "081234567890",
      addressKtp: "Jl. Veteran No. 12, RT 01 RW 02, Bandung",
      addressDom: "Jl. Riau No. 45, Bandung",
      occupation: "Karyawan Swasta",
      monthlyIncome: 8500000n,
      creditLimit: 20000000n,
      emergencyContact: {
        name: "Siti Rahma",
        relation: "Istri",
        phone: "081298765432",
      },
      pdpConsent: true as const,
    };

    it("harus mendaftarkan nasabah dan mengenkripsi NIK serta seluruh field sensitif at-rest", async () => {
      const registered = await customerService.registerCustomer(
        validCustomerInput,
        cashierContextTenantA
      );

      expect(registered.id).toBeDefined();
      expect(registered.maskedNik).toBe("3201********0001");
      expect(registered.fullName).toBe("Budi Santoso");

      // Verifikasi di database: TIDAK ADA plaintext NIK
      const rawStored = customerRepo.customers[0];
      expect(rawStored.encryptedNik).not.toBe(validCustomerInput.nik);
      expect(decryptPii(rawStored.encryptedNik)).toBe(validCustomerInput.nik);
      expect(decryptPii(rawStored.encryptedAddressKtp)).toBe(validCustomerInput.addressKtp);

      // Verifikasi audit log pembuatan nasabah tercatat
      const logs = await auditRepo.list({ tenantId: tenantA, action: "CREATE_CREDIT_CUSTOMER" });
      expect(logs.length).toBe(1);
      expect(logs[0].resourceId).toBe(registered.id);
    });

    it("harus mencegah duplikasi pelanggan dengan NIK yang sama pada tenant yang sama", async () => {
      await customerService.registerCustomer(validCustomerInput, cashierContextTenantA);

      // Request ulang dengan NIK yang sama
      await expect(
        customerService.registerCustomer(validCustomerInput, cashierContextTenantA)
      ).rejects.toThrow(DuplicateCustomerError);
    });

    it("harus mengizinkan NIK yang sama didaftarkan pada tenant yang berbeda (isolasi multi-tenant)", async () => {
      await customerService.registerCustomer(validCustomerInput, cashierContextTenantA);

      // Tenant B mendaftarkan NIK yang sama
      const registeredTenantB = await customerService.registerCustomer(
        validCustomerInput,
        managerContextTenantB
      );

      expect(registeredTenantB.id).toBeDefined();
      expect(customerRepo.customers.length).toBe(2);
    });
  });

  describe("2. Upload Dokumen Aman & Verifikasi Integritas SHA-256", () => {
    let customerId: string;
    // Valid JPEG header: FF D8 FF E0
    const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

    beforeEach(async () => {
      const registered = await customerService.registerCustomer(
        {
          nik: "3201123456780002",
          fullName: "Dewi Lestari",
          phone: "081311223344",
          addressKtp: "Jl. Merdeka No. 10, Jakarta",
          addressDom: "Jl. Merdeka No. 10, Jakarta",
          occupation: "Wiraswasta",
          monthlyIncome: 15000000n,
          emergencyContact: {
            name: "Hendra",
            relation: "Suami",
            phone: "081399887766",
          },
          pdpConsent: true as const,
        },
        managerContextTenantA
      );
      customerId = registered.id;
    });

    it("harus memvalidasi magic bytes dan menghitung SHA-256 hash dokumen KTP", async () => {
      const doc = await customerService.uploadCustomerDocument(
        {
          customerId,
          documentType: "KTP",
          fileBuffer: validJpegBuffer,
          originalFilename: "ktp-dewi.jpg",
          mimeType: "image/jpeg",
        },
        managerContextTenantA
      );

      expect(doc.id).toBeDefined();
      expect(doc.fileHashSha256).toBeDefined();
      expect(doc.fileHashSha256.length).toBe(64); // SHA-256 hex 64 chars

      // Verifikasi audit log upload
      const logs = await auditRepo.list({ tenantId: tenantA, action: "UPLOAD_CUSTOMER_DOC" });
      expect(logs.length).toBe(1);
    });

    it("harus menolak file palsu (spoofed extension dengan header salah)", async () => {
      const fakeBuffer = Buffer.from("Ini bukan file JPEG asli!");

      await expect(
        customerService.uploadCustomerDocument(
          {
            customerId,
            documentType: "KTP",
            fileBuffer: fakeBuffer,
            originalFilename: "fake.jpg",
            mimeType: "image/jpeg",
          },
          managerContextTenantA
        )
      ).rejects.toThrow(InvalidDocumentError);
    });

    it("harus mencatat audit log setiap kali dokumen sensitif dibuka", async () => {
      const doc = await customerService.uploadCustomerDocument(
        {
          customerId,
          documentType: "KTP",
          fileBuffer: validJpegBuffer,
          originalFilename: "ktp.jpg",
          mimeType: "image/jpeg",
        },
        managerContextTenantA
      );

      // Manager membuka dokumen
      const retrieved = await customerService.getDocumentContent(doc.id, managerContextTenantA);
      expect(retrieved.buffer).toEqual(validJpegBuffer);

      // Verifikasi audit log VIEW_CUSTOMER_DOC tercatat
      const viewLogs = await auditRepo.list({ tenantId: tenantA, action: "VIEW_CUSTOMER_DOC" });
      expect(viewLogs.length).toBe(1);
      expect(viewLogs[0].userId).toBe(managerContextTenantA.userId);
    });

    it("harus menolak role yang tidak berwenang (misal WAREHOUSE) membuka dokumen kredit nasabah", async () => {
      const doc = await customerService.uploadCustomerDocument(
        {
          customerId,
          documentType: "KTP",
          fileBuffer: validJpegBuffer,
          originalFilename: "ktp.jpg",
          mimeType: "image/jpeg",
        },
        managerContextTenantA
      );

      await expect(
        customerService.getDocumentContent(doc.id, warehouseContextTenantA)
      ).rejects.toThrow(UnauthorizedAccessError);
    });
  });

  describe("3. Isolasi Tenant Ketat (Anti Kebocoran Lintas Tenant)", () => {
    it("harus menolak akses data nasabah dan dokumen milik tenant lain", async () => {
      const registered = await customerService.registerCustomer(
        {
          nik: "3201123456780003",
          fullName: "Siti Rahayu",
          phone: "081233445566",
          addressKtp: "Jl. Diponegoro No. 8, Surabaya",
          addressDom: "Jl. Diponegoro No. 8, Surabaya",
          occupation: "PNS",
          monthlyIncome: 7000000n,
          emergencyContact: {
            name: "Agus",
            relation: "Ayah",
            phone: "081299887766",
          },
          pdpConsent: true as const,
        },
        managerContextTenantA
      );

      // Manager Tenant B mencoba mengambil profil nasabah Tenant A
      await expect(
        customerService.getCustomerProfile(registered.id, managerContextTenantB)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("4. Skema Cicilan, Immutability Snapshot & Simulator", () => {
    it("harus menyimpan snapshot skema dan kebal terhadap perubahan skema di masa depan", async () => {
      // 1. Buat skema
      const scheme = await schemeService.createScheme(
        {
          name: "Promo Ramadhan 6 Bulan",
          tenorMonths: 6,
          marginMethod: "FLAT_MONTHLY",
          marginRateBps: 150, // 1.5% per bulan
          minDownPaymentPct: 20,
          adminFeeAmount: 50000n,
          penaltyType: "DAILY_FIXED_AMOUNT",
          penaltyRateBps: 0,
          penaltyFixedFee: 10000n,
          gracePeriodDays: 3,
          maxPenaltyCapPct: 20,
          isActive: true,
        },
        tenantA,
        managerContextTenantA.userId
      );

      // 2. Ambil snapshot untuk kontrak
      const contractSnapshot = await schemeService.getSchemeSnapshotForContract(tenantA, scheme.id);
      expect(contractSnapshot.marginRateBps).toBe(150);
      expect(contractSnapshot.adminFeeAmount).toBe("50000");

      // 3. Admin mengubah setting skema di kemudian hari (bunga dinaikkan menjadi 3%)
      await schemeRepo.update(tenantA, scheme.id, {
        marginRateBps: 300,
        adminFeeAmount: 150000n,
      });

      // 4. Verifikasi bahwa snapshot kontrak lama TETAP tidak berubah (integritas kontrak)
      expect(contractSnapshot.marginRateBps).toBe(150);
      expect(contractSnapshot.adminFeeAmount).toBe("50000");
    });

    it("harus menghasilkan simulasi cicilan yang 100% konsisten dengan perhitungan kontrak", async () => {
      const scheme = await schemeService.createScheme(
        {
          name: "Cicilan Reguler 12 Bulan",
          tenorMonths: 12,
          marginMethod: "FLAT_MONTHLY",
          marginRateBps: 200, // 2% per bulan
          minDownPaymentPct: 15,
          adminFeeAmount: 100000n,
          penaltyType: "DAILY_FIXED_AMOUNT",
          penaltyRateBps: 0,
          penaltyFixedFee: 15000n,
          gracePeriodDays: 3,
          maxPenaltyCapPct: 25,
          isActive: true,
        },
        tenantA
      );

      const simResult = await schemeService.simulateInstallment(
        {
          itemTotalAmount: 15000000n,
          downPaymentAmount: 3000000n, // DP 20% > min 15%
          tenorMonths: 12,
          schemeId: scheme.id,
        },
        tenantA
      );

      expect(simResult.principalTotal).toBe(12000000n);
      // Margin = 12.000.000 * 2% * 12 bulan = 2.880.000
      expect(simResult.marginTotal).toBe(2880000n);
      expect(simResult.totalCreditFinanced).toBe(14880000n);
      expect(simResult.installments.length).toBe(12);

      // Verifikasi pembulatan: Total semua angsuran sama dengan 14.880.000
      const sumInstallments = simResult.installments.reduce((sum, item) => sum + item.totalDue, 0n);
      expect(sumInstallments).toBe(14880000n);
    });

    it("harus menolak simulasi jika uang muka (DP) kurang dari batas minimum skema", async () => {
      const scheme = await schemeService.createScheme(
        {
          name: "Cicilan Minimal DP 30%",
          tenorMonths: 6,
          marginMethod: "FLAT_MONTHLY",
          marginRateBps: 200,
          minDownPaymentPct: 30, // Wajib DP 30%
          adminFeeAmount: 50000n,
          penaltyType: "DAILY_FIXED_AMOUNT",
          penaltyRateBps: 0,
          penaltyFixedFee: 10000n,
          gracePeriodDays: 3,
          maxPenaltyCapPct: 20,
          isActive: true,
        },
        tenantA
      );

      // Barang Rp 10.000.000, DP Rp 2.000.000 (hanya 20% < 30%)
      await expect(
        schemeService.simulateInstallment(
          {
            itemTotalAmount: 10000000n,
            downPaymentAmount: 2000000n,
            tenorMonths: 6,
            schemeId: scheme.id,
          },
          tenantA
        )
      ).rejects.toThrow(/Uang muka \(DP\) minimal/);
    });
  });

  describe("5. Validasi Plafon Kredit & Scoring Internal", () => {
    it("harus menolak jika pengajuan pokok melebihi sisa plafon kredit nasabah", async () => {
      const registered = await customerService.registerCustomer(
        {
          nik: "3201123456780004",
          fullName: "Ahmad Fauzi",
          phone: "081244556677",
          addressKtp: "Jl. Melati No. 5, Bogor",
          addressDom: "Jl. Melati No. 5, Bogor",
          occupation: "Karyawan",
          monthlyIncome: 6000000n,
          creditLimit: 10000000n, // Plafon Rp 10.000.000
          emergencyContact: {
            name: "Hani",
            relation: "Adik",
            phone: "081299881122",
          },
          pdpConsent: true as const,
        },
        managerContextTenantA
      );

      // Ajukan kredit dengan pokok Rp 12.000.000 (melebihi limit 10.000.000)
      await expect(
        customerService.validateCreditEligibility(registered.id, 12000000n, managerContextTenantA)
      ).rejects.toThrow(CreditLimitExceededError);

      // Ajukan kredit dalam batas (Rp 8.000.000) -> Berhasil
      const eligibility = await customerService.validateCreditEligibility(
        registered.id,
        8000000n,
        managerContextTenantA
      );
      expect(eligibility.isEligible).toBe(true);
      expect(eligibility.remainingLimit).toBe(2000000n);
    });

    it("harus menolak jika nasabah masuk dalam daftar hitam (blacklist)", async () => {
      const registered = await customerService.registerCustomer(
        {
          nik: "3201123456780005",
          fullName: "Nasabah Macet",
          phone: "081200001111",
          addressKtp: "Jl. Sudirman No. 99, Bandung",
          addressDom: "Jl. Sudirman No. 99, Bandung",
          occupation: "Freelancer",
          monthlyIncome: 5000000n,
          creditLimit: 15000000n,
          emergencyContact: {
            name: "Rini",
            relation: "Ibu",
            phone: "081299990000",
          },
          pdpConsent: true as const,
        },
        managerContextTenantA
      );

      // Tandai nasabah sebagai blacklist
      await customerRepo.update(tenantA, registered.id, { isBlacklisted: true });

      await expect(
        customerService.validateCreditEligibility(registered.id, 5000000n, managerContextTenantA)
      ).rejects.toThrow(/daftar hitam/);
    });
  });
});
