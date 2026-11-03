export interface InstallmentForAllocation {
  id: string;
  installmentNumber: number;
  dueDate: Date;
  principalDue: bigint;
  marginDue: bigint;
  totalDue: bigint;
  principalPaid: bigint;
  marginPaid: bigint;
  penaltyAccrued: bigint;
  penaltyPaid: bigint;
  status: "BELUM_JATUH_TEMPO" | "JATUH_TEMPO" | "TERLAMBAT" | "LUNAS_SEBAGIAN" | "LUNAS";
}

export interface InstallmentAllocationResult {
  installmentId: string;
  installmentNumber: number;
  allocatedPenalty: bigint;
  allocatedMargin: bigint;
  allocatedPrincipal: bigint;
  totalAllocated: bigint;
  newPenaltyPaid: bigint;
  newMarginPaid: bigint;
  newPrincipalPaid: bigint;
  newStatus: "BELUM_JATUH_TEMPO" | "JATUH_TEMPO" | "TERLAMBAT" | "LUNAS_SEBAGIAN" | "LUNAS";
  remainingDueOnThisInstallment: bigint;
}

export interface OverallAllocationPlan {
  totalPaymentAmount: bigint;
  totalAllocatedPenalty: bigint;
  totalAllocatedMargin: bigint;
  totalAllocatedPrincipal: bigint;
  remainingUnallocatedAmount: bigint; // Kelebihan bayar jika ada sisa
  allocations: InstallmentAllocationResult[];
  isFullySettled: boolean;
}

export interface EarlyPayoffCalculation {
  totalRemainingPrincipal: bigint; // Seluruh sisa pokok dari semua angsuran
  totalUnpaidPenalty: bigint; // Seluruh denda terhutang
  unrealizedFutureMargin: bigint; // Seluruh margin masa depan yang belum jatuh tempo
  futureMarginDiscountPct: number; // Kebijakan diskon margin (misal 100% dihapuskan)
  marginDiscountAmount: bigint; // Nominal potongan margin
  netPayoffAmount: bigint; // Total uang yang harus dibayar nasabah
}

export class AllocationEngine {
  /**
   * Mengalokasikan dana pembayaran ke jadwal angsuran berdasarkan urutan prioritas ketat:
   * 1. Denda tertunggak (terlama ke terbaru)
   * 2. Margin tertunggak / jatuh tempo (terlama ke terbaru)
   * 3. Pokok angsuran (terlama ke terbaru)
   * 4. Jika ada kelebihan, merembes ke angsuran bulan berikutnya
   */
  static allocatePayment(
    installments: InstallmentForAllocation[],
    paymentAmount: bigint
  ): OverallAllocationPlan {
    if (paymentAmount <= 0n) {
      throw new Error("Nominal pembayaran harus lebih besar dari 0");
    }

    // Urutkan angsuran berdasarkan nomor angsuran (paling lama lebih dulu)
    const sorted = [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber);

    let remainingFunds = paymentAmount;
    let totalAllocatedPenalty = 0n;
    let totalAllocatedMargin = 0n;
    let totalAllocatedPrincipal = 0n;

    const allocations: InstallmentAllocationResult[] = [];

    for (const inst of sorted) {
      if (remainingFunds <= 0n) break;
      if (inst.status === "LUNAS") continue;

      let allocatedPenalty = 0n;
      let allocatedMargin = 0n;
      let allocatedPrincipal = 0n;

      // Sisa kewajiban pada angsuran ini
      const unpaidPenalty = inst.penaltyAccrued > inst.penaltyPaid ? inst.penaltyAccrued - inst.penaltyPaid : 0n;
      const unpaidMargin = inst.marginDue > inst.marginPaid ? inst.marginDue - inst.marginPaid : 0n;
      const unpaidPrincipal = inst.principalDue > inst.principalPaid ? inst.principalDue - inst.principalPaid : 0n;

      // 1. Alokasi ke Denda
      if (unpaidPenalty > 0n && remainingFunds > 0n) {
        allocatedPenalty = remainingFunds >= unpaidPenalty ? unpaidPenalty : remainingFunds;
        remainingFunds -= allocatedPenalty;
        totalAllocatedPenalty += allocatedPenalty;
      }

      // 2. Alokasi ke Margin
      if (unpaidMargin > 0n && remainingFunds > 0n) {
        allocatedMargin = remainingFunds >= unpaidMargin ? unpaidMargin : remainingFunds;
        remainingFunds -= allocatedMargin;
        totalAllocatedMargin += allocatedMargin;
      }

      // 3. Alokasi ke Pokok
      if (unpaidPrincipal > 0n && remainingFunds > 0n) {
        allocatedPrincipal = remainingFunds >= unpaidPrincipal ? unpaidPrincipal : remainingFunds;
        remainingFunds -= allocatedPrincipal;
        totalAllocatedPrincipal += allocatedPrincipal;
      }

      const totalAllocatedOnThis = allocatedPenalty + allocatedMargin + allocatedPrincipal;
      if (totalAllocatedOnThis > 0n) {
        const newPenaltyPaid = inst.penaltyPaid + allocatedPenalty;
        const newMarginPaid = inst.marginPaid + allocatedMargin;
        const newPrincipalPaid = inst.principalPaid + allocatedPrincipal;

        const isInstallmentFullyPaid =
          newPrincipalPaid === inst.principalDue &&
          newMarginPaid === inst.marginDue &&
          newPenaltyPaid === inst.penaltyAccrued;

        const newStatus = isInstallmentFullyPaid
          ? "LUNAS"
          : "LUNAS_SEBAGIAN";

        const remainingDueOnThis =
          inst.principalDue + inst.marginDue + inst.penaltyAccrued - (newPrincipalPaid + newMarginPaid + newPenaltyPaid);

        allocations.push({
          installmentId: inst.id,
          installmentNumber: inst.installmentNumber,
          allocatedPenalty,
          allocatedMargin,
          allocatedPrincipal,
          totalAllocated: totalAllocatedOnThis,
          newPenaltyPaid,
          newMarginPaid,
          newPrincipalPaid,
          newStatus,
          remainingDueOnThisInstallment: remainingDueOnThis,
        });
      }
    }

    // Periksa apakah semua angsuran kini lunas
    const allSettled = sorted.every((inst) => {
      const match = allocations.find((a) => a.installmentId === inst.id);
      if (match) return match.newStatus === "LUNAS";
      return inst.status === "LUNAS";
    });

    return {
      totalPaymentAmount: paymentAmount,
      totalAllocatedPenalty,
      totalAllocatedMargin,
      totalAllocatedPrincipal,
      remainingUnallocatedAmount: remainingFunds, // Kelebihan bayar jika ada
      allocations,
      isFullySettled: allSettled,
    };
  }

  /**
   * Menghitung rincian pelunasan dipercepat (Early Payoff):
   * Seluruh sisa pokok + seluruh denda - potongan diskon margin masa depan
   */
  static calculateEarlyPayoff(params: {
    installments: InstallmentForAllocation[];
    futureMarginDiscountPct?: number; // default: 100% (semua margin masa depan dihapus)
    asOfDate?: Date;
  }): EarlyPayoffCalculation {
    const { installments, futureMarginDiscountPct = 100, asOfDate = new Date() } = params;

    let totalRemainingPrincipal = 0n;
    let totalUnpaidPenalty = 0n;
    let totalUnpaidMargin = 0n;
    let unrealizedFutureMargin = 0n;

    for (const inst of installments) {
      if (inst.status === "LUNAS") continue;

      // Sisa pokok
      const remPrincipal = inst.principalDue > inst.principalPaid ? inst.principalDue - inst.principalPaid : 0n;
      totalRemainingPrincipal += remPrincipal;

      // Sisa denda
      const remPenalty = inst.penaltyAccrued > inst.penaltyPaid ? inst.penaltyAccrued - inst.penaltyPaid : 0n;
      totalUnpaidPenalty += remPenalty;

      // Sisa margin
      const remMargin = inst.marginDue > inst.marginPaid ? inst.marginDue - inst.marginPaid : 0n;
      totalUnpaidMargin += remMargin;

      // Jika angsuran belum jatuh tempo pada tanggal pelunasan, margin dihitung sebagai margin masa depan
      if (new Date(inst.dueDate).getTime() > asOfDate.getTime()) {
        unrealizedFutureMargin += remMargin;
      }
    }

    // Margin yang sudah jatuh tempo tetap wajib dibayar
    const dueMargin = totalUnpaidMargin - unrealizedFutureMargin;

    // Hitung diskon margin masa depan
    const discountPctBig = BigInt(Math.min(100, Math.max(0, futureMarginDiscountPct)));
    const marginDiscountAmount = (unrealizedFutureMargin * discountPctBig) / 100n;

    // Net pelunasan = Sisa Pokok + Sisa Denda + Margin yang Sudah Jatuh Tempo + (Margin Masa Depan - Diskon)
    const netPayoffAmount =
      totalRemainingPrincipal + totalUnpaidPenalty + dueMargin + (unrealizedFutureMargin - marginDiscountAmount);

    return {
      totalRemainingPrincipal,
      totalUnpaidPenalty,
      unrealizedFutureMargin,
      futureMarginDiscountPct,
      marginDiscountAmount,
      netPayoffAmount,
    };
  }
}
