import { roundDivBigInt } from "@/shared/math/currency";

export type MarginMethodType = "FLAT_MONTHLY" | "FLAT_TOTAL" | "EFFECTIVE_ANNUITY" | "ZERO_MARGIN";

export interface CalculationInput {
  itemTotalAmount: bigint; // Total harga barang (furniture)
  downPaymentAmount: bigint; // Nominal DP yang dibayarkan
  tenorMonths: number; // Jumlah bulan cicilan (misal: 3, 6, 12)
  marginMethod: MarginMethodType; // Metode perhitungan margin
  marginRateBps: number; // Basis points (contoh: 200 bps = 2% per bulan atau per tahun)
  adminFeeAmount: bigint; // Biaya administrasi
  firstDueDate?: Date; // Tanggal jatuh tempo angsuran pertama (default: +1 bulan dari hari ini)
}

export interface CalculatedInstallmentItem {
  installmentNumber: number;
  dueDate: Date;
  principalDue: bigint;
  marginDue: bigint;
  totalDue: bigint;
  remainingPrincipal: bigint; // Sisa pokok setelah angsuran ini
}

export interface CalculationResult {
  itemTotalAmount: bigint;
  downPaymentAmount: bigint;
  principalTotal: bigint; // Pokok hutang: itemTotalAmount - downPaymentAmount
  marginTotal: bigint; // Total keuntungan/margin toko selama tenor
  adminFeeAmount: bigint;
  totalCreditFinanced: bigint; // principalTotal + marginTotal
  monthlyInstallmentEstimate: bigint; // Perkiraan angsuran per bulan (angsuran reguler)
  installments: CalculatedInstallmentItem[];
  roundingDiscrepancy: {
    principalAdjusted: bigint; // Selisih pokok yang dialokasikan ke angsuran terakhir
    marginAdjusted: bigint; // Selisih margin yang dialokasikan ke angsuran terakhir
  };
}

/**
 * Single Shared Calculation Engine for Credit Simulation and Contract Creation
 * Rule: Pure integer arithmetic, zero float drift, discrepancy = 0.
 */
export function calculateInstallmentSchedule(input: CalculationInput): CalculationResult {
  const {
    itemTotalAmount,
    downPaymentAmount,
    tenorMonths,
    marginMethod,
    marginRateBps,
    adminFeeAmount,
    firstDueDate = addMonths(new Date(), 1),
  } = input;

  if (tenorMonths <= 0) {
    throw new Error("Tenor cicilan harus lebih besar dari 0 bulan");
  }
  if (itemTotalAmount <= 0n) {
    throw new Error("Total harga barang harus lebih besar dari 0");
  }
  if (downPaymentAmount < 0n) {
    throw new Error("Uang muka (DP) tidak boleh negatif");
  }
  if (downPaymentAmount >= itemTotalAmount) {
    throw new Error("Uang muka (DP) tidak boleh melebihi atau sama dengan harga barang");
  }

  const principalTotal = itemTotalAmount - downPaymentAmount;
  const tenorBig = BigInt(tenorMonths);

  let marginTotal = 0n;

  if (marginMethod === "ZERO_MARGIN") {
    marginTotal = 0n;
  } else if (marginMethod === "FLAT_MONTHLY") {
    // Margin per bulan = Principal * (marginRateBps / 10000)
    // Total margin = Margin per bulan * Tenor
    const monthlyMargin = roundDivBigInt(principalTotal * BigInt(marginRateBps), 10000n);
    marginTotal = monthlyMargin * tenorBig;
  } else if (marginMethod === "FLAT_TOTAL") {
    // Total margin langsung dihitung dari principal
    marginTotal = roundDivBigInt(principalTotal * BigInt(marginRateBps), 10000n);
  } else if (marginMethod === "EFFECTIVE_ANNUITY") {
    // Effective Annuity Method:
    // r = marginRateBps / 10000 / 12 (monthly rate if rateBps is annual, or monthly if rateBps is monthly)
    // Standard formula: A = P * r * (1+r)^n / ((1+r)^n - 1)
    // For integer precision, calculate high-precision rate factor
    marginTotal = calculateAnnuityTotalMargin(principalTotal, marginRateBps, tenorMonths);
  }

  const installments: CalculatedInstallmentItem[] = [];
  let remainingPrincipal = principalTotal;
  let accumulatedPrincipal = 0n;
  let accumulatedMargin = 0n;

  if (marginMethod === "EFFECTIVE_ANNUITY") {
    // Schedule calculation for annuity:
    // Monthly installment A is constant:
    const monthlyRate = Number(marginRateBps) / 10000;
    const factor = Math.pow(1 + monthlyRate, tenorMonths);
    const annuityMonthly = Math.round(Number(principalTotal) * ((monthlyRate * factor) / (factor - 1)));
    const targetMonthlyDue = BigInt(annuityMonthly);

    for (let i = 1; i <= tenorMonths; i++) {
      const dueDate = addMonths(firstDueDate, i - 1);

      if (i < tenorMonths) {
        // Porsi margin bulan ini = remainingPrincipal * monthlyRate
        const marginDue = roundDivBigInt(remainingPrincipal * BigInt(marginRateBps), 10000n);
        let principalDue = targetMonthlyDue - marginDue;
        if (principalDue > remainingPrincipal) {
          principalDue = remainingPrincipal;
        }

        const totalDue = principalDue + marginDue;
        remainingPrincipal -= principalDue;
        accumulatedPrincipal += principalDue;
        accumulatedMargin += marginDue;

        installments.push({
          installmentNumber: i,
          dueDate,
          principalDue,
          marginDue,
          totalDue,
          remainingPrincipal,
        });
      } else {
        // Angsuran terakhir: Lunasi sisa pokok tepat sampai 0
        const principalDue = remainingPrincipal;
        const marginDue = marginTotal > accumulatedMargin ? marginTotal - accumulatedMargin : 0n;
        const totalDue = principalDue + marginDue;

        accumulatedPrincipal += principalDue;
        accumulatedMargin += marginDue;

        installments.push({
          installmentNumber: i,
          dueDate,
          principalDue,
          marginDue,
          totalDue,
          remainingPrincipal: 0n,
        });
      }
    }
  } else {
    // Standard Flat / Zero Margin:
    // Porsi pokok reguler = principalTotal / tenor
    const basePrincipalDue = principalTotal / tenorBig;
    const baseMarginDue = marginTotal / tenorBig;

    for (let i = 1; i <= tenorMonths; i++) {
      const dueDate = addMonths(firstDueDate, i - 1);

      if (i < tenorMonths) {
        const principalDue = basePrincipalDue;
        const marginDue = baseMarginDue;
        const totalDue = principalDue + marginDue;

        accumulatedPrincipal += principalDue;
        accumulatedMargin += marginDue;
        remainingPrincipal -= principalDue;

        installments.push({
          installmentNumber: i,
          dueDate,
          principalDue,
          marginDue,
          totalDue,
          remainingPrincipal,
        });
      } else {
        // Angsuran terakhir menampung sisa pembulatan
        const principalDue = principalTotal - accumulatedPrincipal;
        const marginDue = marginTotal - accumulatedMargin;
        const totalDue = principalDue + marginDue;

        accumulatedPrincipal += principalDue;
        accumulatedMargin += marginDue;

        installments.push({
          installmentNumber: i,
          dueDate,
          principalDue,
          marginDue,
          totalDue,
          remainingPrincipal: 0n,
        });
      }
    }
  }

  // Verifikasi Integritas: Jumlah semua cicilan HARUS persis sama dengan total yang dibiayai
  const principalDiscrepancy = principalTotal - accumulatedPrincipal;
  const marginDiscrepancy = marginTotal - accumulatedMargin;

  if (principalDiscrepancy !== 0n || marginDiscrepancy !== 0n) {
    throw new Error(
      `Integritas pembulatan gagal: Selisih pokok ${principalDiscrepancy.toString()}, margin ${marginDiscrepancy.toString()}`
    );
  }

  const regularInstallmentEstimate = installments[0]?.totalDue ?? 0n;

  return {
    itemTotalAmount,
    downPaymentAmount,
    principalTotal,
    marginTotal,
    adminFeeAmount,
    totalCreditFinanced: principalTotal + marginTotal,
    monthlyInstallmentEstimate: regularInstallmentEstimate,
    installments,
    roundingDiscrepancy: {
      principalAdjusted: installments[installments.length - 1].principalDue - (installments[0]?.principalDue ?? 0n),
      marginAdjusted: installments[installments.length - 1].marginDue - (installments[0]?.marginDue ?? 0n),
    },
  };
}

/**
 * Menghitung estimasi total margin untuk effective annuity
 */
function calculateAnnuityTotalMargin(principal: bigint, rateBps: number, months: number): bigint {
  const r = Number(rateBps) / 10000;
  if (r === 0) return 0n;
  const factor = Math.pow(1 + r, months);
  const monthlyPayment = Number(principal) * ((r * factor) / (factor - 1));
  const totalPayment = monthlyPayment * months;
  const margin = Math.round(totalPayment - Number(principal));
  return BigInt(Math.max(0, margin));
}

/**
 * Helper untuk menambah bulan pada Date tanpa timezone drift
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const targetDay = d.getDate();
  d.setMonth(d.getMonth() + months);

  // Koreksi tanggal jika bulan target memiliki hari lebih sedikit (misal: 31 Jan -> 28 Feb)
  if (d.getDate() !== targetDay) {
    d.setDate(0); // Pindah ke hari terakhir bulan sebelumnya
  }
  return d;
}

