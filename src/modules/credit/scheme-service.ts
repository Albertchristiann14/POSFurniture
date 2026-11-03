import {
  CreateCreditSchemeInput,
  CreateCreditSchemeSchema,
  SimulationRequestInput,
  SimulationRequestSchema,
} from "./validators";
import { calculateInstallmentSchedule, CalculationResult } from "./calculator";
import { NotFoundError, TenantMismatchError } from "@/shared/errors";
import { AuditLogger } from "@/modules/audit/audit-logger";

export interface ICreditSchemeModel {
  id: string;
  tenantId: string;
  name: string;
  tenorMonths: number;
  marginMethod: "FLAT_MONTHLY" | "FLAT_TOTAL" | "EFFECTIVE_ANNUITY" | "ZERO_MARGIN";
  marginRateBps: number;
  minDownPaymentPct: number;
  adminFeeAmount: bigint;
  penaltyType: "DAILY_PERCENTAGE" | "DAILY_FIXED_AMOUNT" | "ONE_TIME_FIXED";
  penaltyRateBps: number;
  penaltyFixedFee: bigint;
  gracePeriodDays: number;
  maxPenaltyCapPct: number;
  isActive: boolean;
  createdAt: Date;
}

export interface ISchemeRepository {
  create(data: Omit<ICreditSchemeModel, "id" | "createdAt">): Promise<ICreditSchemeModel>;
  findById(tenantId: string, id: string): Promise<ICreditSchemeModel | null>;
  listActive(tenantId: string): Promise<ICreditSchemeModel[]>;
  update(tenantId: string, id: string, data: Partial<ICreditSchemeModel>): Promise<ICreditSchemeModel>;
}

export class InMemorySchemeRepository implements ISchemeRepository {
  public schemes: ICreditSchemeModel[] = [];

  async create(data: Omit<ICreditSchemeModel, "id" | "createdAt">): Promise<ICreditSchemeModel> {
    const scheme: ICreditSchemeModel = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.schemes.push(scheme);
    return scheme;
  }

  async findById(tenantId: string, id: string): Promise<ICreditSchemeModel | null> {
    return this.schemes.find((s) => s.tenantId === tenantId && s.id === id) || null;
  }

  async listActive(tenantId: string): Promise<ICreditSchemeModel[]> {
    return this.schemes.filter((s) => s.tenantId === tenantId && s.isActive);
  }

  async update(tenantId: string, id: string, data: Partial<ICreditSchemeModel>): Promise<ICreditSchemeModel> {
    const idx = this.schemes.findIndex((s) => s.tenantId === tenantId && s.id === id);
    if (idx === -1) throw new NotFoundError("Skema Cicilan", id);
    this.schemes[idx] = { ...this.schemes[idx], ...data };
    return this.schemes[idx];
  }
}

export class CreditSchemeService {
  constructor(
    private schemeRepo: ISchemeRepository,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Membuat skema cicilan baru per tenant
   */
  async createScheme(
    input: CreateCreditSchemeInput,
    tenantId: string,
    userId?: string
  ): Promise<ICreditSchemeModel> {
    const validated = CreateCreditSchemeSchema.parse(input);

    const scheme = await this.schemeRepo.create({
      tenantId,
      name: validated.name,
      tenorMonths: validated.tenorMonths,
      marginMethod: validated.marginMethod,
      marginRateBps: validated.marginRateBps,
      minDownPaymentPct: validated.minDownPaymentPct,
      adminFeeAmount: validated.adminFeeAmount,
      penaltyType: validated.penaltyType,
      penaltyRateBps: validated.penaltyRateBps,
      penaltyFixedFee: validated.penaltyFixedFee,
      gracePeriodDays: validated.gracePeriodDays,
      maxPenaltyCapPct: validated.maxPenaltyCapPct,
      isActive: validated.isActive,
    });

    await this.auditLogger.log({
      tenantId,
      userId,
      action: "CREATE_CREDIT_SCHEME",
      resource: "CreditScheme",
      resourceId: scheme.id,
      payload: {
        name: scheme.name,
        tenorMonths: scheme.tenorMonths,
        marginMethod: scheme.marginMethod,
      },
    });

    return scheme;
  }

  /**
   * Mengambil snapshot parameter skema cicilan untuk dibekukan (freeze) di kontrak.
   * Kontrak yang sudah berjalan akan mengunci snapshot ini dan kebal dari perubahan setting skema di masa depan.
   */
  async getSchemeSnapshotForContract(tenantId: string, schemeId: string): Promise<ICreditSchemeModel> {
    const scheme = await this.schemeRepo.findById(tenantId, schemeId);
    if (!scheme) {
      throw new NotFoundError("Skema Cicilan", schemeId);
    }
    if (scheme.tenantId !== tenantId) {
      throw new TenantMismatchError();
    }
    if (!scheme.isActive) {
      throw new Error("Skema cicilan ini sudah tidak aktif");
    }
    // Return immutable deep copy snapshot
    return JSON.parse(JSON.stringify(scheme, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  }

  /**
   * Menjalankan simulasi cicilan di kasir dan katalog showroom
   */
  async simulateInstallment(
    input: SimulationRequestInput,
    tenantId: string
  ): Promise<CalculationResult> {
    const validated = SimulationRequestSchema.parse(input);

    let marginMethod = validated.marginMethod || "FLAT_MONTHLY";
    let marginRateBps = validated.marginRateBps || 200; // default 2%
    let adminFeeAmount = validated.adminFeeAmount || 50000n;
    let tenorMonths = validated.tenorMonths;

    // Jika skema ID disertakan, ambil parameter dari database skema
    if (validated.schemeId) {
      const scheme = await this.schemeRepo.findById(tenantId, validated.schemeId);
      if (!scheme) {
        throw new NotFoundError("Skema Cicilan", validated.schemeId);
      }
      if (scheme.tenantId !== tenantId) {
        throw new TenantMismatchError();
      }
      marginMethod = scheme.marginMethod;
      marginRateBps = scheme.marginRateBps;
      adminFeeAmount = scheme.adminFeeAmount;
      tenorMonths = validated.tenorMonths || scheme.tenorMonths;

      // Validasi DP minimum berdasarkan skema
      const minRequiredDp = (validated.itemTotalAmount * BigInt(scheme.minDownPaymentPct)) / 100n;
      if (validated.downPaymentAmount < minRequiredDp) {
        throw new Error(
          `Uang muka (DP) minimal untuk skema ${scheme.name} adalah ${scheme.minDownPaymentPct}% (Rp ${minRequiredDp.toString()})`
        );
      }
    }

    // Eksekusi kalkulator bersama yang menjamin konsistensi 100% identik dengan kontrak
    return calculateInstallmentSchedule({
      itemTotalAmount: validated.itemTotalAmount,
      downPaymentAmount: validated.downPaymentAmount,
      tenorMonths,
      marginMethod,
      marginRateBps,
      adminFeeAmount,
    });
  }
}
