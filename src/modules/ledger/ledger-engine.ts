import { LedgerAccountCode, CHART_OF_ACCOUNTS } from "./accounts";
import { AppError } from "@/shared/errors";
import { AuditLogger } from "@/modules/audit/audit-logger";

export type LedgerDirection = "DEBIT" | "CREDIT";

export interface LedgerEntryItem {
  accountCode: LedgerAccountCode;
  direction: LedgerDirection;
  amount: bigint;
  contractId?: string;
  notes?: string;
}

export interface ILedgerEntryModel extends LedgerEntryItem {
  id: string;
  batchId: string;
  createdAt: Date;
}

export interface ILedgerBatchModel {
  id: string;
  tenantId: string;
  contractId?: string | null;
  idempotencyKey: string;
  referenceEvent: string; // "CONTRACT_ACTIVATED", "PENALTY_ACCRUED", "INSTALLMENT_PAID", "CORRECTION", "WRITEOFF"
  description: string;
  createdById?: string | null;
  createdAt: Date;
  entries: ILedgerEntryModel[];
}

export class UnbalancedLedgerBatchError extends AppError {
  constructor(debit: bigint, credit: bigint) {
    super(
      `Jurnal tidak seimbang (Unbalanced): Total Debit (${debit.toString()}) != Total Kredit (${credit.toString()})`,
      422,
      "UNBALANCED_LEDGER_BATCH"
    );
  }
}

export interface ILedgerRepository {
  createBatch(
    batch: Omit<ILedgerBatchModel, "id" | "createdAt" | "entries">,
    entries: Omit<ILedgerEntryModel, "id" | "batchId" | "createdAt">[]
  ): Promise<ILedgerBatchModel>;
  findBatchByIdempotencyKey(tenantId: string, key: string): Promise<ILedgerBatchModel | null>;
  listEntriesByAccount(tenantId: string, accountCode: LedgerAccountCode): Promise<ILedgerEntryModel[]>;
  listEntriesByContract(tenantId: string, contractId: string): Promise<ILedgerEntryModel[]>;
  getAllEntries(tenantId: string): Promise<ILedgerEntryModel[]>;
}

export class InMemoryLedgerRepository implements ILedgerRepository {
  public batches: ILedgerBatchModel[] = [];
  public entries: ILedgerEntryModel[] = [];

  async createBatch(
    batch: Omit<ILedgerBatchModel, "id" | "createdAt" | "entries">,
    items: Omit<ILedgerEntryModel, "id" | "batchId" | "createdAt">[]
  ): Promise<ILedgerBatchModel> {
    const batchId = `bat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();

    const createdEntries: ILedgerEntryModel[] = items.map((item, idx) => ({
      ...item,
      id: `ent-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      batchId,
      createdAt: now,
    }));

    const record: ILedgerBatchModel = {
      ...batch,
      id: batchId,
      createdAt: now,
      entries: createdEntries,
    };

    this.batches.push(record);
    this.entries.push(...createdEntries);
    return record;
  }

  async findBatchByIdempotencyKey(tenantId: string, key: string): Promise<ILedgerBatchModel | null> {
    return this.batches.find((b) => b.tenantId === tenantId && b.idempotencyKey === key) || null;
  }

  async listEntriesByAccount(tenantId: string, accountCode: LedgerAccountCode): Promise<ILedgerEntryModel[]> {
    // Cari batch yang sesuai tenant
    const tenantBatchIds = new Set(this.batches.filter((b) => b.tenantId === tenantId).map((b) => b.id));
    return this.entries.filter((e) => tenantBatchIds.has(e.batchId) && e.accountCode === accountCode);
  }

  async listEntriesByContract(tenantId: string, contractId: string): Promise<ILedgerEntryModel[]> {
    const tenantBatchIds = new Set(
      this.batches.filter((b) => b.tenantId === tenantId && b.contractId === contractId).map((b) => b.id)
    );
    return this.entries.filter((e) => tenantBatchIds.has(e.batchId) || e.contractId === contractId);
  }

  async getAllEntries(tenantId: string): Promise<ILedgerEntryModel[]> {
    const tenantBatchIds = new Set(this.batches.filter((b) => b.tenantId === tenantId).map((b) => b.id));
    return this.entries.filter((e) => tenantBatchIds.has(e.batchId));
  }
}

export class LedgerEngine {
  constructor(
    private ledgerRepo: ILedgerRepository,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Inti Mesin Pembukuan: Memposting Batch Jurnal Berpasangan (Append-Only)
   * Aturan: Debit == Kredit, Nilai > 0, Tidak ada UPDATE/DELETE
   */
  async postBatch(params: {
    tenantId: string;
    contractId?: string;
    idempotencyKey: string;
    referenceEvent: string;
    description: string;
    createdById?: string;
    entries: LedgerEntryItem[];
  }): Promise<ILedgerBatchModel> {
    // 1. Cek Idempotensi
    const existing = await this.ledgerRepo.findBatchByIdempotencyKey(
      params.tenantId,
      params.idempotencyKey
    );
    if (existing) {
      return existing; // Mengembalikan batch yang sama tanpa menduplikasi pembukuan
    }

    if (!params.entries || params.entries.length < 2) {
      throw new AppError("Batch jurnal harus memiliki minimal 2 entri (berpasangan)", 422);
    }

    // 2. Hitung total debit dan kredit
    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const entry of params.entries) {
      if (entry.amount <= 0n) {
        throw new AppError("Nominal entri jurnal harus lebih besar dari 0", 422);
      }
      if (entry.direction === "DEBIT") {
        totalDebit += entry.amount;
      } else if (entry.direction === "CREDIT") {
        totalCredit += entry.amount;
      } else {
        throw new AppError("Arah entri jurnal harus DEBIT atau CREDIT", 422);
      }
    }

    // 3. Verifikasi Keseimbangan Mutlak: Debit == Kredit
    if (totalDebit !== totalCredit) {
      throw new UnbalancedLedgerBatchError(totalDebit, totalCredit);
    }

    // 4. Simpan ke database (Append-Only)
    const batch = await this.ledgerRepo.createBatch(
      {
        tenantId: params.tenantId,
        contractId: params.contractId || null,
        idempotencyKey: params.idempotencyKey,
        referenceEvent: params.referenceEvent,
        description: params.description,
        createdById: params.createdById || null,
      },
      params.entries.map((e) => ({
        accountCode: e.accountCode,
        direction: e.direction,
        amount: e.amount,
        contractId: e.contractId || params.contractId,
        notes: e.notes,
      }))
    );

    // 5. Catat Audit Log
    await this.auditLogger.log({
      tenantId: params.tenantId,
      userId: params.createdById,
      action: "POST_LEDGER_BATCH",
      resource: "CreditLedgerBatch",
      resourceId: batch.id,
      payload: {
        referenceEvent: params.referenceEvent,
        totalAmount: totalDebit.toString(),
        contractId: params.contractId,
      },
    });

    return batch;
  }

  /**
   * Menghitung saldo bersih akun tertentu berdasarkan mutasi debit/kredit
   */
  async getAccountBalance(tenantId: string, accountCode: LedgerAccountCode): Promise<bigint> {
    const entries = await this.ledgerRepo.listEntriesByAccount(tenantId, accountCode);
    const def = CHART_OF_ACCOUNTS[accountCode];

    let debitSum = 0n;
    let creditSum = 0n;

    for (const e of entries) {
      if (e.direction === "DEBIT") debitSum += e.amount;
      else if (e.direction === "CREDIT") creditSum += e.amount;
    }

    if (def.normalBalance === "DEBIT") {
      return debitSum - creditSum;
    } else {
      return creditSum - debitSum;
    }
  }

  /**
   * Menghitung sisa saldo piutang pokok kontrak tertentu dari mutasi ledger murni
   */
  async getContractReceivableBalance(tenantId: string, contractId: string): Promise<{
    principalOutstanding: bigint;
    penaltyOutstanding: bigint;
    totalOutstanding: bigint;
  }> {
    const entries = await this.ledgerRepo.listEntriesByContract(tenantId, contractId);

    let principalDebit = 0n;
    let principalCredit = 0n;
    let penaltyDebit = 0n;
    let penaltyCredit = 0n;

    for (const e of entries) {
      if (e.accountCode === "PIUTANG_POKOK") {
        if (e.direction === "DEBIT") principalDebit += e.amount;
        else if (e.direction === "CREDIT") principalCredit += e.amount;
      } else if (e.accountCode === "PIUTANG_DENDA") {
        if (e.direction === "DEBIT") penaltyDebit += e.amount;
        else if (e.direction === "CREDIT") penaltyCredit += e.amount;
      }
    }

    const principalOutstanding = principalDebit - principalCredit;
    const penaltyOutstanding = penaltyDebit - penaltyCredit;

    return {
      principalOutstanding,
      penaltyOutstanding,
      totalOutstanding: principalOutstanding + penaltyOutstanding,
    };
  }

  /**
   * Event 1: Pembukuan Aktivasi Kontrak Kredit Baru
   * - Dr. PIUTANG_POKOK (Pokok pinjaman yang disetujui)
   * - Dr. KAS_BANK (Uang DP + Biaya Admin yang sudah lunas)
   * - Cr. PENDAPATAN_PENJUALAN (Total harga barang)
   * - Cr. PENDAPATAN_ADMIN (Biaya administrasi)
   * - Dr. PIUTANG_POKOK (Tagihan Margin masa depan)
   * - Cr. MARGIN_DITANGGUHKAN (Pendapatan margin belum terealisasi)
   */
  async postContractActivation(params: {
    tenantId: string;
    contractId: string;
    contractNumber: string;
    itemTotalAmount: bigint;
    downPaymentPaid: bigint;
    adminFeePaid: bigint;
    principalTotal: bigint;
    marginTotal: bigint;
    idempotencyKey: string;
    createdById?: string;
  }): Promise<ILedgerBatchModel> {
    const entries: LedgerEntryItem[] = [
      // 1. Catat Piutang Pokok
      {
        accountCode: "PIUTANG_POKOK",
        direction: "DEBIT",
        amount: params.principalTotal,
        notes: `Piutang pokok kontrak ${params.contractNumber}`,
      },
      // 2. Catat Kas Masuk (DP + Admin Fee)
      {
        accountCode: "KAS_BANK",
        direction: "DEBIT",
        amount: params.downPaymentPaid + params.adminFeePaid,
        notes: `Uang muka & admin kontrak ${params.contractNumber}`,
      },
      // 3. Catat Pendapatan Penjualan Furniture
      {
        accountCode: "PENDAPATAN_PENJUALAN",
        direction: "CREDIT",
        amount: params.itemTotalAmount,
        notes: `Penjualan furniture kontrak ${params.contractNumber}`,
      },
      // 4. Catat Pendapatan Biaya Administrasi
      {
        accountCode: "PENDAPATAN_ADMIN",
        direction: "CREDIT",
        amount: params.adminFeePaid,
        notes: `Pendapatan admin kontrak ${params.contractNumber}`,
      },
    ];

    // Jika ada margin kredit, catat Piutang Margin & Margin Ditangguhkan
    if (params.marginTotal > 0n) {
      entries.push({
        accountCode: "PIUTANG_POKOK",
        direction: "DEBIT",
        amount: params.marginTotal,
        notes: `Hak tagih margin kontrak ${params.contractNumber}`,
      });
      entries.push({
        accountCode: "MARGIN_DITANGGUHKAN",
        direction: "CREDIT",
        amount: params.marginTotal,
        notes: `Margin kredit ditangguhkan ${params.contractNumber}`,
      });
    }

    return await this.postBatch({
      tenantId: params.tenantId,
      contractId: params.contractId,
      idempotencyKey: params.idempotencyKey,
      referenceEvent: "CONTRACT_ACTIVATED",
      description: `Aktivasi pembiayaan kredit kontrak ${params.contractNumber}`,
      createdById: params.createdById,
      entries,
    });
  }

  /**
   * Event 2: Pembukuan Akrual Denda Keterlambatan Harian
   * - Dr. PIUTANG_DENDA
   * - Cr. PENDAPATAN_DENDA
   */
  async postPenaltyAccrual(params: {
    tenantId: string;
    contractId: string;
    installmentNumber: number;
    penaltyAmount: bigint;
    idempotencyKey: string;
    createdById?: string;
  }): Promise<ILedgerBatchModel> {
    return await this.postBatch({
      tenantId: params.tenantId,
      contractId: params.contractId,
      idempotencyKey: params.idempotencyKey,
      referenceEvent: "PENALTY_ACCRUED",
      description: `Akrual denda angsuran #${params.installmentNumber}`,
      createdById: params.createdById,
      entries: [
        {
          accountCode: "PIUTANG_DENDA",
          direction: "DEBIT",
          amount: params.penaltyAmount,
          notes: `Tagihan denda angsuran #${params.installmentNumber}`,
        },
        {
          accountCode: "PENDAPATAN_DENDA",
          direction: "CREDIT",
          amount: params.penaltyAmount,
          notes: `Pengakuan pendapatan denda angsuran #${params.installmentNumber}`,
        },
      ],
    });
  }

  /**
   * Event 3: Koreksi / Jurnal Pembalik (Reversal)
   * DILARANG UPDATE/DELETE: Koreksi selalu dilakukan dengan entri pembalik yang mencatat alasan eksplisit.
   */
  async postReversalCorrection(params: {
    tenantId: string;
    contractId?: string;
    originalBatchId: string;
    reason: string;
    idempotencyKey: string;
    createdById: string;
    entriesToReverse: Array<{ accountCode: LedgerAccountCode; direction: LedgerDirection; amount: bigint }>;
  }): Promise<ILedgerBatchModel> {
    // Balikkan arah setiap entri (DEBIT menjadi CREDIT, CREDIT menjadi DEBIT)
    const reversedEntries: LedgerEntryItem[] = params.entriesToReverse.map((e) => ({
      accountCode: e.accountCode,
      direction: e.direction === "DEBIT" ? "CREDIT" : "DEBIT",
      amount: e.amount,
      notes: `Koreksi pembalik untuk batch ${params.originalBatchId}: ${params.reason}`,
    }));

    return await this.postBatch({
      tenantId: params.tenantId,
      contractId: params.contractId,
      idempotencyKey: params.idempotencyKey,
      referenceEvent: "CORRECTION_REVERSAL",
      description: `Jurnal koreksi pembalik batch ${params.originalBatchId} (${params.reason})`,
      createdById: params.createdById,
      entries: reversedEntries,
    });
  }
}

