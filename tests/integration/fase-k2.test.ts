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
  CreditApplicationService,
  InMemoryApplicationRepository,
} from "@/modules/credit/application-service";
import {
  PaymentService,
  InMemoryPaymentRepository,
} from "@/modules/payment/payment-service";
import { MockPaymentGatewayAdapter } from "@/modules/payment/payment-gateway";
import { DocumentStorageService } from "@/server/storage/document-storage";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Fase K2: Pengajuan Kredit, Approval Berjenjang, Kontrak PDF & Pembayaran DP", () => {
  let customerRepo: InMemoryCustomerRepository;
  let schemeRepo: InMemorySchemeRepository;
  let appRepo: InMemoryApplicationRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let auditRepo: InMemoryAuditRepository;
  let auditLogger: AuditLogger;
  let storageService: DocumentStorageService;
  let gatewayAdapter: MockPaymentGatewayAdapter;
  let paymentService: PaymentService;
  let customerService: CreditCustomerService;
  let schemeService: CreditSchemeService;
  let appService: CreditApplicationService;

  const tenantId = "tenant-furniture-k2";

  const ownerContext: UserContext & { maxCreditApprovalLimit: bigint } = {
    userId: "user-owner-1",
    tenantId,
    role: "OWNER",
    maxCreditApprovalLimit: 100000000n, // Rp 100.000.000
    ipAddress: "192.168.1.1",
  };

  const managerContext: UserContext & { maxCreditApprovalLimit: bigint } = {
    userId: "user-mgr-1",
    tenantId,
    role: "MANAGER",
    maxCreditApprovalLimit: 15000000n, // Limit Rp 15.000.000
    ipAddress: "192.168.1.2",
  };

  const salesContext: UserContext & { maxCreditApprovalLimit: bigint } = {
    userId: "user-sales-1",
    tenantId,
    role: "SALES",
    maxCreditApprovalLimit: 0n,
    ipAddress: "192.168.1.3",
  };

  let customerId: string;
  let schemeId: string;

  beforeEach(async () => {
    customerRepo = new InMemoryCustomerRepository();
    schemeRepo = new InMemorySchemeRepository();
    appRepo = new InMemoryApplicationRepository();
    paymentRepo = new InMemoryPaymentRepository();
    auditRepo = new InMemoryAuditRepository();
    auditLogger = new AuditLogger(auditRepo);
    storageService = new DocumentStorageService();
    gatewayAdapter = new MockPaymentGatewayAdapter("mock_secret_key_k2");

    paymentService = new PaymentService(paymentRepo, gatewayAdapter, auditLogger);
    customerService = new CreditCustomerService(customerRepo, storageService, auditLogger);
    schemeService = new CreditSchemeService(schemeRepo, auditLogger);
    appService = new CreditApplicationService(
      appRepo,
      customerService,
      schemeService,
      paymentService,
      auditLogger
    );

    // Daftarkan nasabah
    const cust = await customerService.registerCustomer(
      {
        nik: "3201998877660001",
        fullName: "Rendra Pratama",
        phone: "081299887766",
        addressKtp: "Jl. Riau No. 100, Bandung",
        addressDom: "Jl. Riau No. 100, Bandung",
        occupation: "Arsitek",
        monthlyIncome: 20000000n,
        creditLimit: 30000000n, // Plafon 30 juta
        emergencyContact: {
          name: "Maya",
          relation: "Istri",
          phone: "081211223344",
        },
        pdpConsent: true as const,
      },
      salesContext
    );
    customerId = cust.id;

    // Buat skema cicilan
    const scheme = await schemeService.createScheme(
      {
        name: "Cicilan Furniture 12 Bulan Standard",
        tenorMonths: 12,
        marginMethod: "FLAT_MONTHLY",
        marginRateBps: 200, // 2% per bulan
        minDownPaymentPct: 20, // Min DP 20%
        adminFeeAmount: 100000n,
        penaltyType: "DAILY_FIXED_AMOUNT",
        penaltyRateBps: 0,
        penaltyFixedFee: 15000n,
        gracePeriodDays: 3,
        maxPenaltyCapPct: 20,
        isActive: true,
      },
      tenantId,
      ownerContext.userId
    );
    schemeId = scheme.id;
  });

  it("1. harus membuat pengajuan kredit furniture dengan status awal DIAJUKAN", async () => {
    // Furniture: Sofa L-Shape (Rp 18.000.000) + Meja Kopi Jati (Rp 2.000.000) = Rp 20.000.000
    // DP 20% = Rp 4.000.000 -> Pokok Kredit = Rp 16.000.000
    const result = await appService.createApplication(
      {
        customerId,
        schemeId,
        orderItems: [
          {
            productId: "prod-sofa-1",
            variantId: "var-sofa-brown",
            productName: "Sofa L-Shape Fabric",
            variantName: "Brown Velvet",
            unitPrice: 18000000n,
            quantity: 1,
            customSpecs: "Bahan anti air, warna coklat tua",
          },
          {
            productId: "prod-table-1",
            variantId: "var-table-teak",
            productName: "Meja Kopi Solid",
            variantName: "Kayu Jati Natural",
            unitPrice: 2000000n,
            quantity: 1,
          },
        ],
        downPaymentOffered: 4000000n,
        tenorMonths: 12,
        notes: "Pengiriman akhir pekan",
      },
      salesContext
    );

    expect(result.contract.status).toBe("DIAJUKAN");
    expect(result.contract.principalTotal).toBe(16000000n);
    expect(result.contract.downPaymentRequired).toBe(4000000n);
    expect(result.contract.adminFeeTotal).toBe(100000n);
    expect(result.schedule.length).toBe(12);

    // Verifikasi audit log pembuatan pengajuan
    const logs = await auditRepo.list({ tenantId, action: "SUBMIT_CREDIT_APPLICATION" });
    expect(logs.length).toBe(1);
  });

  it("2. harus memberlakukan Approval Berjenjang: Manager dengan limit Rp 15jt menolak pokok Rp 16jt, Owner bisa approve", async () => {
    const { contract } = await appService.createApplication(
      {
        customerId,
        schemeId,
        orderItems: [
          {
            productId: "p1",
            variantId: "v1",
            productName: "Set Meja Makan Marmer 6 Kursi",
            variantName: "White Carrara",
            unitPrice: 20000000n,
            quantity: 1,
          },
        ],
        downPaymentOffered: 4000000n, // Pokok = Rp 16.000.000 (> limit manager 15jt)
        tenorMonths: 12,
      },
      salesContext
    );

    // 1. Manager mencoba approve -> Ditolak karena limit 15jt < pokok 16jt
    await expect(
      appService.reviewApplication({
        contractId: contract.id,
        decision: "APPROVE",
        reviewer: managerContext,
      })
    ).rejects.toThrow(/melebihi batas limit kewenangan Anda/);

    // 2. Sales mencoba approve -> Ditolak karena bukan manager/owner
    await expect(
      appService.reviewApplication({
        contractId: contract.id,
        decision: "APPROVE",
        reviewer: salesContext,
      })
    ).rejects.toThrow(/Hanya Manager atau Owner/);

    // 3. Owner melakukan approval -> Berhasil
    const approved = await appService.reviewApplication({
      contractId: contract.id,
      decision: "APPROVE",
      reviewer: ownerContext,
    });

    expect(approved.status).toBe("DISETUJUI");
    expect(approved.approvedById).toBe(ownerContext.userId);
  });

  it("3. harus menandatangani kontrak secara digital dan mengunci hash SHA-256 dokumen", async () => {
    const { contract } = await appService.createApplication(
      {
        customerId,
        schemeId,
        orderItems: [
          {
            productId: "p1",
            variantId: "v1",
            productName: "Lemari Pakaian 4 Pintu",
            variantName: "White Gloss",
            unitPrice: 10000000n,
            quantity: 1,
          },
        ],
        downPaymentOffered: 2000000n,
        tenorMonths: 12,
      },
      salesContext
    );

    await appService.reviewApplication({
      contractId: contract.id,
      decision: "APPROVE",
      reviewer: ownerContext,
    });

    // Tandatangani kontrak
    const signResult = await appService.signContract({
      contractId: contract.id,
      customerSignatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      context: salesContext,
    });

    expect(signResult.sha256Hash).toBeDefined();
    expect(signResult.sha256Hash.length).toBe(64);
    expect(signResult.contract.contractPdfHash).toBe(signResult.sha256Hash);
    expect(signResult.contract.signedByCustomerAt).toBeDefined();
  });

  it("4. harus idempotent pada pembayaran DP (request berulang dengan key sama mengembalikan objek yang sama)", async () => {
    const { contract } = await appService.createApplication(
      {
        customerId,
        schemeId,
        orderItems: [
          {
            productId: "p1",
            variantId: "v1",
            productName: "Tempat Tidur King Size",
            variantName: "Teak Minimalist",
            unitPrice: 12000000n,
            quantity: 1,
          },
        ],
        downPaymentOffered: 3000000n,
        tenorMonths: 12,
      },
      salesContext
    );

    await appService.reviewApplication({
      contractId: contract.id,
      decision: "APPROVE",
      reviewer: ownerContext,
    });

    const idempotencyKey = "unique-idemp-dp-12345";

    // Request bayar DP pertama
    const pay1 = await appService.payDownPayment({
      contractId: contract.id,
      method: "CASH",
      cashGiven: 3100000n, // DP 3jt + Admin 100rb
      idempotencyKey,
      context: salesContext,
    });

    // Request bayar DP kedua (double submit client)
    const pay2 = await appService.payDownPayment({
      contractId: contract.id,
      method: "CASH",
      cashGiven: 3100000n,
      idempotencyKey,
      context: salesContext,
    });

    // Harus persis sama dan tidak membuat pembayaran ganda
    expect(pay1.id).toBe(pay2.id);
    expect(paymentRepo.payments.length).toBe(1);
  });

  it("5. Alur Lengkap QRIS: Generate QRIS DP -> Webhook Valid -> Kontrak Otomatis AKTIF -> Jadwal Tersimpan -> Stok Ter-reservasi", async () => {
    // 1. Buat pengajuan
    const { contract } = await appService.createApplication(
      {
        customerId,
        schemeId,
        orderItems: [
          {
            productId: "p1",
            variantId: "v1",
            productName: "Sofa Bed Scandinavian",
            variantName: "Grey Fabric",
            unitPrice: 10000000n,
            quantity: 1,
          },
        ],
        downPaymentOffered: 2000000n,
        tenorMonths: 6,
      },
      salesContext
    );

    // 2. Approve pengajuan
    await appService.reviewApplication({
      contractId: contract.id,
      decision: "APPROVE",
      reviewer: ownerContext,
    });

    // 3. Tanda tangan kontrak
    await appService.signContract({
      contractId: contract.id,
      context: salesContext,
    });

    // 4. Kasir memilih "Bayar DP via QRIS Dinamis"
    // Tagihan DP = DP (2jt) + Admin (100rb) = 2.100.000
    const payment = await appService.payDownPayment({
      contractId: contract.id,
      method: "QRIS_DYNAMIC",
      idempotencyKey: "qris-dp-idemp-001",
      context: salesContext,
    });

    expect(payment.status).toBe("PENDING");
    expect(payment.method).toBe("QRIS_DYNAMIC");
    expect(payment.amount).toBe(2100000n);
    expect(payment.qrisQrString).toBeDefined();

    // 5. Uji Webhook dengan Signature Palsu -> DITOLAK
    await expect(
      paymentService.handleGatewayWebhook(
        { "x-mock-signature": "bad-signature" },
        {
          payment_number: payment.paymentNumber,
          gross_amount: "2100000",
          event_id: "evt-fake-01",
        }
      )
    ).rejects.toThrow(/Invalid gateway signature/);

    // 6. Uji Webhook dengan Nominal Kurang -> Ditandai NEEDS_RECONCILIATION
    const partialAmount = 1000000n;
    const partialEventId = "evt-partial-01";
    const partialSig = gatewayAdapter.generateTestSignature(
      payment.paymentNumber,
      partialAmount,
      partialEventId
    );

    const partialRes = await paymentService.handleGatewayWebhook(
      { "x-mock-signature": partialSig },
      {
        payment_number: payment.paymentNumber,
        gross_amount: partialAmount.toString(),
        event_id: partialEventId,
        transaction_status: "PAID",
      }
    );
    expect(partialRes.status).toBe("NEEDS_RECONCILIATION");

    // 7. Webhook Sah Masuk (Signature Valid & Nominal Tepat Rp 2.100.000)
    const validEventId = "evt-real-settlement-01";
    const validSig = gatewayAdapter.generateTestSignature(
      payment.paymentNumber,
      2100000n,
      validEventId
    );

    const successWebhookRes = await paymentService.handleGatewayWebhook(
      { "x-mock-signature": validSig },
      {
        payment_number: payment.paymentNumber,
        gross_amount: "2100000",
        event_id: validEventId,
        gateway_reference: "QRIS-GATEWAY-TRX-777",
        transaction_status: "PAID",
      }
    );
    expect(successWebhookRes.status).toBe("PROCESSED");

    // 8. Idempotensi Webhook: Kirim ulang event yang sama -> Diabaikan tanpa duplikasi
    const duplicateRes = await paymentService.handleGatewayWebhook(
      { "x-mock-signature": validSig },
      {
        payment_number: payment.paymentNumber,
        gross_amount: "2100000",
        event_id: validEventId,
        transaction_status: "PAID",
      }
    );
    expect(duplicateRes.status).toBe("DUPLICATE_EVENT_IGNORED");

    // 9. VERIFIKASI AKHIR DAMPAK AKTIVASI KONTRAK:
    // A. Kontrak harus otomatis berubah status menjadi AKTIF
    const activeContract = await appRepo.findContractById(tenantId, contract.id);
    expect(activeContract?.status).toBe("AKTIF");
    expect(activeContract?.downPaymentPaid).toBe(2100000n);
    expect(activeContract?.activatedAt).toBeDefined();

    // B. Jadwal angsuran resmi harus ter-generate di database (6 bulan)
    const schedules = await appRepo.getInstallments(contract.id);
    expect(schedules.length).toBe(6);
    const sumPrincipalSchedules = schedules.reduce((acc, s) => acc + s.principalDue, 0n);
    expect(sumPrincipalSchedules).toBe(activeContract?.principalTotal);

    // C. Stok gudang furniture ter-reservasi
    expect(appRepo.stockReservations.length).toBe(1);
    expect(appRepo.stockReservations[0].referenceId).toBe(contract.id);
  });
});
