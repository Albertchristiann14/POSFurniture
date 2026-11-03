import { describe, it, expect, beforeEach } from "vitest";
import {
  InstallmentPaymentService,
  InMemoryInstallmentPaymentRepository,
} from "@/modules/credit/installment-payment-service";
import {
  PaymentService,
  InMemoryPaymentRepository,
} from "@/modules/payment/payment-service";
import { MockPaymentGatewayAdapter } from "@/modules/payment/payment-gateway";
import {
  LedgerEngine,
  InMemoryLedgerRepository,
} from "@/modules/ledger/ledger-engine";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";
import { UserContext } from "@/modules/credit/customer-service";

describe("Fase K4: Pembayaran Cicilan, Alokasi, Pelunasan Dipercepat & Struk Digital", () => {
  let payRepo: InMemoryInstallmentPaymentRepository;
  let paymentModuleRepo: InMemoryPaymentRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let auditLogger: AuditLogger;
  let gatewayAdapter: MockPaymentGatewayAdapter;
  let paymentService: PaymentService;
  let ledgerEngine: LedgerEngine;
  let installmentPaymentService: InstallmentPaymentService;

  const tenantId = "tenant-furniture-k4";

  const cashierContext: UserContext = {
    userId: "cashier-01",
    tenantId,
    role: "CASHIER",
    ipAddress: "192.168.1.50",
  };

  const contractId = "ktr-k4-test-01";
  const customerId = "cust-k4-01";

  beforeEach(() => {
    payRepo = new InMemoryInstallmentPaymentRepository();
    paymentModuleRepo = new InMemoryPaymentRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    gatewayAdapter = new MockPaymentGatewayAdapter("secret_k4");

    paymentService = new PaymentService(paymentModuleRepo, gatewayAdapter, auditLogger);
    ledgerEngine = new LedgerEngine(ledgerRepo, auditLogger);
    installmentPaymentService = new InstallmentPaymentService(
      payRepo,
      paymentService,
      ledgerEngine,
      auditLogger
    );

    // Setup Data Nasabah & Kontrak
    payRepo.customers.push({
      id: customerId,
      tenantId,
      fullName: "Dimas Anggara",
      nik: "3201123456780099",
      phone: "081288887777",
    });

    payRepo.contracts.push({
      id: contractId,
      tenantId,
      contractNumber: "KTR-261103-0099",
      customerId,
      status: "AKTIF",
      principalTotal: 6000000n,
      marginTotal: 600000n,
      adminFeeTotal: 50000n,
      downPaymentRequired: 1500000n,
      downPaymentPaid: 1500000n,
      monthlyInstallment: 1100000n,
      schemeSnapshot: {
        tenorMonths: 6,
        marginMethod: "FLAT_MONTHLY",
        marginRateBps: 167,
      },
    });

    // Setup 6 Bulan Angsuran (@ Pokok 1.000.000 + Margin 100.000 = Rp 1.100.000)
    for (let i = 1; i <= 6; i++) {
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + (i - 1));

      payRepo.installments.push({
        id: `sch-${i}`,
        installmentNumber: i,
        dueDate,
        principalDue: 1000000n,
        marginDue: 100000n,
        totalDue: 1100000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        status: i === 1 ? "JATUH_TEMPO" : "BELUM_JATUH_TEMPO",
      } as any);
      (payRepo.installments[payRepo.installments.length - 1] as any).contractId = contractId;
    }
  });

  it("1. harus memproses pembayaran cicilan tunai di kasir dan menghasilkan struk dengan sisa piutang akurat", async () => {
    // Konsumen membayar angsuran #1 (Rp 1.100.000) dengan uang tunai Rp 1.200.000 (kembalian 100rb)
    const result = await installmentPaymentService.processInstallmentPayment({
      tenantId,
      contractId,
      method: "CASH",
      amount: 1100000n,
      cashGiven: 1200000n,
      idempotencyKey: "idemp-pay-inst-1",
      context: cashierContext,
    });

    expect(result.payment.status).toBe("PAID");
    expect(result.payment.changeReturned).toBe(100000n);

    // Verifikasi status angsuran #1 berubah menjadi LUNAS
    const inst1 = payRepo.installments.find((i) => i.installmentNumber === 1);
    expect(inst1?.status).toBe("LUNAS");
    expect(inst1?.principalPaid).toBe(1000000n);
    expect(inst1?.marginPaid).toBe(100000n);

    // Verifikasi alokasi tercatat
    expect(payRepo.allocations.length).toBe(1);
    expect(payRepo.allocations[0].allocatedPrincipal).toBe(1000000n);
    expect(payRepo.allocations[0].allocatedMargin).toBe(100000n);

    // Verifikasi Double-Entry Ledger berimbang
    const lastBatch = ledgerRepo.batches[ledgerRepo.batches.length - 1];
    expect(lastBatch.referenceEvent).toBe("INSTALLMENT_PAID");
    const totalDebit = lastBatch.entries
      .filter((e) => e.direction === "DEBIT")
      .reduce((sum, e) => sum + e.amount, 0n);
    const totalCredit = lastBatch.entries
      .filter((e) => e.direction === "CREDIT")
      .reduce((sum, e) => sum + e.amount, 0n);
    expect(totalDebit).toBe(totalCredit);

    // Verifikasi Struk Thermal memuat informasi lengkap
    expect(result.thermalReceiptText).toContain("KTR-261103-0099");
    expect(result.thermalReceiptText).toContain("Dimas Anggara");
    expect(result.thermalReceiptText).toContain("Alokasi Pokok");
    expect(result.thermalReceiptText).toContain("Rp 1.100.000");
    expect(result.thermalReceiptText).toContain("Kembalian");
  });

  it("2. harus menangani pembayaran cicilan parsial (sebagian) dan memperbarui status menjadi LUNAS_SEBAGIAN", async () => {
    // Tagihan angsuran #1 = Rp 1.100.000, konsumen hanya bayar Rp 600.000
    const result = await installmentPaymentService.processInstallmentPayment({
      tenantId,
      contractId,
      method: "CASH",
      amount: 600000n,
      idempotencyKey: "idemp-pay-partial",
      context: cashierContext,
    });

    const inst1 = payRepo.installments.find((i) => i.installmentNumber === 1);
    // Prioritas alokasi: Margin lunas dulu (100rb), sisa 500rb masuk ke Pokok
    expect(inst1?.marginPaid).toBe(100000n);
    expect(inst1?.principalPaid).toBe(500000n);
    expect(inst1?.status).toBe("LUNAS_SEBAGIAN");
    expect(result.contractStatus).toBe("AKTIF");
  });

  it("3. harus mentransisikan kontrak menjadi LUNAS ketika seluruh angsuran telah selesai dibayar", async () => {
    // Lunasi 5 angsuran pertama terlebih dahulu
    for (let i = 1; i <= 5; i++) {
      const inst = payRepo.installments.find((item) => item.installmentNumber === i);
      if (inst) {
        inst.principalPaid = inst.principalDue;
        inst.marginPaid = inst.marginDue;
        inst.status = "LUNAS";
      }
    }

    // Bayar angsuran terakhir (#6)
    const finalPayment = await installmentPaymentService.processInstallmentPayment({
      tenantId,
      contractId,
      method: "CASH",
      amount: 1100000n,
      idempotencyKey: "idemp-pay-final-6",
      context: cashierContext,
    });

    // Kontrak harus bertransisi otomatis ke LUNAS
    expect(finalPayment.contractStatus).toBe("LUNAS");
    const updatedContract = await payRepo.findContract(tenantId, contractId);
    expect(updatedContract.status).toBe("LUNAS");
    expect(updatedContract.completedAt).toBeDefined();
  });

  it("4. harus mengeksekusi Pelunasan Dipercepat (Early Settlement) dengan menghapus sisa margin masa depan", async () => {
    // Kontrak memiliki 6 angsuran sisa @ 1.1jt (Pokok 1jt, Margin 100rb).
    // Angsuran #1 sudah jatuh tempo (Margin 100rb diakui toko).
    // Angsuran #2 s/d #6 di masa depan: Margin 5 x 100rb = 500rb dihapuskan 100% sebagai diskon pelunasan awal.
    // Total bayar pelunasan = Sisa Pokok (6.000.000) + Margin Jatuh Tempo (100.000) = 6.100.000
    const earlyPayoffResult = await installmentPaymentService.processEarlySettlement({
      tenantId,
      contractId,
      futureMarginDiscountPct: 100,
      idempotencyKey: "early-settle-idemp-01",
      context: cashierContext,
    });

    expect(earlyPayoffResult.netPayoffAmount).toBe(6100000n);
    expect(earlyPayoffResult.contract.status).toBe("LUNAS");

    // Seluruh angsuran harus berstatus LUNAS
    const allInstallments = await payRepo.getInstallments(contractId);
    for (const inst of allInstallments) {
      expect(inst.status).toBe("LUNAS");
    }

    // Verifikasi jurnal pelunasan dipercepat berimbang di ledger
    const lastBatch = ledgerRepo.batches[ledgerRepo.batches.length - 1];
    expect(lastBatch.referenceEvent).toBe("EARLY_SETTLEMENT");
    const totalDebit = lastBatch.entries
      .filter((e) => e.direction === "DEBIT")
      .reduce((sum, e) => sum + e.amount, 0n);
    const totalCredit = lastBatch.entries
      .filter((e) => e.direction === "CREDIT")
      .reduce((sum, e) => sum + e.amount, 0n);
    expect(totalDebit).toBe(totalCredit);
  });
});
