import {
  CreditContractStatus,
  CreditContractStateMachine,
} from "./fsm";
import { calculateInstallmentSchedule, CalculatedInstallmentItem } from "./calculator";
import { generateContractNumber } from "./contract-number";
import { generateContractDocument } from "./pdf-generator";
import { CreditCustomerService, UserContext } from "./customer-service";
import { CreditSchemeService, ICreditSchemeModel } from "./scheme-service";
import { PaymentService, IPaymentModel } from "@/modules/payment/payment-service";
import { AuditLogger } from "@/modules/audit/audit-logger";
import { AppError, NotFoundError, TenantMismatchError } from "@/shared/errors";

export interface FurnitureOrderItemInput {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPrice: bigint;
  unitCost?: bigint;
  quantity: number;
  customSpecs?: string | null;
  isIndentOrder?: boolean;
}

export interface CreateCreditApplicationInput {
  customerId: string;
  schemeId: string;
  orderItems: FurnitureOrderItemInput[];
  downPaymentOffered: bigint;
  tenorMonths: number;
  notes?: string;
}

export interface ICreditContractModel {
  id: string;
  tenantId: string;
  orderId: string;
  customerId: string;
  schemeId: string;
  contractNumber: string;
  salesId: string;
  approvedById?: string | null;
  status: CreditContractStatus;
  tenorMonths: number;
  principalTotal: bigint;
  marginTotal: bigint;
  adminFeeTotal: bigint;
  downPaymentRequired: bigint;
  downPaymentPaid: bigint;
  monthlyInstallment: bigint;
  schemeSnapshot: Record<string, unknown>;
  contractPdfHash?: string | null;
  contractPdfUrl?: string | null;
  signedByCustomerAt?: Date | null;
  approvedAt?: Date | null;
  activatedAt?: Date | null;
  completedAt?: Date | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInstallmentScheduleModel {
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
  status: "BELUM_JATUH_TEMPO" | "JATUH_TEMPO" | "TERLAMBAT" | "LUNAS_SEBAGIAN" | "LUNAS";
  paidAt?: Date | null;
}

export interface IStockReservationModel {
  id: string;
  variantId: string;
  quantityReserved: number;
  reason: string;
  referenceId: string;
  createdAt: Date;
}

export interface IApplicationRepository {
  createContract(contract: Omit<ICreditContractModel, "id" | "createdAt" | "updatedAt">): Promise<ICreditContractModel>;
  findContractById(tenantId: string, id: string): Promise<ICreditContractModel | null>;
  findContractByOrderId(tenantId: string, orderId: string): Promise<ICreditContractModel | null>;
  updateContract(id: string, data: Partial<ICreditContractModel>): Promise<ICreditContractModel>;
  saveInstallments(installments: Omit<IInstallmentScheduleModel, "id">[]): Promise<IInstallmentScheduleModel[]>;
  getInstallments(contractId: string): Promise<IInstallmentScheduleModel[]>;
  reserveStock(variantId: string, quantity: number, referenceId: string): Promise<IStockReservationModel>;
}

export class InMemoryApplicationRepository implements IApplicationRepository {
  public contracts: ICreditContractModel[] = [];
  public installments: IInstallmentScheduleModel[] = [];
  public stockReservations: IStockReservationModel[] = [];

  async createContract(data: Omit<ICreditContractModel, "id" | "createdAt" | "updatedAt">): Promise<ICreditContractModel> {
    const record: ICreditContractModel = {
      ...data,
      id: `ktr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.contracts.push(record);
    return record;
  }

  async findContractById(tenantId: string, id: string): Promise<ICreditContractModel | null> {
    return this.contracts.find((c) => c.tenantId === tenantId && c.id === id) || null;
  }

  async findContractByOrderId(tenantId: string, orderId: string): Promise<ICreditContractModel | null> {
    return this.contracts.find((c) => c.tenantId === tenantId && c.orderId === orderId) || null;
  }

  async updateContract(id: string, data: Partial<ICreditContractModel>): Promise<ICreditContractModel> {
    const idx = this.contracts.findIndex((c) => c.id === id);
    if (idx === -1) throw new NotFoundError("Kontrak Kredit", id);
    this.contracts[idx] = { ...this.contracts[idx], ...data, updatedAt: new Date() };
    return this.contracts[idx];
  }

  async saveInstallments(items: Omit<IInstallmentScheduleModel, "id">[]): Promise<IInstallmentScheduleModel[]> {
    const created: IInstallmentScheduleModel[] = items.map((item, idx) => ({
      ...item,
      id: `sch-${Date.now()}-${idx}`,
    }));
    this.installments.push(...created);
    return created;
  }

  async getInstallments(contractId: string): Promise<IInstallmentScheduleModel[]> {
    return this.installments.filter((i) => i.contractId === contractId);
  }

  async reserveStock(variantId: string, quantity: number, referenceId: string): Promise<IStockReservationModel> {
    const record: IStockReservationModel = {
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      variantId,
      quantityReserved: quantity,
      reason: "CREDIT_CONTRACT_ACTIVATION",
      referenceId,
      createdAt: new Date(),
    };
    this.stockReservations.push(record);
    return record;
  }
}

export class CreditApplicationService {
  constructor(
    private appRepo: IApplicationRepository,
    private customerService: CreditCustomerService,
    private schemeService: CreditSchemeService,
    private paymentService: PaymentService,
    private auditLogger: AuditLogger
  ) {
    // Hubungkan callback pembayaran paymentService untuk auto-aktivasi kontrak saat DP lunas
    this.paymentService.onSuccess(async (payment: IPaymentModel) => {
      if (payment.creditContractId) {
        await this.handleDownPaymentSettled(payment.tenantId, payment.creditContractId, payment.amount);
      }
    });
  }

  /**
   * 1. Membuat Pengajuan Kredit dari Keranjang / Order Furniture
   */
  async createApplication(
    input: CreateCreditApplicationInput,
    context: UserContext
  ): Promise<{ contract: ICreditContractModel; schedule: CalculatedInstallmentItem[] }> {
    if (!input.orderItems || input.orderItems.length === 0) {
      throw new AppError("Keranjang pengajuan kredit tidak boleh kosong", 400);
    }

    // 1. Hitung total nilai furniture dari order items
    let itemTotalAmount = 0n;
    for (const item of input.orderItems) {
      if (item.quantity <= 0) throw new AppError("Kuantitas barang harus lebih dari 0", 400);
      itemTotalAmount += item.unitPrice * BigInt(item.quantity);
    }

    // 2. Ambil snapshot skema cicilan (Immutable Freeze)
    const schemeSnapshot = await this.schemeService.getSchemeSnapshotForContract(
      context.tenantId,
      input.schemeId
    );

    // 3. Validasi minimal DP skema
    const minRequiredDp = (itemTotalAmount * BigInt(schemeSnapshot.minDownPaymentPct)) / 100n;
    if (input.downPaymentOffered < minRequiredDp) {
      throw new AppError(
        `Uang muka (DP) minimal untuk skema ini adalah ${schemeSnapshot.minDownPaymentPct}% (Rp ${minRequiredDp.toString()})`,
        400
      );
    }

    const principalTotal = itemTotalAmount - input.downPaymentOffered;

    // 4. Validasi kelayakan plafon kredit nasabah & blacklist
    await this.customerService.validateCreditEligibility(input.customerId, principalTotal, context);

    // 5. Hitung jadwal cicilan menggunakan Single Shared Engine (Zero Discrepancy)
    const calculation = calculateInstallmentSchedule({
      itemTotalAmount,
      downPaymentAmount: input.downPaymentOffered,
      tenorMonths: input.tenorMonths,
      marginMethod: schemeSnapshot.marginMethod,
      marginRateBps: schemeSnapshot.marginRateBps,
      adminFeeAmount: BigInt(schemeSnapshot.adminFeeAmount),
    });

    // 6. Buat Nomor Kontrak Unik Berurutan
    const contractNumber = generateContractNumber(Math.floor(Math.random() * 9000) + 1000);
    const orderId = `ord-${Date.now()}`;

    // 7. Simpan Kontrak dalam status DIAJUKAN
    const contract = await this.appRepo.createContract({
      tenantId: context.tenantId,
      orderId,
      customerId: input.customerId,
      schemeId: input.schemeId,
      contractNumber,
      salesId: context.userId,
      status: "DIAJUKAN",
      tenorMonths: input.tenorMonths,
      principalTotal: calculation.principalTotal,
      marginTotal: calculation.marginTotal,
      adminFeeTotal: calculation.adminFeeAmount,
      downPaymentRequired: input.downPaymentOffered,
      downPaymentPaid: 0n,
      monthlyInstallment: calculation.monthlyInstallmentEstimate,
      schemeSnapshot: schemeSnapshot as any,
      notes: input.notes,
    });

    await this.auditLogger.log({
      tenantId: context.tenantId,
      userId: context.userId,
      action: "SUBMIT_CREDIT_APPLICATION",
      resource: "CreditContract",
      resourceId: contract.id,
      payload: {
        contractNumber: contract.contractNumber,
        principalTotal: contract.principalTotal.toString(),
        tenorMonths: input.tenorMonths,
      },
    });

    return { contract, schedule: calculation.installments };
  }

  /**
   * 2. Approval Berjenjang (Hierarchical Approval)
   */
  async reviewApplication(params: {
    contractId: string;
    decision: "APPROVE" | "REJECT";
    reason?: string;
    reviewer: UserContext & { maxCreditApprovalLimit: bigint };
  }): Promise<ICreditContractModel> {
    const { contractId, decision, reason, reviewer } = params;

    const contract = await this.appRepo.findContractById(reviewer.tenantId, contractId);
    if (!contract) throw new NotFoundError("Kontrak Kredit", contractId);

    // RBAC: Hanya MANAGER atau OWNER yang berwenang
    if (reviewer.role !== "MANAGER" && reviewer.role !== "OWNER") {
      throw new AppError(
        "Hanya Manager atau Owner yang memiliki hak untuk me-review pengajuan kredit",
        403,
        "UNAUTHORIZED_APPROVAL_ROLE"
      );
    }

    if (decision === "APPROVE") {
      // Batas Limit Kewenangan Nominal Approval Berjenjang
      // Jika pokok kredit > limit approval user, dan user BUKAN OWNER -> TOLAK
      if (contract.principalTotal > reviewer.maxCreditApprovalLimit && reviewer.role !== "OWNER") {
        throw new AppError(
          `Nominal pokok kredit (Rp ${contract.principalTotal.toString()}) melebihi batas limit kewenangan Anda (Rp ${reviewer.maxCreditApprovalLimit.toString()}). Diperlukan persetujuan Owner.`,
          403,
          "EXCEEDS_APPROVAL_LIMIT"
        );
      }

      // Validasi State Machine transisi DIAJUKAN -> DISETUJUI
      CreditContractStateMachine.transition(contract.status, "DISETUJUI", reviewer.userId);

      const updated = await this.appRepo.updateContract(contract.id, {
        status: "DISETUJUI",
        approvedById: reviewer.userId,
        approvedAt: new Date(),
      });

      await this.auditLogger.log({
        tenantId: reviewer.tenantId,
        userId: reviewer.userId,
        action: "APPROVE_CREDIT_APPLICATION",
        resource: "CreditContract",
        resourceId: contract.id,
        payload: { principalTotal: contract.principalTotal.toString(), reviewerRole: reviewer.role },
      });

      return updated;
    } else {
      CreditContractStateMachine.transition(contract.status, "DITOLAK", reviewer.userId, undefined, reason);

      const updated = await this.appRepo.updateContract(contract.id, {
        status: "DITOLAK",
        approvedById: reviewer.userId,
        notes: reason || "Pengajuan ditolak oleh reviewer",
      });

      await this.auditLogger.log({
        tenantId: reviewer.tenantId,
        userId: reviewer.userId,
        action: "REJECT_CREDIT_APPLICATION",
        resource: "CreditContract",
        resourceId: contract.id,
        payload: { reason },
      });

      return updated;
    }
  }

  /**
   * 3. Penandatanganan Digital & Penguncian Dokumen PDF (SHA-256 Hash)
   */
  async signContract(params: {
    contractId: string;
    customerSignatureDataUrl?: string;
    staffSignatureDataUrl?: string;
    context: UserContext;
  }): Promise<{ contract: ICreditContractModel; sha256Hash: string }> {
    const contract = await this.appRepo.findContractById(params.context.tenantId, params.contractId);
    if (!contract) throw new NotFoundError("Kontrak Kredit", params.contractId);

    if (contract.status !== "DISETUJUI" && contract.status !== "AKTIF") {
      throw new AppError("Kontrak hanya dapat ditandatangani setelah berstatus DISETUJUI", 422);
    }

    // Ambil data nasabah
    const customer = await this.customerService.getCustomerProfile(contract.customerId, params.context);

    // Ambil perhitungan jadwal cicilan
    const calculation = calculateInstallmentSchedule({
      itemTotalAmount: contract.principalTotal + contract.downPaymentRequired,
      downPaymentAmount: contract.downPaymentRequired,
      tenorMonths: contract.tenorMonths || Number(contract.schemeSnapshot.tenorMonths || 12),
      marginMethod: contract.schemeSnapshot.marginMethod as any,
      marginRateBps: Number(contract.schemeSnapshot.marginRateBps || 200),
      adminFeeAmount: contract.adminFeeTotal,
    });

    // Generate dokumen PDF & hitung SHA-256 hash
    const docResult = generateContractDocument({
      contractNumber: contract.contractNumber,
      tenantName: "Krevia Furniture Store",
      tenantAddress: "Jl. Industri Furniture No. 88, Bandung",
      customerName: customer.fullName,
      customerNikMasked: customer.nik,
      customerPhoneMasked: customer.phone,
      customerAddress: customer.addressKtp,
      orderItems: [
        {
          productName: "Furniture Order",
          variantName: "Standard",
          quantity: 1,
          unitPrice: contract.principalTotal + contract.downPaymentRequired,
          subtotal: contract.principalTotal + contract.downPaymentRequired,
        },
      ],
      financials: {
        itemTotalAmount: contract.principalTotal + contract.downPaymentRequired,
        downPaymentAmount: contract.downPaymentRequired,
        principalTotal: contract.principalTotal,
        marginTotal: contract.marginTotal,
        adminFeeAmount: contract.adminFeeTotal,
        monthlyInstallment: contract.monthlyInstallment,
        tenorMonths: Number(contract.schemeSnapshot.tenorMonths || 12),
        marginRatePct: Number(contract.schemeSnapshot.marginRateBps || 200) / 100,
        marginMethod: String(contract.schemeSnapshot.marginMethod),
        gracePeriodDays: Number(contract.schemeSnapshot.gracePeriodDays || 3),
        penaltyRule: "Denda keterlambatan berlaku harian sesuai ketentuan skema",
      },
      schedule: calculation.installments,
      signatures: {
        customerSignatureDataUrl: params.customerSignatureDataUrl,
        staffSignatureDataUrl: params.staffSignatureDataUrl,
        staffName: params.context.userId,
        signedAt: new Date(),
      },
    });

    const updated = await this.appRepo.updateContract(contract.id, {
      contractPdfHash: docResult.sha256Hash,
      signedByCustomerAt: new Date(),
    });

    await this.auditLogger.log({
      tenantId: params.context.tenantId,
      userId: params.context.userId,
      action: "SIGN_CREDIT_CONTRACT",
      resource: "CreditContract",
      resourceId: contract.id,
      payload: { sha256Hash: docResult.sha256Hash },
    });

    return { contract: updated, sha256Hash: docResult.sha256Hash };
  }

  /**
   * 4. Pembayaran DP (Tunai / QRIS Dinamis)
   */
  async payDownPayment(params: {
    contractId: string;
    method: "CASH" | "QRIS_DYNAMIC";
    cashGiven?: bigint;
    idempotencyKey: string;
    context: UserContext;
  }): Promise<IPaymentModel> {
    const contract = await this.appRepo.findContractById(params.context.tenantId, params.contractId);
    if (!contract) throw new NotFoundError("Kontrak Kredit", params.contractId);

    if (contract.status !== "DISETUJUI") {
      throw new AppError(
        `Pembayaran DP hanya dapat diproses untuk kontrak berstatus DISETUJUI (status saat ini: ${contract.status})`,
        422
      );
    }

    // Total DP wajib dibayar = downPaymentRequired + adminFeeTotal
    const totalDpDue = contract.downPaymentRequired + contract.adminFeeTotal;

    if (params.method === "CASH") {
      return await this.paymentService.processCashPayment({
        tenantId: params.context.tenantId,
        orderId: contract.orderId,
        creditContractId: contract.id,
        amount: totalDpDue,
        cashGiven: params.cashGiven || totalDpDue,
        idempotencyKey: params.idempotencyKey,
        createdById: params.context.userId,
      });
    } else {
      return await this.paymentService.initiateDynamicQrisPayment({
        tenantId: params.context.tenantId,
        orderId: contract.orderId,
        creditContractId: contract.id,
        amount: totalDpDue,
        idempotencyKey: params.idempotencyKey,
        createdById: params.context.userId,
      });
    }
  }

  /**
   * 5. Transisi Otomatis Menjadi AKTIF saat DP Lunas & TTD Terpenuhi
   */
  async handleDownPaymentSettled(tenantId: string, contractId: string, paidAmount: bigint): Promise<void> {
    const contract = await this.appRepo.findContractById(tenantId, contractId);
    if (!contract) return;

    // Pastikan kontrak sudah ditandatangani
    if (!contract.signedByCustomerAt) {
      // Jika belum TTD, perbarui saldo DP yang diterima, tapi jangan aktifkan dulu
      await this.appRepo.updateContract(contract.id, {
        downPaymentPaid: contract.downPaymentPaid + paidAmount,
      });
      return;
    }

    // Transisi State Machine: DISETUJUI -> AKTIF
    CreditContractStateMachine.transition(contract.status, "AKTIF", "SYSTEM", {
      isDownPaymentPaid: true,
      isContractSigned: true,
    });

    // 1. Generate Jadwal Angsuran Resmi
    const calculation = calculateInstallmentSchedule({
      itemTotalAmount: contract.principalTotal + contract.downPaymentRequired,
      downPaymentAmount: contract.downPaymentRequired,
      tenorMonths: contract.tenorMonths || Number(contract.schemeSnapshot.tenorMonths || 12),
      marginMethod: contract.schemeSnapshot.marginMethod as any,
      marginRateBps: Number(contract.schemeSnapshot.marginRateBps || 200),
      adminFeeAmount: contract.adminFeeTotal,
    });

    await this.appRepo.saveInstallments(
      calculation.installments.map((item) => ({
        contractId: contract.id,
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

    // 2. Alokasikan / Reservasi Stok Gudang Furniture
    await this.appRepo.reserveStock("variant-default", 1, contract.id);

    // 3. Update status kontrak menjadi AKTIF
    await this.appRepo.updateContract(contract.id, {
      status: "AKTIF",
      downPaymentPaid: contract.downPaymentPaid + paidAmount,
      activatedAt: new Date(),
    });

    await this.auditLogger.log({
      tenantId,
      action: "ACTIVATE_CREDIT_CONTRACT",
      resource: "CreditContract",
      resourceId: contract.id,
      payload: {
        contractNumber: contract.contractNumber,
        principalTotal: contract.principalTotal.toString(),
      },
    });
  }
}
