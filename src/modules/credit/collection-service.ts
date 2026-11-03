import { AppError, NotFoundError } from "@/shared/errors";
import { AuditLogger } from "@/modules/audit/audit-logger";
import { UserContext } from "./customer-service";

export interface CollectionNote {
  id: string;
  contractId: string;
  installmentId?: string | null;
  officerId: string;
  officerName: string;
  activityType: "PHONE_CALL" | "WHATSAPP" | "HOME_VISIT" | "OFFICE_VISIT";
  notes: string;
  contactResult: "CONTACTED" | "NOT_ANSWERED" | "WRONG_NUMBER" | "PROMISED_TO_PAY" | "REFUSED_TO_PAY";
  promiseToPayDate?: Date | null;
  promisedAmount?: bigint | null;
  createdAt: Date;
}

export interface PromiseToPayRecord {
  id: string;
  contractId: string;
  installmentId?: string | null;
  promisedDate: Date;
  promisedAmount: bigint;
  status: "PENDING" | "KEPT" | "BROKEN";
  notes?: string;
  createdAt: Date;
}

export interface RepossessionRecord {
  id: string;
  contractId: string;
  officialReportNumber: string; // Nomor BAST Penarikan
  repossessionDate: Date;
  officerId: string;
  itemConditionNotes: string;
  estimatedSalvageValue: bigint;
  photoEvidenceUrls: string[];
  createdAt: Date;
}

export interface ICollectionRepository {
  saveNote(note: Omit<CollectionNote, "id" | "createdAt">): Promise<CollectionNote>;
  listNotes(contractId: string): Promise<CollectionNote[]>;
  savePromise(ptp: Omit<PromiseToPayRecord, "id" | "createdAt">): Promise<PromiseToPayRecord>;
  listPromises(contractId: string): Promise<PromiseToPayRecord[]>;
  updatePromise(id: string, data: Partial<PromiseToPayRecord>): Promise<PromiseToPayRecord>;
  saveRepossession(repo: Omit<RepossessionRecord, "id" | "createdAt">): Promise<RepossessionRecord>;
  getRepossession(contractId: string): Promise<RepossessionRecord | null>;
}

export class InMemoryCollectionRepository implements ICollectionRepository {
  public notes: CollectionNote[] = [];
  public promises: PromiseToPayRecord[] = [];
  public repossessions: RepossessionRecord[] = [];

  async saveNote(data: Omit<CollectionNote, "id" | "createdAt">): Promise<CollectionNote> {
    const record: CollectionNote = {
      ...data,
      id: `cn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date(),
    };
    this.notes.push(record);
    return record;
  }

  async listNotes(contractId: string): Promise<CollectionNote[]> {
    return this.notes
      .filter((n) => n.contractId === contractId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async savePromise(data: Omit<PromiseToPayRecord, "id" | "createdAt">): Promise<PromiseToPayRecord> {
    const record: PromiseToPayRecord = {
      ...data,
      id: `ptp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date(),
    };
    this.promises.push(record);
    return record;
  }

  async listPromises(contractId: string): Promise<PromiseToPayRecord[]> {
    return this.promises
      .filter((p) => p.contractId === contractId)
      .sort((a, b) => b.promisedDate.getTime() - a.promisedDate.getTime());
  }

  async updatePromise(id: string, data: Partial<PromiseToPayRecord>): Promise<PromiseToPayRecord> {
    const idx = this.promises.findIndex((p) => p.id === id);
    if (idx === -1) throw new NotFoundError("Janji Bayar", id);
    this.promises[idx] = { ...this.promises[idx], ...data };
    return this.promises[idx];
  }

  async saveRepossession(data: Omit<RepossessionRecord, "id" | "createdAt">): Promise<RepossessionRecord> {
    const record: RepossessionRecord = {
      ...data,
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date(),
    };
    this.repossessions.push(record);
    return record;
  }

  async getRepossession(contractId: string): Promise<RepossessionRecord | null> {
    return this.repossessions.find((r) => r.contractId === contractId) || null;
  }
}

export class CollectionService {
  constructor(
    private collectionRepo: ICollectionRepository,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Mencatat hasil kunjungan / panggilan penagihan
   */
  async recordCollectionActivity(params: {
    tenantId: string;
    contractId: string;
    installmentId?: string;
    activityType: "PHONE_CALL" | "WHATSAPP" | "HOME_VISIT" | "OFFICE_VISIT";
    contactResult: "CONTACTED" | "NOT_ANSWERED" | "WRONG_NUMBER" | "PROMISED_TO_PAY" | "REFUSED_TO_PAY";
    notes: string;
    promiseToPayDate?: Date;
    promisedAmount?: bigint;
    context: UserContext;
  }): Promise<CollectionNote> {
    const note = await this.collectionRepo.saveNote({
      contractId: params.contractId,
      installmentId: params.installmentId,
      officerId: params.context.userId,
      officerName: params.context.userId,
      activityType: params.activityType,
      contactResult: params.contactResult,
      notes: params.notes,
      promiseToPayDate: params.promiseToPayDate,
      promisedAmount: params.promisedAmount,
    });

    // Jika ada janji bayar (PTP), catat ke daftar janji bayar aktif
    if (params.contactResult === "PROMISED_TO_PAY" && params.promiseToPayDate && params.promisedAmount) {
      await this.collectionRepo.savePromise({
        contractId: params.contractId,
        installmentId: params.installmentId,
        promisedDate: params.promiseToPayDate,
        promisedAmount: params.promisedAmount,
        status: "PENDING",
        notes: params.notes,
      });
    }

    await this.auditLogger.log({
      tenantId: params.tenantId,
      userId: params.context.userId,
      action: "RECORD_COLLECTION_NOTE",
      resource: "CollectionNote",
      resourceId: note.id,
      payload: {
        contractId: params.contractId,
        activityType: params.activityType,
        contactResult: params.contactResult,
      },
    });

    return note;
  }

  /**
   * Evaluasi rekomendasi status MACET (Default)
   * Rekomendasi otomatis muncul jika menunggak >= X hari (misal 90 hari), keputusan akhir oleh Owner/Manager
   */
  evaluateDefaultRecommendation(daysOverdue: number, thresholdDays = 90): {
    isRecommendedDefault: boolean;
    reason: string;
  } {
    if (daysOverdue >= thresholdDays) {
      return {
        isRecommendedDefault: true,
        reason: `Nasabah telah menunggak selama ${daysOverdue} hari (melebihi ambang batas ${thresholdDays} hari). Direkomendasikan evaluasi kredit macet.`,
      };
    }
    return {
      isRecommendedDefault: false,
      reason: `Keterlambatan ${daysOverdue} hari masih di bawah ambang batas kredit macet (${thresholdDays} hari).`,
    };
  }

  /**
   * Mencatat Berita Acara Penarikan Barang (Repossession Document)
   */
  async recordRepossession(params: {
    tenantId: string;
    contractId: string;
    itemConditionNotes: string;
    estimatedSalvageValue: bigint;
    photoEvidenceUrls: string[];
    context: UserContext;
  }): Promise<RepossessionRecord> {
    if (params.context.role !== "MANAGER" && params.context.role !== "OWNER") {
      throw new AppError("Penarikan barang wajib disahkan oleh Manager atau Owner", 403);
    }

    const officialReportNumber = `BAST-TARIK-${Date.now().toString().slice(-8)}`;

    const record = await this.collectionRepo.saveRepossession({
      contractId: params.contractId,
      officialReportNumber,
      repossessionDate: new Date(),
      officerId: params.context.userId,
      itemConditionNotes: params.itemConditionNotes,
      estimatedSalvageValue: params.estimatedSalvageValue,
      photoEvidenceUrls: params.photoEvidenceUrls,
    });

    await this.auditLogger.log({
      tenantId: params.tenantId,
      userId: params.context.userId,
      action: "RECORD_REPOSSESSION",
      resource: "RepossessionRecord",
      resourceId: record.id,
      payload: {
        contractId: params.contractId,
        officialReportNumber,
        estimatedSalvageValue: params.estimatedSalvageValue.toString(),
      },
    });

    return record;
  }
}
