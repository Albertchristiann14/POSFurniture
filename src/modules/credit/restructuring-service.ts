import { calculateInstallmentSchedule } from "./calculator";
import { LedgerEngine } from "@/modules/ledger/ledger-engine";
import { AuditLogger } from "@/modules/audit/audit-logger";
import { AppError, NotFoundError } from "@/shared/errors";
import { UserContext } from "./customer-service";

export interface RestructuringProposalInput {
  originalContractId: string;
  newTenorMonths: number;
  waiveAccruedPenalty: boolean;
  waivePenaltyAmount?: bigint;
  newMarginRateBps?: number;
  reason: string;
}

export interface RestructuredContractResult {
  newContract: any;
  waivedPenaltyAmount: bigint;
  newInstallmentsCount: number;
  newMonthlyInstallment: bigint;
}

export class RestructuringService {
  constructor(
    private contractRepo: any,
    private installmentRepo: any,
    private ledgerEngine: LedgerEngine,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Menjalankan Restrukturisasi Kontrak Kredit
   * Prinsip: Kontrak lama tidak dihapus/ditimpa; kontrak baru diterbitkan dengan referensi kontrak lama.
   */
  async restructureContract(
    input: RestructuringProposalInput,
    context: UserContext
  ): Promise<RestructuredContractResult> {
    // 1. Otorisasi: Wajib MANAGER atau OWNER
    if (context.role !== "MANAGER" && context.role !== "OWNER") {
      throw new AppError("Restrukturisasi kredit wajib disetujui oleh Manager atau Owner", 403);
    }

    // 2. Ambil data kontrak lama
    const original = await this.contractRepo.findContractById(context.tenantId, input.originalContractId);
    if (!original) throw new NotFoundError("Kontrak Kredit", input.originalContractId);

    if (original.status !== "AKTIF" && original.status !== "MACET") {
      throw new AppError(
        `Hanya kontrak berstatus AKTIF atau MACET yang dapat direstrukturisasi (status saat ini: ${original.status})`,
        422
      );
    }

    // 3. Ambil sisa jadwal angsuran kontrak lama
    const oldInstallments = await this.installmentRepo.getInstallments(original.id);
    const unpaidOld = oldInstallments.filter((i: any) => i.status !== "LUNAS");

    const totalRemainingPrincipal = unpaidOld.reduce(
      (sum: bigint, i: any) => sum + (BigInt(i.principalDue) - BigInt(i.principalPaid)),
      0n
    );
    const totalAccruedPenalty = unpaidOld.reduce(
      (sum: bigint, i: any) => sum + (BigInt(i.penaltyAccrued) - BigInt(i.penaltyPaid)),
      0n
    );

    if (totalRemainingPrincipal <= 0n) {
      throw new AppError("Kontrak ini tidak memiliki sisa pokok piutang untuk direstrukturisasi", 400);
    }

    // 4. Hitung Penghapusan Denda (Waive Penalty) jika disetujui
    let waivedPenalty = 0n;
    if (input.waiveAccruedPenalty) {
      waivedPenalty = input.waivePenaltyAmount !== undefined ? input.waivePenaltyAmount : totalAccruedPenalty;
      if (waivedPenalty > totalAccruedPenalty) waivedPenalty = totalAccruedPenalty;

      // Bukukan jurnal pembalik denda di ledger jika ada denda yang dihapuskan
      if (waivedPenalty > 0n) {
        await this.ledgerEngine.postBatch({
          tenantId: context.tenantId,
          contractId: original.id,
          idempotencyKey: `waive-restruct-${original.id}-${Date.now()}`,
          referenceEvent: "PENALTY_WAIVED",
          description: `Penghapusan denda restrukturisasi kontrak ${original.contractNumber}`,
          createdById: context.userId,
          entries: [
            {
              accountCode: "PENDAPATAN_DENDA",
              direction: "DEBIT",
              amount: waivedPenalty,
              notes: `Pembalikan pendapatan denda restrukturisasi: ${input.reason}`,
            },
            {
              accountCode: "PIUTANG_DENDA",
              direction: "CREDIT",
              amount: waivedPenalty,
              notes: `Penghapusan piutang denda restrukturisasi: ${input.reason}`,
            },
          ],
        });
      }
    }

    // 5. Hitung Jadwal Cicilan Baru untuk Pokok yang Tersisa
    const marginRateBps = input.newMarginRateBps ?? Number(original.schemeSnapshot.marginRateBps || 200);
    const calculation = calculateInstallmentSchedule({
      itemTotalAmount: totalRemainingPrincipal,
      downPaymentAmount: 0n, // Restrukturisasi tidak ada DP baru
      tenorMonths: input.newTenorMonths,
      marginMethod: "FLAT_MONTHLY",
      marginRateBps,
      adminFeeAmount: 0n,
    });

    // 6. Buat Nomor Kontrak Restrukturisasi Baru (contoh: KTR-261103-0001-R1)
    const revisionCount = (original.contractNumber.match(/-R(\d+)$/) || [])[1];
    const nextRevision = revisionCount ? parseInt(revisionCount, 10) + 1 : 1;
    const baseNumber = original.contractNumber.replace(/-R\d+$/, "");
    const newContractNumber = `${baseNumber}-R${nextRevision}`;

    // 7. Simpan Kontrak Restrukturisasi Baru (Status langsung AKTIF)
    const newContract = await this.contractRepo.createContract({
      tenantId: context.tenantId,
      orderId: original.orderId,
      customerId: original.customerId,
      schemeId: original.schemeId,
      contractNumber: newContractNumber,
      salesId: context.userId,
      status: "AKTIF",
      tenorMonths: input.newTenorMonths,
      principalTotal: calculation.principalTotal,
      marginTotal: calculation.marginTotal,
      adminFeeTotal: 0n,
      downPaymentRequired: 0n,
      downPaymentPaid: 0n,
      monthlyInstallment: calculation.monthlyInstallmentEstimate,
      schemeSnapshot: {
        ...original.schemeSnapshot,
        tenorMonths: input.newTenorMonths,
        marginRateBps,
        restructuredFromContractId: original.id,
        restructureReason: input.reason,
      },
      notes: `Restrukturisasi dari ${original.contractNumber}. Alasan: ${input.reason}`,
      activatedAt: new Date(),
    });

    // 8. Simpan Jadwal Angsuran Baru
    await this.installmentRepo.saveInstallments(
      calculation.installments.map((item) => ({
        contractId: newContract.id,
        installmentNumber: item.installmentNumber,
        dueDate: item.dueDate,
        principalDue: item.principalDue,
        marginDue: item.marginDue,
        totalDue: item.totalDue,
        principalPaid: 0n,
        marginPaid: 0n,
        penaltyAccrued: 0n,
        penaltyPaid: 0n,
        daysOverdue: 0,
        status: "BELUM_JATUH_TEMPO",
      }))
    );

    // 9. Tandai Kontrak Lama Menjadi DIBATALKAN (Alasan: RESTRUCTURED)
    await this.contractRepo.updateContract(original.id, {
      status: "DIBATALKAN",
      notes: `Telah direstrukturisasi menjadi kontrak baru ${newContractNumber}`,
    });

    // 10. Audit Log Lengkap
    await this.auditLogger.log({
      tenantId: context.tenantId,
      userId: context.userId,
      action: "RESTRUCTURE_CREDIT_CONTRACT",
      resource: "CreditContract",
      resourceId: original.id,
      payload: {
        originalContractNumber: original.contractNumber,
        newContractNumber: newContract.contractNumber,
        waivedPenalty: waivedPenalty.toString(),
        newTenorMonths: input.newTenorMonths,
        reason: input.reason,
      },
    });

    return {
      newContract,
      waivedPenaltyAmount: waivedPenalty,
      newInstallmentsCount: calculation.installments.length,
      newMonthlyInstallment: calculation.monthlyInstallmentEstimate,
    };
  }
}
