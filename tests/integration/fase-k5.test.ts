import { describe, it, expect, beforeEach } from "vitest";
import {
  CollectionService,
  InMemoryCollectionRepository,
} from "@/modules/credit/collection-service";
import { RestructuringService } from "@/modules/credit/restructuring-service";
import { ReportsService } from "@/modules/credit/reports-service";
import { SensitiveActionsService } from "@/modules/credit/sensitive-actions-service";
import {
  LedgerEngine,
  InMemoryLedgerRepository,
} from "@/modules/ledger/ledger-engine";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";
import { UserContext } from "@/modules/credit/customer-service";

describe("Fase K5: Penagihan, Laporan Aging, Restrukturisasi & Aksi Sensitif", () => {
  let collectionRepo: InMemoryCollectionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let auditLogger: AuditLogger;
  let ledgerEngine: LedgerEngine;
  let collectionService: CollectionService;
  let restructuringService: RestructuringService;
  let sensitiveActionsService: SensitiveActionsService;

  // Mock contract & installment repositories
  let contractDb: any[] = [];
  let installmentDb: any[] = [];

  const contractRepoMock = {
    findContractById: async (_tId: string, id: string) => contractDb.find((c) => c.id === id) || null,
    createContract: async (data: any) => {
      const rec = { ...data, id: `ktr-new-${Date.now()}` };
      contractDb.push(rec);
      return rec;
    },
    updateContract: async (id: string, data: any) => {
      const idx = contractDb.findIndex((c) => c.id === id);
      contractDb[idx] = { ...contractDb[idx], ...data };
      return contractDb[idx];
    },
  };

  const installmentRepoMock = {
    installments: installmentDb,
    getInstallments: async (contractId: string) => installmentDb.filter((i) => i.contractId === contractId),
    saveInstallments: async (items: any[]) => {
      const created = items.map((it, idx) => ({ ...it, id: `inst-k5-${Date.now()}-${idx}` }));
      installmentDb.push(...created);
      return created;
    },
  };

  const tenantId = "tenant-k5";

  const ownerContext: UserContext = {
    userId: "owner-01",
    tenantId,
    role: "OWNER",
  };

  const managerContext: UserContext = {
    userId: "manager-01",
    tenantId,
    role: "MANAGER",
  };

  const salesContext: UserContext = {
    userId: "sales-01",
    tenantId,
    role: "SALES",
  };

  beforeEach(() => {
    collectionRepo = new InMemoryCollectionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    ledgerEngine = new LedgerEngine(ledgerRepo, auditLogger);

    contractDb = [];
    installmentDb = [];
    installmentRepoMock.installments = installmentDb;

    collectionService = new CollectionService(collectionRepo, auditLogger);
    restructuringService = new RestructuringService(
      contractRepoMock,
      installmentRepoMock,
      ledgerEngine,
      auditLogger
    );
    sensitiveActionsService = new SensitiveActionsService(
      contractRepoMock,
      installmentRepoMock,
      ledgerEngine,
      auditLogger
    );
  });

  it("1. harus menghasilkan Laporan Umur Piutang (Aging Report) dengan bucket kolektibilitas yang tepat", () => {
    const contracts = [
      { id: "c1", status: "AKTIF" }, // Lancar
      { id: "c2", status: "AKTIF" }, // DPK (1-30)
      { id: "c3", status: "AKTIF" }, // Kurang Lancar (31-60)
      { id: "c4", status: "AKTIF" }, // Diragukan (61-90)
      { id: "c5", status: "MACET" }, // Macet (>90)
    ];

    const today = new Date();
    const daysAgo = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - days);
      return d;
    };

    const installments = [
      // c1: 0 hari (Lancar)
      {
        contractId: "c1",
        dueDate: today,
        principalDue: 1000000n,
        marginDue: 100000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        status: "JATUH_TEMPO",
      },
      // c2: 15 hari (DPK)
      {
        contractId: "c2",
        dueDate: daysAgo(15),
        principalDue: 1000000n,
        marginDue: 100000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 15000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
      // c3: 45 hari (Kurang Lancar)
      {
        contractId: "c3",
        dueDate: daysAgo(45),
        principalDue: 1000000n,
        marginDue: 100000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 45000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
      // c4: 75 hari (Diragukan)
      {
        contractId: "c4",
        dueDate: daysAgo(75),
        principalDue: 1000000n,
        marginDue: 100000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 75000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
      // c5: 120 hari (Macet)
      {
        contractId: "c5",
        dueDate: daysAgo(120),
        principalDue: 2000000n,
        marginDue: 200000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 120000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
    ];

    const report = ReportsService.generateAgingReport({
      tenantId,
      contracts,
      installments,
      asOfDate: today,
    });

    expect(report.totalActiveContracts).toBe(5);
    expect(report.buckets.current.contractCount).toBe(1);
    expect(report.buckets.dpk_1_30.contractCount).toBe(1);
    expect(report.buckets.substandard_31_60.contractCount).toBe(1);
    expect(report.buckets.doubtful_61_90.contractCount).toBe(1);
    expect(report.buckets.bad_over_90.contractCount).toBe(1);

    // Verifikasi total piutang macet > 90 hari: 2jt pokok + 200rb margin + 120rb denda = 2.320.000
    expect(report.buckets.bad_over_90.totalReceivable).toBe(2320000n);

    // Verifikasi format ekspor CSV
    const csv = ReportsService.exportAgingReportToCsv(report);
    expect(csv).toContain("LAPORAN UMUR PIUTANG");
    expect(csv).toContain("Macet (Default / Loss)");
    expect(csv).toContain("2320000");
  });

  it("2. harus mencatat aktivitas penagihan, janji bayar (PTP), dan rekomendasi status macet", async () => {
    const contractId = "c-collection-1";

    // 1. Petugas mencatat kunjungan rumah dengan hasil Janji Bayar (PTP)
    const promisedDate = new Date();
    promisedDate.setDate(promisedDate.getDate() + 3);

    const note = await collectionService.recordCollectionActivity({
      tenantId,
      contractId,
      activityType: "HOME_VISIT",
      contactResult: "PROMISED_TO_PAY",
      notes: "Nasabah ditemui di rumah. Berjanji membayar tanggal 6.",
      promiseToPayDate: promisedDate,
      promisedAmount: 1500000n,
      context: managerContext,
    });

    expect(note.id).toBeDefined();

    // Verifikasi PTP tercatat
    const ptps = await collectionRepo.listPromises(contractId);
    expect(ptps.length).toBe(1);
    expect(ptps[0].status).toBe("PENDING");
    expect(ptps[0].promisedAmount).toBe(1500000n);

    // 2. Evaluasi rekomendasi macet
    const recUnder = collectionService.evaluateDefaultRecommendation(60);
    expect(recUnder.isRecommendedDefault).toBe(false);

    const recOver = collectionService.evaluateDefaultRecommendation(95);
    expect(recOver.isRecommendedDefault).toBe(true);
    expect(recOver.reason).toContain("Direkomendasikan evaluasi kredit macet");
  });

  it("3. harus merestrukturisasi kontrak: membuat versi baru (-R1), menghapus denda, dan mengarsipkan kontrak lama", async () => {
    const origId = "ktr-old-01";
    contractDb.push({
      id: origId,
      tenantId,
      orderId: "ord-old",
      customerId: "cust-01",
      schemeId: "sch-01",
      contractNumber: "KTR-261103-0001",
      status: "AKTIF",
      principalTotal: 5000000n,
      marginTotal: 500000n,
      downPaymentRequired: 0n,
      downPaymentPaid: 0n,
      monthlyInstallment: 550000n,
      schemeSnapshot: { tenorMonths: 6, marginRateBps: 200 },
    });

    installmentDb.push(
      {
        id: "i-old-1",
        contractId: origId,
        installmentNumber: 1,
        dueDate: new Date(),
        principalDue: 2500000n,
        marginDue: 250000n,
        totalDue: 2750000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 100000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      },
      {
        id: "i-old-2",
        contractId: origId,
        installmentNumber: 2,
        dueDate: new Date(),
        principalDue: 2500000n,
        marginDue: 250000n,
        totalDue: 2750000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 100000n,
        penaltyPaid: 0n,
        status: "TERLAMBAT",
      }
    );

    // Restrukturisasi: perpanjang tenor menjadi 12 bulan dan hapus denda 200.000
    const result = await restructuringService.restructureContract(
      {
        originalContractId: origId,
        newTenorMonths: 12,
        waiveAccruedPenalty: true,
        reason: "Relaksasi pandemi & penurunan pendapatan nasabah",
      },
      managerContext
    );

    // 1. Nomor kontrak baru adalah KTR-261103-0001-R1
    expect(result.newContract.contractNumber).toBe("KTR-261103-0001-R1");
    expect(result.newContract.status).toBe("AKTIF");
    expect(result.newInstallmentsCount).toBe(12);

    // 2. Kontrak lama diarsipkan dengan status DIBATALKAN
    const old = contractDb.find((c) => c.id === origId);
    expect(old.status).toBe("DIBATALKAN");
    expect(old.notes).toContain("Telah direstrukturisasi");

    // 3. Jurnal pembalik denda tercatat di ledger
    const waiveBatch = ledgerRepo.batches.find((b) => b.referenceEvent === "PENALTY_WAIVED");
    expect(waiveBatch).toBeDefined();
    expect(waiveBatch?.entries[0].amount).toBe(200000n);
  });

  it("4. Aksi Sensitif: Waive Denda & Write-Off hanya dapat dilakukan oleh role berwenang", async () => {
    const instId = "inst-sensitive-1";
    installmentDb.push({
      id: instId,
      contractId: "c-sens-1",
      installmentNumber: 1,
      dueDate: new Date(),
      principalDue: 1000000n,
      marginDue: 100000n,
      totalDue: 1100000n,
      principalPaid: 0n,
      marginPaid: 0n,
      penaltyAccrued: 50000n, // Denda 50rb
      penaltyPaid: 0n,
      status: "TERLAMBAT",
    });

    contractDb.push({
      id: "c-sens-1",
      tenantId,
      contractNumber: "KTR-SENS-01",
      status: "AKTIF",
      schemeSnapshot: {},
    });

    // 1. Sales mencoba waive denda -> DITOLAK
    await expect(
      sensitiveActionsService.waiveInstallmentPenalty({
        tenantId,
        installmentId: instId,
        amountToWaive: 50000n,
        reason: "Minta tolong",
        context: salesContext,
      })
    ).rejects.toThrow(/hanya dapat disetujui oleh Manager atau Owner/);

    // 2. Manager melakukan waive denda -> BERHASIL
    const waiveRes = await sensitiveActionsService.waiveInstallmentPenalty({
      tenantId,
      installmentId: instId,
      amountToWaive: 50000n,
      reason: "Kebijakan kompensasi komplain keterlambatan barang",
      context: managerContext,
    });
    expect(waiveRes.waivedAmount).toBe(50000n);
    expect(waiveRes.newPenaltyAccrued).toBe(0n);

    // 3. Manager mencoba write-off piutang macet -> DITOLAK (Write-off wajib Owner)
    await expect(
      sensitiveActionsService.writeOffContract({
        tenantId,
        contractId: "c-sens-1",
        reason: "Nasabah kabur",
        context: managerContext,
      })
    ).rejects.toThrow(/HANYA dapat disetujui oleh Owner/);

    // 4. Owner melakukan write-off -> BERHASIL
    const writeOffRes = await sensitiveActionsService.writeOffContract({
      tenantId,
      contractId: "c-sens-1",
      reason: "Nasabah pailit dan tidak memiliki aset",
      context: ownerContext,
    });
    expect(writeOffRes.writtenOffPrincipal).toBe(1000000n);
    expect(writeOffRes.contract.status).toBe("DIBATALKAN");

    // Verifikasi jurnal write-off di ledger (Dr. BEBAN_HAPUS_PIUTANG, Cr. PIUTANG_POKOK)
    const writeOffBatch = ledgerRepo.batches.find((b) => b.referenceEvent === "BAD_DEBT_WRITEOFF");
    expect(writeOffBatch).toBeDefined();
    expect(writeOffBatch?.entries[0].accountCode).toBe("BEBAN_HAPUS_PIUTANG");
  });
});
