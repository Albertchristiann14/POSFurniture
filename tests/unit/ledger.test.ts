import { describe, it, expect, beforeEach } from "vitest";
import {
  LedgerEngine,
  InMemoryLedgerRepository,
  UnbalancedLedgerBatchError,
} from "@/modules/ledger/ledger-engine";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Double-Entry Append-Only Ledger Engine", () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let auditLogger: AuditLogger;
  let ledgerEngine: LedgerEngine;
  const tenantId = "tenant-ledger-test";

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    ledgerEngine = new LedgerEngine(ledgerRepo, auditLogger);
  });

  it("1. harus berhasil memposting jurnal berimbang (Debit == Kredit)", async () => {
    const batch = await ledgerEngine.postBatch({
      tenantId,
      idempotencyKey: "batch-idemp-001",
      referenceEvent: "TEST_EVENT",
      description: "Uji coba jurnal berimbang",
      entries: [
        { accountCode: "KAS_BANK", direction: "DEBIT", amount: 1500000n },
        { accountCode: "PENDAPATAN_PENJUALAN", direction: "CREDIT", amount: 1500000n },
      ],
    });

    expect(batch.id).toBeDefined();
    expect(batch.entries.length).toBe(2);

    // Cek saldo akun
    const kasBalance = await ledgerEngine.getAccountBalance(tenantId, "KAS_BANK");
    const revBalance = await ledgerEngine.getAccountBalance(tenantId, "PENDAPATAN_PENJUALAN");

    expect(kasBalance).toBe(1500000n);
    expect(revBalance).toBe(1500000n);
  });

  it("2. harus menolak jurnal tidak seimbang (Unbalanced Batch: Debit != Kredit)", async () => {
    await expect(
      ledgerEngine.postBatch({
        tenantId,
        idempotencyKey: "batch-unbalanced",
        referenceEvent: "TEST_UNBALANCED",
        description: "Debit tidak sama dengan kredit",
        entries: [
          { accountCode: "KAS_BANK", direction: "DEBIT", amount: 2000000n },
          { accountCode: "PENDAPATAN_PENJUALAN", direction: "CREDIT", amount: 1500000n }, // Selisih 500rb!
        ],
      })
    ).rejects.toThrow(UnbalancedLedgerBatchError);
  });

  it("3. harus menjamin idempotensi: posting ulang dengan key yang sama tidak menduplikasi entri", async () => {
    const key = "idemp-key-exact";

    const b1 = await ledgerEngine.postBatch({
      tenantId,
      idempotencyKey: key,
      referenceEvent: "PAYMENT",
      description: "Pembayaran pertama",
      entries: [
        { accountCode: "KAS_BANK", direction: "DEBIT", amount: 500000n },
        { accountCode: "PIUTANG_POKOK", direction: "CREDIT", amount: 500000n },
      ],
    });

    // Panggil ulang dengan key yang sama
    const b2 = await ledgerEngine.postBatch({
      tenantId,
      idempotencyKey: key,
      referenceEvent: "PAYMENT",
      description: "Pembayaran duplikat",
      entries: [
        { accountCode: "KAS_BANK", direction: "DEBIT", amount: 500000n },
        { accountCode: "PIUTANG_POKOK", direction: "CREDIT", amount: 500000n },
      ],
    });

    expect(b1.id).toBe(b2.id);
    expect(ledgerRepo.batches.length).toBe(1);
    expect(ledgerRepo.entries.length).toBe(2);
  });

  it("4. harus memposting jurnal aktivasi kontrak dan menghitung sisa piutang secara matematis", async () => {
    // Furniture Rp 15.000.000, DP Rp 3.000.000, Admin Rp 100.000, Pokok Rp 12.000.000, Margin Rp 2.400.000
    const contractId = "ktr-sample-01";
    await ledgerEngine.postContractActivation({
      tenantId,
      contractId,
      contractNumber: "KTR-261103-0001",
      itemTotalAmount: 15000000n,
      downPaymentPaid: 3000000n,
      adminFeePaid: 100000n,
      principalTotal: 12000000n,
      marginTotal: 2400000n,
      idempotencyKey: "idemp-activation-01",
    });

    // Cek saldo piutang kontrak murni dari ledger
    const balance = await ledgerEngine.getContractReceivableBalance(tenantId, contractId);
    // Piutang Pokok + Margin = 12jt + 2.4jt = 14.4jt
    expect(balance.principalOutstanding).toBe(14400000n);
    expect(balance.penaltyOutstanding).toBe(0n);
    expect(balance.totalOutstanding).toBe(14400000n);
  });

  it("5. harus melakukan koreksi melalui Jurnal Pembalik (Reversal) tanpa mengubah/menghapus entri lama (Append-Only)", async () => {
    // Posting transaksi salah
    const originalBatch = await ledgerEngine.postBatch({
      tenantId,
      idempotencyKey: "batch-wrong-01",
      referenceEvent: "MANUAL_ENTRY",
      description: "Salah input manual",
      entries: [
        { accountCode: "PIUTANG_DENDA", direction: "DEBIT", amount: 100000n },
        { accountCode: "PENDAPATAN_DENDA", direction: "CREDIT", amount: 100000n },
      ],
    });

    const saldoAwal = await ledgerEngine.getAccountBalance(tenantId, "PIUTANG_DENDA");
    expect(saldoAwal).toBe(100000n);

    // Koreksi dengan jurnal pembalik
    await ledgerEngine.postReversalCorrection({
      tenantId,
      originalBatchId: originalBatch.id,
      reason: "Penghapusan denda karena kesalahan sistem",
      idempotencyKey: "reversal-01",
      createdById: "mgr-01",
      entriesToReverse: originalBatch.entries.map((e) => ({
        accountCode: e.accountCode,
        direction: e.direction,
        amount: e.amount,
      })),
    });

    // Entri lama tetap ada di database (Append-Only)
    expect(ledgerRepo.batches.length).toBe(2);
    expect(ledgerRepo.entries.length).toBe(4);

    // Saldo bersih sekarang kembali 0
    const saldoAkhir = await ledgerEngine.getAccountBalance(tenantId, "PIUTANG_DENDA");
    expect(saldoAkhir).toBe(0n);
  });
});

