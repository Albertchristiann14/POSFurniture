import { describe, it, expect, beforeEach } from "vitest";
import {
  LedgerEngine,
  InMemoryLedgerRepository,
} from "@/modules/ledger/ledger-engine";
import {
  DailyCreditMaintenanceJob,
  InMemoryDailyJobRepository,
} from "@/modules/credit/daily-job";
import {
  ReminderService,
  MockNotificationGateway,
} from "@/modules/notifications/reminder-service";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Fase K3: Ledger Double-Entry, Jadwal Cicilan & Job Harian Idempotent", () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let jobRepo: InMemoryDailyJobRepository;
  let auditLogger: AuditLogger;
  let ledgerEngine: LedgerEngine;
  let reminderGateway: MockNotificationGateway;
  let reminderService: ReminderService;
  let dailyJob: DailyCreditMaintenanceJob;

  const tenantId = "tenant-furniture-k3";

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    jobRepo = new InMemoryDailyJobRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    ledgerEngine = new LedgerEngine(ledgerRepo, auditLogger);
    reminderGateway = new MockNotificationGateway();
    reminderService = new ReminderService(reminderGateway);
    dailyJob = new DailyCreditMaintenanceJob(
      jobRepo,
      ledgerEngine,
      reminderService,
      auditLogger
    );
  });

  it("1. harus membukukan aktivasi kontrak ke dalam Double-Entry Ledger (Debit == Kredit)", async () => {
    const contractId = "ktr-k3-001";
    const batch = await ledgerEngine.postContractActivation({
      tenantId,
      contractId,
      contractNumber: "KTR-261103-0001",
      itemTotalAmount: 20000000n, // Total furniture 20jt
      downPaymentPaid: 4000000n, // DP 4jt
      adminFeePaid: 100000n, // Admin 100rb
      principalTotal: 16000000n, // Pokok hutang 16jt
      marginTotal: 3840000n, // Margin 12 bulan @ 2% = 3.84jt
      idempotencyKey: "act-k3-001",
    });

    expect(batch.entries.length).toBe(6);

    // Hitung total debit dan kredit pada batch aktivasi
    const totalDebit = batch.entries
      .filter((e) => e.direction === "DEBIT")
      .reduce((sum, e) => sum + e.amount, 0n);
    const totalCredit = batch.entries
      .filter((e) => e.direction === "CREDIT")
      .reduce((sum, e) => sum + e.amount, 0n);

    expect(totalDebit).toBe(totalCredit);
    // Total = Pokok (16jt) + Kas DP & Admin (4.1jt) + Margin (3.84jt) = 23.940.000
    expect(totalDebit).toBe(23940000n);
  });

  it("2. Job Harian: harus mengubah status jatuh tempo & terlambat, dan menghitung denda harian setelah masa tenggang", async () => {
    const contractId = "ktr-k3-002";

    // Setup Kontrak Aktif dengan 3 angsuran berbeda status
    jobRepo.contracts.push({
      id: contractId,
      tenantId,
      contractNumber: "KTR-261103-0002",
      customerId: "cust-01",
      customerName: "Bambang Wijaya",
      customerPhone: "081234567890",
      status: "AKTIF",
      schemeSnapshot: {
        gracePeriodDays: 3, // Toleransi 3 hari
        penaltyType: "DAILY_FIXED_AMOUNT",
        penaltyFixedFee: 15000n, // Denda Rp 15.000 / hari
        maxPenaltyCapPct: 20,
      },
    });

    // Angsuran 1: Jatuh tempo HARI INI
    const today = new Date();
    // Angsuran 2: Telat 5 hari (melewati grace period 3 hari)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    // Angsuran 3: Masih 3 hari lagi (H-3)
    const threeDaysLater = new Date();
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    jobRepo.installments.push(
      {
        id: "sch-today",
        contractId,
        installmentNumber: 1,
        dueDate: today,
        principalDue: 1500000n,
        marginDue: 200000n,
        totalDue: 1700000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        daysOverdue: 0,
        status: "BELUM_JATUH_TEMPO",
      },
      {
        id: "sch-late",
        contractId,
        installmentNumber: 2,
        dueDate: fiveDaysAgo,
        principalDue: 1500000n,
        marginDue: 200000n,
        totalDue: 1700000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        daysOverdue: 5,
        status: "JATUH_TEMPO",
      },
      {
        id: "sch-h-minus-3",
        contractId,
        installmentNumber: 3,
        dueDate: threeDaysLater,
        principalDue: 1500000n,
        marginDue: 200000n,
        totalDue: 1700000n,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        daysOverdue: 0,
        status: "BELUM_JATUH_TEMPO",
      }
    );

    // Jalankan Job Harian
    const result = await dailyJob.execute(tenantId, today);

    // 1. Angsuran hari ini berubah menjadi JATUH_TEMPO
    const instToday = jobRepo.installments.find((i) => i.id === "sch-today");
    expect(instToday?.status).toBe("JATUH_TEMPO");

    // 2. Angsuran telat 5 hari berubah menjadi TERLAMBAT dan dikenakan denda Rp 15.000
    const instLate = jobRepo.installments.find((i) => i.id === "sch-late");
    expect(instLate?.status).toBe("TERLAMBAT");
    expect(instLate?.penaltyAccrued).toBe(15000n);
    expect(instLate?.lastPenaltyCalcDate).toBe(today.toISOString().slice(0, 10));

    // 3. Verifikasi denda dibukukan ke Ledger (Dr. PIUTANG_DENDA, Cr. PENDAPATAN_DENDA)
    const dendaBalance = await ledgerEngine.getAccountBalance(tenantId, "PIUTANG_DENDA");
    expect(dendaBalance).toBe(15000n);

    // 4. Verifikasi pengingat WA terkirim (H-0 untuk hari ini, H-3 untuk 3 hari lagi)
    expect(reminderGateway.sentMessages.length).toBe(2);
    expect(result.remindersDispatched).toBe(2);
  });

  it("3. IDEMPOTENCY WAJIB: Menjalankan Job Harian dua kali pada hari yang sama TIDAK BOLEH menggandakan denda", async () => {
    const contractId = "ktr-k3-003";
    const today = new Date();
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4); // Lewat grace period 3 hari

    jobRepo.contracts.push({
      id: contractId,
      tenantId,
      contractNumber: "KTR-261103-0003",
      customerId: "cust-02",
      customerName: "Siti Aminah",
      customerPhone: "081299998888",
      status: "AKTIF",
      schemeSnapshot: {
        gracePeriodDays: 3,
        penaltyType: "DAILY_FIXED_AMOUNT",
        penaltyFixedFee: 20000n, // Denda Rp 20.000 / hari
        maxPenaltyCapPct: 20,
      },
    });

    jobRepo.installments.push({
      id: "sch-overdue-idemp",
      contractId,
      installmentNumber: 1,
      dueDate: fourDaysAgo,
      principalDue: 2000000n,
      marginDue: 250000n,
      totalDue: 2250000n,
      principalPaid: 0n,
      marginPaid: 0n,
      penaltyAccrued: 0n,
      penaltyPaid: 0n,
      daysOverdue: 4,
      status: "JATUH_TEMPO",
    });

    // Run 1: Eksekusi pagi hari
    const run1 = await dailyJob.execute(tenantId, today);
    expect(run1.penaltiesAccruedCount).toBe(1);
    expect(run1.totalPenaltiesAmount).toBe(20000n);

    const instAfterRun1 = jobRepo.installments[0];
    expect(instAfterRun1.penaltyAccrued).toBe(20000n);

    // Run 2: Eksekusi siang/malam pada hari yang sama (misal server restart atau cron ter-trigger ulang)
    const run2 = await dailyJob.execute(tenantId, today);

    // Tidak ada penambahan denda ganda!
    expect(run2.penaltiesAccruedCount).toBe(0);
    expect(run2.totalPenaltiesAmount).toBe(0n);

    const instAfterRun2 = jobRepo.installments[0];
    // Denda TETAP Rp 20.000, BUKAN Rp 40.000
    expect(instAfterRun2.penaltyAccrued).toBe(20000n);

    // Saldo ledger denda juga tetap Rp 20.000
    const dendaBalance = await ledgerEngine.getAccountBalance(tenantId, "PIUTANG_DENDA");
    expect(dendaBalance).toBe(20000n);
  });

  it("4. harus membatasi akumulasi denda sesuai Plafon Maksimal (Penalty Cap)", async () => {
    const contractId = "ktr-k3-004";
    const today = new Date();
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    jobRepo.contracts.push({
      id: contractId,
      tenantId,
      contractNumber: "KTR-261103-0004",
      customerId: "cust-03",
      customerName: "Hendra Gunawan",
      customerPhone: "081255554444",
      status: "AKTIF",
      schemeSnapshot: {
        gracePeriodDays: 1,
        penaltyType: "DAILY_FIXED_AMOUNT",
        penaltyFixedFee: 50000n, // Denda 50rb / hari
        maxPenaltyCapPct: 10, // Maksimal 10% dari total angsuran (10% dari 500rb = 50.000)
      },
    });

    jobRepo.installments.push({
      id: "sch-cap-test",
      contractId,
      installmentNumber: 1,
      dueDate: tenDaysAgo,
      principalDue: 450000n,
      marginDue: 50000n,
      totalDue: 500000n, // Cap 10% = 50.000
      principalPaid: 0n,
      marginPaid: 0n,
      penaltyAccrued: 40000n, // Sudah terakumulasi 40.000
      penaltyPaid: 0n,
      daysOverdue: 10,
      status: "TERLAMBAT",
      lastPenaltyCalcDate: "2026-11-02", // Kemarin
    });

    // Jalankan job untuk hari ini: denda 50.000 seharusnya dipotong menjadi hanya 10.000 agar mencapai batas cap 50.000
    await dailyJob.execute(tenantId, today);

    const inst = jobRepo.installments[0];
    expect(inst.penaltyAccrued).toBe(50000n); // Cap maksimal tercapai
  });
});
