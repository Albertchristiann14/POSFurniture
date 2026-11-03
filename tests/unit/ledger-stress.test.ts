import { describe, it, expect, beforeEach } from "vitest";
import {
  LedgerEngine,
  InMemoryLedgerRepository,
} from "@/modules/ledger/ledger-engine";
import { AllocationEngine, InstallmentForAllocation } from "@/modules/credit/allocation-engine";
import { calculateInstallmentSchedule } from "@/modules/credit/calculator";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Fase K6: Hardening - Property-Based & Ledger Invariant Stress Test", () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let auditLogger: AuditLogger;
  let ledgerEngine: LedgerEngine;
  const tenantId = "tenant-stress-test";

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    ledgerEngine = new LedgerEngine(ledgerRepo, auditLogger);
  });

  it("Invariant Test: Simulasi 100 kontrak acak dengan berbagai transaksi (aktivasi, bayar parsial, denda, pelunasan awal) harus selalu seimbang Debit == Kredit", async () => {
    const contracts: Array<{
      id: string;
      contractNumber: string;
      principal: bigint;
      margin: bigint;
      installments: InstallmentForAllocation[];
    }> = [];

    // 1. Generate 100 Kontrak dengan parameter acak
    for (let i = 1; i <= 100; i++) {
      const contractId = `ktr-stress-${i}`;
      const contractNumber = `KTR-STRESS-${i.toString().padStart(4, "0")}`;

      // Harga acak Rp 2.000.000 s/d Rp 40.000.000
      const itemPrice = BigInt(Math.floor(Math.random() * 38000000) + 2000000);
      const dpPct = Math.floor(Math.random() * 40) + 20; // DP 20% - 60%
      const dpAmount = (itemPrice * BigInt(dpPct)) / 100n;
      const tenor = (i % 6) * 3 + 3; // 3, 6, 9, 12, 15, 18 bulan
      const adminFee = 50000n;

      const scheduleCalc = calculateInstallmentSchedule({
        itemTotalAmount: itemPrice,
        downPaymentAmount: dpAmount,
        tenorMonths: tenor,
        marginMethod: "FLAT_MONTHLY",
        marginRateBps: 200,
        adminFeeAmount: adminFee,
      });

      // Aktivasi kontrak di Ledger
      await ledgerEngine.postContractActivation({
        tenantId,
        contractId,
        contractNumber,
        itemTotalAmount: itemPrice,
        downPaymentPaid: dpAmount,
        adminFeePaid: adminFee,
        principalTotal: scheduleCalc.principalTotal,
        marginTotal: scheduleCalc.marginTotal,
        idempotencyKey: `act-${contractId}`,
      });

      const insts: InstallmentForAllocation[] = scheduleCalc.installments.map((s) => ({
        id: `inst-${contractId}-${s.installmentNumber}`,
        installmentNumber: s.installmentNumber,
        dueDate: s.dueDate,
        principalDue: s.principalDue,
        marginDue: s.marginDue,
        totalDue: s.totalDue,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        status: "BELUM_JATUH_TEMPO",
      }));

      contracts.push({
        id: contractId,
        contractNumber,
        principal: scheduleCalc.principalTotal,
        margin: scheduleCalc.marginTotal,
        installments: insts,
      });
    }

    // 2. Simulasikan Berbagai Transaksi Acak pada Kontrak-Kontrak Ini
    for (const contract of contracts) {
      const dice = Math.random();

      if (dice < 0.25) {
        // Kasus 1: Denda Keterlambatan Harian + Bayar Parsial
        const inst1 = contract.installments[0];
        inst1.penaltyAccrued = 30000n;

        // Akrual denda di ledger
        await ledgerEngine.postPenaltyAccrual({
          tenantId,
          contractId: contract.id,
          installmentNumber: 1,
          penaltyAmount: 30000n,
          idempotencyKey: `pen-${inst1.id}`,
        });

        // Bayar sebagian (misal 50% dari total due)
        const partialPay = inst1.totalDue / 2n;
        const plan = AllocationEngine.allocatePayment(contract.installments, partialPay);

        // Bukukan pembayaran sebagian di ledger
        await ledgerEngine.postBatch({
          tenantId,
          contractId: contract.id,
          idempotencyKey: `pay-part-${contract.id}`,
          referenceEvent: "INSTALLMENT_PAID",
          description: `Bayar parsial ${contract.contractNumber}`,
          entries: [
            { accountCode: "KAS_BANK", direction: "DEBIT", amount: partialPay },
            { accountCode: "PIUTANG_DENDA", direction: "CREDIT", amount: plan.totalAllocatedPenalty },
            {
              accountCode: "PIUTANG_POKOK",
              direction: "CREDIT",
              amount: plan.totalAllocatedMargin + plan.totalAllocatedPrincipal,
            },
          ],
        });
      } else if (dice < 0.5) {
        // Kasus 2: Bayar Angsuran Pertama Lunas Pas
        const inst1 = contract.installments[0];
        const payAmount = inst1.totalDue;
        const plan = AllocationEngine.allocatePayment(contract.installments, payAmount);

        await ledgerEngine.postBatch({
          tenantId,
          contractId: contract.id,
          idempotencyKey: `pay-full-${contract.id}`,
          referenceEvent: "INSTALLMENT_PAID",
          description: `Bayar lunas angsuran 1 ${contract.contractNumber}`,
          entries: [
            { accountCode: "KAS_BANK", direction: "DEBIT", amount: payAmount },
            { accountCode: "PIUTANG_POKOK", direction: "CREDIT", amount: payAmount },
            { accountCode: "MARGIN_DITANGGUHKAN", direction: "DEBIT", amount: plan.totalAllocatedMargin },
            { accountCode: "PENDAPATAN_MARGIN", direction: "CREDIT", amount: plan.totalAllocatedMargin },
          ],
        });
      } else if (dice < 0.75) {
        // Kasus 3: Pelunasan Dipercepat (Early Settlement)
        const payoff = AllocationEngine.calculateEarlyPayoff({
          installments: contract.installments,
          futureMarginDiscountPct: 100,
        });

        const dueMargin = payoff.netPayoffAmount - payoff.totalRemainingPrincipal - payoff.totalUnpaidPenalty;

        const entries: any[] = [
          { accountCode: "KAS_BANK", direction: "DEBIT", amount: payoff.netPayoffAmount },
          {
            accountCode: "PIUTANG_POKOK",
            direction: "CREDIT",
            amount: payoff.totalRemainingPrincipal + (dueMargin > 0n ? dueMargin : 0n),
          },
        ];

        if (payoff.marginDiscountAmount > 0n) {
          entries.push({
            accountCode: "MARGIN_DITANGGUHKAN",
            direction: "DEBIT",
            amount: payoff.marginDiscountAmount,
          });
          entries.push({
            accountCode: "PIUTANG_POKOK",
            direction: "CREDIT",
            amount: payoff.marginDiscountAmount,
          });
        }

        await ledgerEngine.postBatch({
          tenantId,
          contractId: contract.id,
          idempotencyKey: `early-${contract.id}`,
          referenceEvent: "EARLY_SETTLEMENT",
          description: `Pelunasan dipercepat ${contract.contractNumber}`,
          entries,
        });
      }
    }

    // 3. INVARIANT CHECK: Seluruh Jurnal di Database Harus Seimbang Mutlak (Total Debit == Total Kredit)
    const allEntries = await ledgerRepo.getAllEntries(tenantId);
    let systemTotalDebit = 0n;
    let systemTotalCredit = 0n;

    for (const entry of allEntries) {
      if (entry.direction === "DEBIT") systemTotalDebit += entry.amount;
      else if (entry.direction === "CREDIT") systemTotalCredit += entry.amount;
    }

    // Integritas Buku Besar: Total Debit SELALU tepat sama dengan Total Kredit
    expect(systemTotalDebit).toBe(systemTotalCredit);
    expect(systemTotalDebit).toBeGreaterThan(0n);
    expect(ledgerRepo.batches.length).toBeGreaterThanOrEqual(100);
  });
});

