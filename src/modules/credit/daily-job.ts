import { LedgerEngine } from "@/modules/ledger/ledger-engine";
import { ReminderService } from "@/modules/notifications/reminder-service";
import { AuditLogger } from "@/modules/audit/audit-logger";
import { roundDivBigInt } from "@/shared/math/currency";

export interface InstallmentScheduleItem {
  id: string;
  contractId: string;
  installmentNumber: number;
  dueDate: Date;
  principalDue: bigint;
  marginDue: bigint;
  totalDue: bigint;
  principalPaid: bigint;
  marginPaid: bigint;
  penaltyAccrued: bigint;
  penaltyPaid: bigint;
  daysOverdue: number;
  lastPenaltyCalcDate?: string | null; // format: "YYYY-MM-DD"
  status: "BELUM_JATUH_TEMPO" | "JATUH_TEMPO" | "TERLAMBAT" | "LUNAS_SEBAGIAN" | "LUNAS";
}

export interface ContractWithCustomer {
  id: string;
  tenantId: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  status: string;
  schemeSnapshot: {
    gracePeriodDays?: number;
    penaltyType?: "DAILY_FIXED_AMOUNT" | "DAILY_PERCENTAGE" | "ONE_TIME_FIXED";
    penaltyFixedFee?: string | bigint;
    penaltyRateBps?: number;
    maxPenaltyCapPct?: number;
  };
}

export interface IDailyJobRepository {
  findActiveContracts(tenantId: string): Promise<ContractWithCustomer[]>;
  findUnpaidInstallments(contractId: string): Promise<InstallmentScheduleItem[]>;
  updateInstallment(id: string, data: Partial<InstallmentScheduleItem>): Promise<InstallmentScheduleItem>;
  getCustomerActiveBalance(tenantId: string, customerId: string): Promise<bigint>;
}

export class InMemoryDailyJobRepository implements IDailyJobRepository {
  public contracts: ContractWithCustomer[] = [];
  public installments: InstallmentScheduleItem[] = [];
  public customerBalances = new Map<string, bigint>();

  async findActiveContracts(tenantId: string): Promise<ContractWithCustomer[]> {
    return this.contracts.filter((c) => c.tenantId === tenantId && c.status === "AKTIF");
  }

  async findUnpaidInstallments(contractId: string): Promise<InstallmentScheduleItem[]> {
    return this.installments.filter((i) => i.contractId === contractId && i.status !== "LUNAS");
  }

  async updateInstallment(id: string, data: Partial<InstallmentScheduleItem>): Promise<InstallmentScheduleItem> {
    const idx = this.installments.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error("Installment not found");
    this.installments[idx] = { ...this.installments[idx], ...data };
    return this.installments[idx];
  }

  async getCustomerActiveBalance(_tenantId: string, customerId: string): Promise<bigint> {
    return this.customerBalances.get(customerId) || 0n;
  }
}

export interface DailyJobExecutionResult {
  executionDate: string;
  totalInstallmentsProcessed: number;
  statusUpdatedToDue: number;
  statusUpdatedToLate: number;
  penaltiesAccruedCount: number;
  totalPenaltiesAmount: bigint;
  remindersDispatched: number;
  reconciliationDiscrepancies: Array<{ contractId: string; message: string }>;
}

export class DailyCreditMaintenanceJob {
  constructor(
    private jobRepo: IDailyJobRepository,
    private ledgerEngine: LedgerEngine,
    private reminderService: ReminderService,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Menjalankan Pemeliharaan Harian Kredit secara Idempotent:
   * 1. Evaluasi Status (Jatuh Tempo & Terlambat)
   * 2. Hitung Denda Keterlambatan Harian (Idempotent per hari via YYYY-MM-DD)
   * 3. Kirim Pengingat WhatsApp (H-3, H-0, H+1, H+7)
   * 4. Verifikasi Konsistensi Saldo Buku Besar Ledger
   */
  async execute(tenantId: string, targetDate = new Date()): Promise<DailyJobExecutionResult> {
    const targetDateStr = targetDate.toISOString().slice(0, 10);
    const activeContracts = await this.jobRepo.findActiveContracts(tenantId);

    let statusUpdatedToDue = 0;
    let statusUpdatedToLate = 0;
    let penaltiesAccruedCount = 0;
    let totalPenaltiesAmount = 0n;
    let remindersDispatched = 0;
    let totalProcessed = 0;
    const discrepancies: Array<{ contractId: string; message: string }> = [];

    for (const contract of activeContracts) {
      const installments = await this.jobRepo.findUnpaidInstallments(contract.id);
      const gracePeriod = contract.schemeSnapshot.gracePeriodDays ?? 3;
      const penaltyType = contract.schemeSnapshot.penaltyType ?? "DAILY_FIXED_AMOUNT";
      const penaltyFixedFee = BigInt(contract.schemeSnapshot.penaltyFixedFee ?? "10000");
      const penaltyRateBps = contract.schemeSnapshot.penaltyRateBps ?? 0;
      const maxCapPct = contract.schemeSnapshot.maxPenaltyCapPct ?? 20;

      for (const inst of installments) {
        totalProcessed++;

        // Hitung selisih hari kalender (targetDate - dueDate)
        const dueTime = new Date(inst.dueDate).setHours(0, 0, 0, 0);
        const currTime = new Date(targetDate).setHours(0, 0, 0, 0);
        const diffDays = Math.floor((currTime - dueTime) / (1000 * 60 * 60 * 24));

        // 1. Notifikasi H-3
        if (diffDays === -3) {
          const sent = await this.reminderService.dispatchReminder(inst.id, {
            customerName: contract.customerName,
            phone: contract.customerPhone,
            contractNumber: contract.contractNumber,
            installmentNumber: inst.installmentNumber,
            dueDate: inst.dueDate,
            totalDue: inst.totalDue,
            stage: "H_MINUS_3",
          });
          if (sent) remindersDispatched++;
        }

        // 2. Evaluasi Hari Jatuh Tempo (H-0)
        if (diffDays === 0) {
          if (inst.status === "BELUM_JATUH_TEMPO") {
            await this.jobRepo.updateInstallment(inst.id, { status: "JATUH_TEMPO" });
            statusUpdatedToDue++;
          }
          const sent = await this.reminderService.dispatchReminder(inst.id, {
            customerName: contract.customerName,
            phone: contract.customerPhone,
            contractNumber: contract.contractNumber,
            installmentNumber: inst.installmentNumber,
            dueDate: inst.dueDate,
            totalDue: inst.totalDue,
            stage: "H_ZERO",
          });
          if (sent) remindersDispatched++;
        }

        // 3. Evaluasi Keterlambatan & Denda Harian
        if (diffDays > 0) {
          // Update status ke TERLAMBAT jika melewati grace period
          if (diffDays > gracePeriod && inst.status !== "TERLAMBAT") {
            await this.jobRepo.updateInstallment(inst.id, {
              status: "TERLAMBAT",
              daysOverdue: diffDays,
            });
            statusUpdatedToLate++;
          } else if (diffDays > 0) {
            await this.jobRepo.updateInstallment(inst.id, { daysOverdue: diffDays });
          }

          // Kirim pengingat keterlambatan
          if (diffDays === 1) {
            const sent = await this.reminderService.dispatchReminder(inst.id, {
              customerName: contract.customerName,
              phone: contract.customerPhone,
              contractNumber: contract.contractNumber,
              installmentNumber: inst.installmentNumber,
              dueDate: inst.dueDate,
              totalDue: inst.totalDue,
              stage: "H_PLUS_1",
            });
            if (sent) remindersDispatched++;
          } else if (diffDays === 7) {
            const sent = await this.reminderService.dispatchReminder(inst.id, {
              customerName: contract.customerName,
              phone: contract.customerPhone,
              contractNumber: contract.contractNumber,
              installmentNumber: inst.installmentNumber,
              dueDate: inst.dueDate,
              totalDue: inst.totalDue,
              stage: "H_PLUS_7",
            });
            if (sent) remindersDispatched++;
          }

          // Perhitungan Denda Keterlambatan (HANYA jika melewati grace period)
          if (diffDays > gracePeriod) {
            // ATURAN KRITIS IDEMPOTENCY: Cek apakah denda hari ini sudah dihitung
            if (inst.lastPenaltyCalcDate !== targetDateStr) {
              // Hitung penambahan denda harian
              let penaltyIncrement = 0n;
              if (penaltyType === "DAILY_FIXED_AMOUNT") {
                penaltyIncrement = penaltyFixedFee;
              } else if (penaltyType === "DAILY_PERCENTAGE") {
                penaltyIncrement = roundDivBigInt(inst.totalDue * BigInt(penaltyRateBps), 10000n);
              }

              // Batasan Plafon Denda (Max Penalty Cap)
              const maxPenaltyCap = (inst.totalDue * BigInt(maxCapPct)) / 100n;
              const currentAccrued = inst.penaltyAccrued;

              if (currentAccrued + penaltyIncrement > maxPenaltyCap) {
                penaltyIncrement = maxPenaltyCap > currentAccrued ? maxPenaltyCap - currentAccrued : 0n;
              }

              if (penaltyIncrement > 0n) {
                // Update ke database
                await this.jobRepo.updateInstallment(inst.id, {
                  penaltyAccrued: currentAccrued + penaltyIncrement,
                  lastPenaltyCalcDate: targetDateStr,
                });

                // Bukukan ke Double-Entry Ledger (Dr. PIUTANG_DENDA, Cr. PENDAPATAN_DENDA)
                await this.ledgerEngine.postPenaltyAccrual({
                  tenantId,
                  contractId: contract.id,
                  installmentNumber: inst.installmentNumber,
                  penaltyAmount: penaltyIncrement,
                  idempotencyKey: `penalty:${inst.id}:${targetDateStr}`,
                });

                penaltiesAccruedCount++;
                totalPenaltiesAmount += penaltyIncrement;
              } else {
                // Tandai tanggal sudah dievaluasi walaupun sudah mencapai cap
                await this.jobRepo.updateInstallment(inst.id, {
                  lastPenaltyCalcDate: targetDateStr,
                });
              }
            }
          }
        }
      }

      // 4. Verifikasi Konsistensi Integritas Saldo Ledger per Kontrak
      const ledgerBalances = await this.ledgerEngine.getContractReceivableBalance(tenantId, contract.id);
      // Hitung total sisa pokok dan denda dari tabel cicilan
      const unpaidInsts = await this.jobRepo.findUnpaidInstallments(contract.id);
      const totalUnpaidPrincipal = unpaidInsts.reduce(
        (sum, i) => sum + (i.principalDue - i.principalPaid),
        0n
      );
      const totalUnpaidPenalty = unpaidInsts.reduce(
        (sum, i) => sum + (i.penaltyAccrued - i.penaltyPaid),
        0n
      );

      // Verifikasi denda di ledger == denda di tabel cicilan
      if (ledgerBalances.penaltyOutstanding !== totalUnpaidPenalty) {
        discrepancies.push({
          contractId: contract.id,
          message: `Discrepancy denda: Ledger (${ledgerBalances.penaltyOutstanding.toString()}) != Angsuran (${totalUnpaidPenalty.toString()})`,
        });
      }
    }

    // Catat hasil eksekusi job harian ke Audit Log
    await this.auditLogger.log({
      tenantId,
      action: "DAILY_CREDIT_MAINTENANCE_RUN",
      resource: "DailyCreditMaintenance",
      resourceId: `daily-${targetDateStr}`,
      payload: {
        executionDate: targetDateStr,
        totalProcessed,
        penaltiesAccruedCount,
        totalPenaltiesAmount: totalPenaltiesAmount.toString(),
        remindersDispatched,
      },
    });

    return {
      executionDate: targetDateStr,
      totalInstallmentsProcessed: totalProcessed,
      statusUpdatedToDue: statusUpdatedToDue,
      statusUpdatedToLate: statusUpdatedToLate,
      penaltiesAccruedCount,
      totalPenaltiesAmount,
      remindersDispatched,
      reconciliationDiscrepancies: discrepancies,
    };
  }
}
