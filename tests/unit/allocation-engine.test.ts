import { describe, it, expect } from "vitest";
import { AllocationEngine, InstallmentForAllocation } from "@/modules/credit/allocation-engine";

describe("Allocation Engine (Algoritma Alokasi Pembayaran Cicilan)", () => {
  it("harus mengalokasikan pembayaran sebagian dengan urutan prioritas ketat: Denda -> Margin -> Pokok", () => {
    // Satu angsuran tertunggak: Denda 50.000, Margin 200.000, Pokok 1.000.000
    const installments: InstallmentForAllocation[] = [
      {
        id: "sch-1",
        installmentNumber: 1,
        dueDate: new Date("2026-10-01"),
        principalDue: 1000000n,
        marginDue: 200000n,
        totalDue: 1200000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 50000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
    ];

    // Kasus A: Bayar Rp 40.000 (hanya cukup untuk sebagian denda)
    const planA = AllocationEngine.allocatePayment(installments, 40000n);
    expect(planA.totalAllocatedPenalty).toBe(40000n);
    expect(planA.totalAllocatedMargin).toBe(0n);
    expect(planA.totalAllocatedPrincipal).toBe(0n);
    expect(planA.allocations[0].newStatus).toBe("LUNAS_SEBAGIAN");

    // Kasus B: Bayar Rp 150.000 (Denda 50.000 lunas, sisanya 100.000 masuk ke margin)
    const planB = AllocationEngine.allocatePayment(installments, 150000n);
    expect(planB.totalAllocatedPenalty).toBe(50000n); // Denda lunas
    expect(planB.totalAllocatedMargin).toBe(100000n); // Margin sebagian
    expect(planB.totalAllocatedPrincipal).toBe(0n);
    expect(planB.allocations[0].newStatus).toBe("LUNAS_SEBAGIAN");

    // Kasus C: Bayar Rp 1.250.000 (Denda + Margin + Pokok lunas pas)
    const planC = AllocationEngine.allocatePayment(installments, 1250000n);
    expect(planC.totalAllocatedPenalty).toBe(50000n);
    expect(planC.totalAllocatedMargin).toBe(200000n);
    expect(planC.totalAllocatedPrincipal).toBe(1000000n);
    expect(planC.allocations[0].newStatus).toBe("LUNAS");
    expect(planC.isFullySettled).toBe(true);
  });

  it("harus mengalokasikan kelebihan bayar secara otomatis merembes ke angsuran berikutnya", () => {
    const installments: InstallmentForAllocation[] = [
      {
        id: "sch-1",
        installmentNumber: 1,
        dueDate: new Date("2026-10-01"),
        principalDue: 800000n,
        marginDue: 200000n,
        totalDue: 1000000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        status: "JATUH_TEMPO",
      },
      {
        id: "sch-2",
        installmentNumber: 2,
        dueDate: new Date("2026-11-01"),
        principalDue: 800000n,
        marginDue: 200000n,
        totalDue: 1000000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        status: "BELUM_JATUH_TEMPO",
      },
    ];

    // Konsumen bayar Rp 1.500.000 (angsuran 1 lunas + angsuran 2 terbayar 500.000)
    const plan = AllocationEngine.allocatePayment(installments, 1500000n);

    expect(plan.allocations.length).toBe(2);

    // Angsuran 1 lunas (Margin 200rb + Pokok 800rb)
    const alloc1 = plan.allocations.find((a) => a.installmentNumber === 1);
    expect(alloc1?.totalAllocated).toBe(1000000n);
    expect(alloc1?.newStatus).toBe("LUNAS");

    // Angsuran 2 terbayar 500rb (Margin 200rb lunas + Pokok 300rb sebagian)
    const alloc2 = plan.allocations.find((a) => a.installmentNumber === 2);
    expect(alloc2?.totalAllocated).toBe(500000n);
    expect(alloc2?.allocatedMargin).toBe(200000n);
    expect(alloc2?.allocatedPrincipal).toBe(300000n);
    expect(alloc2?.newStatus).toBe("LUNAS_SEBAGIAN");
    expect(alloc2?.remainingDueOnThisInstallment).toBe(500000n);

    expect(plan.isFullySettled).toBe(false);
  });

  it("harus menghitung pelunasan dipercepat (Early Payoff) dengan diskon margin masa depan 100%", () => {
    const installments: InstallmentForAllocation[] = [
      {
        id: "sch-1",
        installmentNumber: 1,
        dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // Sudah jatuh tempo 5 hari lalu
        principalDue: 1000000n,
        marginDue: 200000n,
        totalDue: 1200000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 30000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
      {
        id: "sch-2",
        installmentNumber: 2,
        dueDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // Masa depan (+25 hari)
        principalDue: 1000000n,
        marginDue: 200000n,
        totalDue: 1200000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        status: "BELUM_JATUH_TEMPO",
      },
    ];

    const payoff = AllocationEngine.calculateEarlyPayoff({
      installments,
      futureMarginDiscountPct: 100, // Diskon 100% margin masa depan
    });

    // Total Pokok = 1.000.000 + 1.000.000 = 2.000.000
    expect(payoff.totalRemainingPrincipal).toBe(2000000n);
    // Denda = 30.000
    expect(payoff.totalUnpaidPenalty).toBe(30000n);
    // Margin masa depan angsuran #2 = 200.000 dihapuskan
    expect(payoff.unrealizedFutureMargin).toBe(200000n);
    expect(payoff.marginDiscountAmount).toBe(200000n);

    // Net Bayar = Pokok (2jt) + Denda (30rb) + Margin Jatuh Tempo #1 (200rb) + 0 (Margin #2 diskon) = 2.230.000
    expect(payoff.netPayoffAmount).toBe(2230000n);
  });
});
