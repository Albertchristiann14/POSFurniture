import { formatRupiah } from "@/shared/math/currency";

export interface AgingBucketSummary {
  bucketName: string;
  daysRange: string;
  collectibilityRank: number; // 1 = Lancar, 2 = DPK, 3 = Kurang Lancar, 4 = Diragukan, 5 = Macet
  contractCount: number;
  principalAmount: bigint;
  marginAmount: bigint;
  penaltyAmount: bigint;
  totalReceivable: bigint;
}

export interface CreditAgingReport {
  generatedAt: Date;
  tenantId: string;
  totalActiveContracts: number;
  totalReceivables: bigint;
  totalPrincipal: bigint;
  totalMargin: bigint;
  totalPenalty: bigint;
  nplPercentage: number; // Persentase NPL (Kolektibilitas 5 / Total)
  buckets: {
    current: AgingBucketSummary; // 0 hari
    dpk_1_30: AgingBucketSummary; // 1 - 30 hari
    substandard_31_60: AgingBucketSummary; // 31 - 60 hari
    doubtful_61_90: AgingBucketSummary; // 61 - 90 hari
    bad_over_90: AgingBucketSummary; // > 90 hari
  };
}

export interface MonthlyCashFlowProjection {
  monthYear: string; // "Nov 2026", "Des 2026", dst.
  expectedPrincipal: bigint;
  expectedMargin: bigint;
  expectedTotalInflow: bigint;
  installmentsCount: number;
}

export class ReportsService {
  /**
   * Menghasilkan Laporan Umur Piutang (Aging Report) & Tingkat Kolektibilitas
   */
  static generateAgingReport(params: {
    tenantId: string;
    contracts: Array<{ id: string; status: string }>;
    installments: Array<{
      contractId: string;
      dueDate: Date;
      principalDue: bigint;
      marginDue: bigint;
      principalPaid: bigint;
      marginPaid: bigint;
      penaltyAccrued: bigint;
      penaltyPaid: bigint;
      status: string;
    }>;
    asOfDate?: Date;
  }): CreditAgingReport {
    const { tenantId, contracts, installments, asOfDate = new Date() } = params;

    // Filter hanya kontrak yang aktif atau macet
    const activeContractIds = new Set(
      contracts.filter((c) => c.status === "AKTIF" || c.status === "MACET").map((c) => c.id)
    );

    const relevantInstallments = installments.filter(
      (i) => activeContractIds.has(i.contractId) && i.status !== "LUNAS"
    );

    // Inisialisasi Buckets
    const buckets: Record<string, AgingBucketSummary> = {
      current: {
        bucketName: "Lancar (Current)",
        daysRange: "0 Hari",
        collectibilityRank: 1,
        contractCount: 0,
        principalAmount: 0n,
        marginAmount: 0n,
        penaltyAmount: 0n,
        totalReceivable: 0n,
      },
      dpk_1_30: {
        bucketName: "Dalam Perhatian Khusus (DPK)",
        daysRange: "1 - 30 Hari",
        collectibilityRank: 2,
        contractCount: 0,
        principalAmount: 0n,
        marginAmount: 0n,
        penaltyAmount: 0n,
        totalReceivable: 0n,
      },
      substandard_31_60: {
        bucketName: "Kurang Lancar",
        daysRange: "31 - 60 Hari",
        collectibilityRank: 3,
        contractCount: 0,
        principalAmount: 0n,
        marginAmount: 0n,
        penaltyAmount: 0n,
        totalReceivable: 0n,
      },
      doubtful_61_90: {
        bucketName: "Diragukan",
        daysRange: "61 - 90 Hari",
        collectibilityRank: 4,
        contractCount: 0,
        principalAmount: 0n,
        marginAmount: 0n,
        penaltyAmount: 0n,
        totalReceivable: 0n,
      },
      bad_over_90: {
        bucketName: "Macet (Default / Loss)",
        daysRange: "> 90 Hari",
        collectibilityRank: 5,
        contractCount: 0,
        principalAmount: 0n,
        marginAmount: 0n,
        penaltyAmount: 0n,
        totalReceivable: 0n,
      },
    };

    const contractBuckets = new Map<string, string>();

    const asOfTime = new Date(asOfDate).setHours(0, 0, 0, 0);

    for (const inst of relevantInstallments) {
      const dueTime = new Date(inst.dueDate).setHours(0, 0, 0, 0);
      const diffDays = Math.floor((asOfTime - dueTime) / (1000 * 60 * 60 * 24));

      const unpPrincipal = inst.principalDue > inst.principalPaid ? inst.principalDue - inst.principalPaid : 0n;
      const unpMargin = inst.marginDue > inst.marginPaid ? inst.marginDue - inst.marginPaid : 0n;
      const unpPenalty = inst.penaltyAccrued > inst.penaltyPaid ? inst.penaltyAccrued - inst.penaltyPaid : 0n;

      let key = "current";
      if (diffDays <= 0) key = "current";
      else if (diffDays <= 30) key = "dpk_1_30";
      else if (diffDays <= 60) key = "substandard_31_60";
      else if (diffDays <= 90) key = "doubtful_61_90";
      else key = "bad_over_90";

      const b = buckets[key];
      b.principalAmount += unpPrincipal;
      b.marginAmount += unpMargin;
      b.penaltyAmount += unpPenalty;
      b.totalReceivable += unpPrincipal + unpMargin + unpPenalty;

      // Track terburuk per kontrak
      const prevKey = contractBuckets.get(inst.contractId);
      if (!prevKey || buckets[key].collectibilityRank > buckets[prevKey].collectibilityRank) {
        contractBuckets.set(inst.contractId, key);
      }
    }

    // Hitung contract count per bucket
    for (const [, bucketKey] of contractBuckets) {
      buckets[bucketKey].contractCount++;
    }

    let totalPrincipal = 0n;
    let totalMargin = 0n;
    let totalPenalty = 0n;
    let totalReceivables = 0n;

    for (const b of Object.values(buckets)) {
      totalPrincipal += b.principalAmount;
      totalMargin += b.marginAmount;
      totalPenalty += b.penaltyAmount;
      totalReceivables += b.totalReceivable;
    }

    // NPL % = (Total Macet / Total Piutang) * 100
    const nplPercentage =
      totalReceivables > 0n
        ? Math.round(Number((buckets.bad_over_90.totalReceivable * 10000n) / totalReceivables)) / 100
        : 0;

    return {
      generatedAt: asOfDate,
      tenantId,
      totalActiveContracts: activeContractIds.size,
      totalReceivables,
      totalPrincipal,
      totalMargin,
      totalPenalty,
      nplPercentage,
      buckets: {
        current: buckets.current,
        dpk_1_30: buckets.dpk_1_30,
        substandard_31_60: buckets.substandard_31_60,
        doubtful_61_90: buckets.doubtful_61_90,
        bad_over_90: buckets.bad_over_90,
      },
    };
  }

  /**
   * Menghasilkan Proyeksi Arus Kas Masuk Cicilan Bulanan ke Depan
   */
  static generateCashFlowProjection(
    installments: Array<{
      dueDate: Date;
      principalDue: bigint;
      marginDue: bigint;
      principalPaid: bigint;
      marginPaid: bigint;
      status: string;
    }>
  ): MonthlyCashFlowProjection[] {
    const monthlyMap = new Map<
      string,
      { principal: bigint; margin: bigint; total: bigint; count: number }
    >();

    const unpaid = installments.filter((i) => i.status !== "LUNAS");

    for (const inst of unpaid) {
      const d = new Date(inst.dueDate);
      const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;

      const remPrincipal = inst.principalDue > inst.principalPaid ? inst.principalDue - inst.principalPaid : 0n;
      const remMargin = inst.marginDue > inst.marginPaid ? inst.marginDue - inst.marginPaid : 0n;

      const existing = monthlyMap.get(key) || { principal: 0n, margin: 0n, total: 0n, count: 0 };
      existing.principal += remPrincipal;
      existing.margin += remMargin;
      existing.total += remPrincipal + remMargin;
      existing.count++;
      monthlyMap.set(key, existing);
    }

    return Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, data]) => ({
        monthYear: key,
        expectedPrincipal: data.principal,
        expectedMargin: data.margin,
        expectedTotalInflow: data.total,
        installmentsCount: data.count,
      }));
  }

  /**
   * Mengekspor Laporan Aging ke format CSV
   */
  static exportAgingReportToCsv(report: CreditAgingReport): string {
    const rows = [
      ["LAPORAN UMUR PIUTANG & KOLEKTIBILITAS KREDIT FURNITURE"],
      [`Tanggal Laporan: ${report.generatedAt.toISOString().slice(0, 10)}`],
      [`Rasio NPL: ${report.nplPercentage}%`],
      [],
      ["Kategori Kolektibilitas", "Rentang Hari", "Jumlah Kontrak", "Pokok (Rp)", "Margin (Rp)", "Denda (Rp)", "Total Piutang (Rp)"],
    ];

    for (const b of Object.values(report.buckets)) {
      rows.push([
        b.bucketName,
        b.daysRange,
        b.contractCount.toString(),
        b.principalAmount.toString(),
        b.marginAmount.toString(),
        b.penaltyAmount.toString(),
        b.totalReceivable.toString(),
      ]);
    }

    rows.push([]);
    rows.push([
      "TOTAL",
      "-",
      report.totalActiveContracts.toString(),
      report.totalPrincipal.toString(),
      report.totalMargin.toString(),
      report.totalPenalty.toString(),
      report.totalReceivables.toString(),
    ]);

    return rows.map((r) => r.join(",")).join("\n");
  }
}

