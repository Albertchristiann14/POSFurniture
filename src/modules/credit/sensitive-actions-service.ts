import { LedgerEngine } from "@/modules/ledger/ledger-engine";
import { AuditLogger } from "@/modules/audit/audit-logger";
import { AppError, NotFoundError } from "@/shared/errors";
import { UserContext } from "./customer-service";

export class SensitiveActionsService {
  constructor(
    private contractRepo: any,
    private installmentRepo: any,
    private ledgerEngine: LedgerEngine,
    private auditLogger: AuditLogger
  ) {}

  /**
   * 1. Penghapusan / Keringanan Denda (Waive Penalty)
   * Wajib persetujuan Manager atau Owner
   */
  async waiveInstallmentPenalty(params: {
    tenantId: string;
    installmentId: string;
    amountToWaive: bigint;
    reason: string;
    context: UserContext;
  }): Promise<{ newPenaltyAccrued: bigint; waivedAmount: bigint }> {
    if (params.context.role !== "MANAGER" && params.context.role !== "OWNER") {
      throw new AppError("Penghapusan denda hanya dapat disetujui oleh Manager atau Owner", 403);
    }

    if (params.amountToWaive <= 0n) {
      throw new AppError("Nominal denda yang dihapuskan harus lebih besar dari 0", 400);
    }

    const installments = await this.installmentRepo.installments;
    const inst = installments.find((i: any) => i.id === params.installmentId);
    if (!inst) throw new NotFoundError("Angsuran", params.installmentId);

    const penaltyAccruedBig = BigInt(inst.penaltyAccrued);
    const penaltyPaidBig = BigInt(inst.penaltyPaid);
    const unpaidPenalty = penaltyAccruedBig > penaltyPaidBig ? penaltyAccruedBig - penaltyPaidBig : 0n;
    if (unpaidPenalty <= 0n) {
      throw new AppError("Angsuran ini tidak memiliki denda terhutang untuk dihapuskan", 400);
    }

    const actualWaive = params.amountToWaive > unpaidPenalty ? unpaidPenalty : params.amountToWaive;
    const newPenalty = penaltyAccruedBig - actualWaive;

    // 1. Update ke jadwal angsuran
    inst.penaltyAccrued = newPenalty;

    // 2. Bukukan Jurnal Pembalik di Double-Entry Ledger
    await this.ledgerEngine.postBatch({
      tenantId: params.tenantId,
      contractId: inst.contractId,
      idempotencyKey: `waive-penalty-${inst.id}-${Date.now()}`,
      referenceEvent: "WAIVE_PENALTY",
      description: `Penghapusan denda angsuran #${inst.installmentNumber}: ${params.reason}`,
      createdById: params.context.userId,
      entries: [
        {
          accountCode: "PENDAPATAN_DENDA",
          direction: "DEBIT",
          amount: actualWaive,
          notes: `Pembalikan pendapatan denda: ${params.reason}`,
        },
        {
          accountCode: "PIUTANG_DENDA",
          direction: "CREDIT",
          amount: actualWaive,
          notes: `Penghapusan piutang denda: ${params.reason}`,
        },
      ],
    });

    // 3. Catat Audit Log Sensitif
    await this.auditLogger.log({
      tenantId: params.tenantId,
      userId: params.context.userId,
      action: "WAIVE_PENALTY",
      resource: "CreditInstallmentSchedule",
      resourceId: inst.id,
      payload: {
        contractId: inst.contractId,
        installmentNumber: inst.installmentNumber,
        waivedAmount: actualWaive.toString(),
        reason: params.reason,
      },
    });

    return {
      newPenaltyAccrued: newPenalty,
      waivedAmount: actualWaive,
    };
  }

  /**
   * 2. Penghapusan Buku Piutang Macet (Write-Off Bad Debt)
   * Wajib persetujuan OWNER
   */
  async writeOffContract(params: {
    tenantId: string;
    contractId: string;
    reason: string;
    context: UserContext;
  }): Promise<{ writtenOffPrincipal: bigint; contract: any }> {
    // Write-off adalah tindakan berisiko tinggi: HANYA OWNER
    if (params.context.role !== "OWNER") {
      throw new AppError("Penghapusan buku piutang macet (Write-off) HANYA dapat disetujui oleh Owner", 403);
    }

    const contract = await this.contractRepo.findContractById(params.tenantId, params.contractId);
    if (!contract) throw new NotFoundError("Kontrak Kredit", params.contractId);

    const installments = await this.installmentRepo.getInstallments(contract.id);
    const unpaid = installments.filter((i: any) => i.status !== "LUNAS");

    const totalRemainingPrincipal = unpaid.reduce(
      (sum: bigint, i: any) => sum + (BigInt(i.principalDue) - BigInt(i.principalPaid)),
      0n
    );
    const totalRemainingMargin = unpaid.reduce(
      (sum: bigint, i: any) => sum + (BigInt(i.marginDue) - BigInt(i.marginPaid)),
      0n
    );
    const totalRemainingPenalty = unpaid.reduce(
      (sum: bigint, i: any) => sum + (BigInt(i.penaltyAccrued) - BigInt(i.penaltyPaid)),
      0n
    );

    // Jurnal Pembukuan Write-Off:
    // Dr. BEBAN_HAPUS_PIUTANG (totalRemainingPrincipal)
    // Cr. PIUTANG_POKOK (totalRemainingPrincipal)
    // Pembalikan margin tangguhan yang tidak akan tertagih:
    // Dr. MARGIN_DITANGGUHKAN (totalRemainingMargin)
    // Cr. PIUTANG_POKOK (totalRemainingMargin)
    const entries: any[] = [
      {
        accountCode: "BEBAN_HAPUS_PIUTANG",
        direction: "DEBIT",
        amount: totalRemainingPrincipal,
        notes: `Beban piutang macet kontrak ${contract.contractNumber}`,
      },
      {
        accountCode: "PIUTANG_POKOK",
        direction: "CREDIT",
        amount: totalRemainingPrincipal,
        notes: `Write-off pokok kontrak ${contract.contractNumber}`,
      },
    ];

    if (totalRemainingMargin > 0n) {
      entries.push({
        accountCode: "MARGIN_DITANGGUHKAN",
        direction: "DEBIT",
        amount: totalRemainingMargin,
        notes: `Pembalikan margin tangguhan write-off ${contract.contractNumber}`,
      });
      entries.push({
        accountCode: "PIUTANG_POKOK",
        direction: "CREDIT",
        amount: totalRemainingMargin,
        notes: `Penghapusan piutang margin write-off ${contract.contractNumber}`,
      });
    }

    if (totalRemainingPenalty > 0n) {
      entries.push({
        accountCode: "PENDAPATAN_DENDA",
        direction: "DEBIT",
        amount: totalRemainingPenalty,
        notes: `Pembalikan denda write-off ${contract.contractNumber}`,
      });
      entries.push({
        accountCode: "PIUTANG_DENDA",
        direction: "CREDIT",
        amount: totalRemainingPenalty,
        notes: `Penghapusan denda write-off ${contract.contractNumber}`,
      });
    }

    await this.ledgerEngine.postBatch({
      tenantId: params.tenantId,
      contractId: contract.id,
      idempotencyKey: `writeoff-${contract.id}-${Date.now()}`,
      referenceEvent: "BAD_DEBT_WRITEOFF",
      description: `Penghapusan piutang macet kontrak ${contract.contractNumber}: ${params.reason}`,
      createdById: params.context.userId,
      entries,
    });

    // Update status kontrak menjadi DIBATALKAN (Alasan: WRITEOFF)
    const updated = await this.contractRepo.updateContract(contract.id, {
      status: "DIBATALKAN",
      notes: `WRITEOFF: ${params.reason}`,
    });

    await this.auditLogger.log({
      tenantId: params.tenantId,
      userId: params.context.userId,
      action: "WRITE_OFF_CONTRACT",
      resource: "CreditContract",
      resourceId: contract.id,
      payload: {
        writtenOffPrincipal: totalRemainingPrincipal.toString(),
        reason: params.reason,
      },
    });

    return {
      writtenOffPrincipal: totalRemainingPrincipal,
      contract: updated,
    };
  }
}
