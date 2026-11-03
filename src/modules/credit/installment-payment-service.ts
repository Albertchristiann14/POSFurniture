import { AllocationEngine, InstallmentForAllocation } from "./allocation-engine";
import { LedgerEngine } from "@/modules/ledger/ledger-engine";
import { PaymentService, IPaymentModel } from "@/modules/payment/payment-service";
import { CreditContractStateMachine } from "./fsm";
import { ReceiptGenerator, InstallmentReceiptData } from "./receipt-generator";
import { AuditLogger } from "@/modules/audit/audit-logger";
import { AppError, NotFoundError } from "@/shared/errors";
import { UserContext } from "./customer-service";

export interface IPaymentAllocationModel {
  id: string;
  contractId: string;
  installmentId: string;
  paymentId?: string | null;
  allocatedPenalty: bigint;
  allocatedMargin: bigint;
  allocatedPrincipal: bigint;
  totalAllocated: bigint;
  createdAt: Date;
}

export interface IInstallmentPaymentRepository {
  findContract(tenantId: string, contractId: string): Promise<any>;
  findContractByNumber(tenantId: string, contractNumber: string): Promise<any>;
  updateContract(contractId: string, data: any): Promise<any>;
  getInstallments(contractId: string): Promise<InstallmentForAllocation[]>;
  updateInstallment(installmentId: string, data: Partial<InstallmentForAllocation>): Promise<InstallmentForAllocation>;
  savePaymentAllocation(data: Omit<IPaymentAllocationModel, "id" | "createdAt">): Promise<IPaymentAllocationModel>;
  getCustomer(tenantId: string, customerId: string): Promise<any>;
}

export class InMemoryInstallmentPaymentRepository implements IInstallmentPaymentRepository {
  public contracts: any[] = [];
  public installments: InstallmentForAllocation[] = [];
  public allocations: IPaymentAllocationModel[] = [];
  public customers: any[] = [];

  async findContract(tenantId: string, contractId: string): Promise<any> {
    return this.contracts.find((c) => c.tenantId === tenantId && c.id === contractId) || null;
  }

  async findContractByNumber(tenantId: string, contractNumber: string): Promise<any> {
    return this.contracts.find((c) => c.tenantId === tenantId && c.contractNumber === contractNumber) || null;
  }

  async updateContract(contractId: string, data: any): Promise<any> {
    const idx = this.contracts.findIndex((c) => c.id === contractId);
    if (idx === -1) throw new NotFoundError("Kontrak", contractId);
    this.contracts[idx] = { ...this.contracts[idx], ...data };
    return this.contracts[idx];
  }

  async getInstallments(contractId: string): Promise<InstallmentForAllocation[]> {
    return this.installments.filter((i) => (i as any).contractId === contractId);
  }

  async updateInstallment(installmentId: string, data: Partial<InstallmentForAllocation>): Promise<InstallmentForAllocation> {
    const idx = this.installments.findIndex((i) => i.id === installmentId);
    if (idx === -1) throw new NotFoundError("Installment", installmentId);
    this.installments[idx] = { ...this.installments[idx], ...data };
    return this.installments[idx];
  }

  async savePaymentAllocation(data: Omit<IPaymentAllocationModel, "id" | "createdAt">): Promise<IPaymentAllocationModel> {
    const record: IPaymentAllocationModel = {
      ...data,
      id: `alc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date(),
    };
    this.allocations.push(record);
    return record;
  }

  async getCustomer(tenantId: string, customerId: string): Promise<any> {
    return this.customers.find((c) => c.tenantId === tenantId && c.id === customerId) || null;
  }
}

export class InstallmentPaymentService {
  constructor(
    private repo: IInstallmentPaymentRepository,
    private paymentService: PaymentService,
    private ledgerEngine: LedgerEngine,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Memproses pembayaran angsuran cicilan (Tunai / QRIS / Transfer)
   * Mengalokasikan dana secara ketat: Denda -> Margin -> Pokok
   * Membukukan ke Double-Entry Ledger dan menghasilkan Struk Digital
   */
  async processInstallmentPayment(params: {
    tenantId: string;
    contractId: string;
    method: "CASH" | "QRIS_DYNAMIC" | "BANK_TRANSFER_MANUAL";
    amount: bigint;
    cashGiven?: bigint;
    idempotencyKey: string;
    context: UserContext;
  }): Promise<{
    payment: IPaymentModel;
    receiptData: InstallmentReceiptData;
    thermalReceiptText: string;
    digitalReceiptHtml: string;
    contractStatus: string;
  }> {
    const contract = await this.repo.findContract(params.tenantId, params.contractId);
    if (!contract) throw new NotFoundError("Kontrak Kredit", params.contractId);

    if (contract.status !== "AKTIF") {
      throw new AppError(
        `Pembayaran cicilan hanya dapat diproses untuk kontrak AKTIF (status saat ini: ${contract.status})`,
        422
      );
    }

    // 1. Eksekusi Pembayaran via Payment Module
    let payment: IPaymentModel;
    if (params.method === "CASH") {
      payment = await this.paymentService.processCashPayment({
        tenantId: params.tenantId,
        creditContractId: contract.id,
        amount: params.amount,
        cashGiven: params.cashGiven || params.amount,
        idempotencyKey: params.idempotencyKey,
        createdById: params.context.userId,
      });
    } else {
      payment = await this.paymentService.initiateDynamicQrisPayment({
        tenantId: params.tenantId,
        creditContractId: contract.id,
        amount: params.amount,
        idempotencyKey: params.idempotencyKey,
        createdById: params.context.userId,
      });
    }

    // Jika metode non-tunai (misal QRIS), payment berstatus PENDING hingga webhook terverifikasi
    if (payment.status === "PAID") {
      return await this.settleAllocatedPayment(contract, payment, params.context);
    }

    // Jika PENDING, buatkan DTO respons awal
    return {
      payment,
      receiptData: {} as any,
      thermalReceiptText: "MENUNGGU PEMBAYARAN QRIS...",
      digitalReceiptHtml: "<p>Menunggu pembayaran...</p>",
      contractStatus: contract.status,
    };
  }

  /**
   * Menyelesaikan alokasi pembayaran setelah status dana dipastikan PAID
   */
  async settleAllocatedPayment(
    contract: any,
    payment: IPaymentModel,
    context: UserContext
  ): Promise<{
    payment: IPaymentModel;
    receiptData: InstallmentReceiptData;
    thermalReceiptText: string;
    digitalReceiptHtml: string;
    contractStatus: string;
  }> {
    // 1. Ambil seluruh jadwal angsuran kontrak
    const installments = await this.repo.getInstallments(contract.id);

    // 2. Jalankan Algoritma Alokasi (Denda -> Margin -> Pokok)
    const plan = AllocationEngine.allocatePayment(installments, payment.amount);

    const paidInstallmentNumbers: number[] = [];

    // 3. Perbarui status jadwal angsuran di database & simpan alokasi
    for (const alloc of plan.allocations) {
      paidInstallmentNumbers.push(alloc.installmentNumber);

      await this.repo.updateInstallment(alloc.installmentId, {
        principalPaid: alloc.newPrincipalPaid,
        marginPaid: alloc.newMarginPaid,
        penaltyPaid: alloc.newPenaltyPaid,
        status: alloc.newStatus,
      });

      await this.repo.savePaymentAllocation({
        contractId: contract.id,
        installmentId: alloc.installmentId,
        paymentId: payment.id,
        allocatedPenalty: alloc.allocatedPenalty,
        allocatedMargin: alloc.allocatedMargin,
        allocatedPrincipal: alloc.allocatedPrincipal,
        totalAllocated: alloc.totalAllocated,
      });
    }

    // 4. Pembukuan Jurnal Double-Entry ke Ledger
    // Dr. KAS_BANK (payment.amount)
    // Cr. PIUTANG_DENDA (totalAllocatedPenalty)
    // Cr. PIUTANG_POKOK (totalAllocatedPrincipal + totalAllocatedMargin)
    // Realisasi Margin:
    // Dr. MARGIN_DITANGGUHKAN (totalAllocatedMargin)
    // Cr. PENDAPATAN_MARGIN (totalAllocatedMargin)
    // Jika ada kelebihan bayar:
    // Cr. TITIPAN_PELANGGAN (remainingUnallocatedAmount)
    const ledgerEntries: any[] = [
      {
        accountCode: "KAS_BANK",
        direction: "DEBIT",
        amount: payment.amount,
        notes: `Pembayaran cicilan kontrak ${contract.contractNumber}`,
      },
    ];

    if (plan.totalAllocatedPenalty > 0n) {
      ledgerEntries.push({
        accountCode: "PIUTANG_DENDA",
        direction: "CREDIT",
        amount: plan.totalAllocatedPenalty,
        notes: `Pelunasan denda kontrak ${contract.contractNumber}`,
      });
    }

    const totalPrincipalAndMargin = plan.totalAllocatedPrincipal + plan.totalAllocatedMargin;
    if (totalPrincipalAndMargin > 0n) {
      ledgerEntries.push({
        accountCode: "PIUTANG_POKOK",
        direction: "CREDIT",
        amount: totalPrincipalAndMargin,
        notes: `Pelunasan pokok & margin kontrak ${contract.contractNumber}`,
      });
    }

    if (plan.remainingUnallocatedAmount > 0n) {
      ledgerEntries.push({
        accountCode: "TITIPAN_PELANGGAN",
        direction: "CREDIT",
        amount: plan.remainingUnallocatedAmount,
        notes: `Kelebihan bayar kontrak ${contract.contractNumber}`,
      });
    }

    // Jurnal Pengakuan Pendapatan Margin Terealisasi
    if (plan.totalAllocatedMargin > 0n) {
      ledgerEntries.push({
        accountCode: "MARGIN_DITANGGUHKAN",
        direction: "DEBIT",
        amount: plan.totalAllocatedMargin,
        notes: `Amortisasi margin ditangguhkan ${contract.contractNumber}`,
      });
      ledgerEntries.push({
        accountCode: "PENDAPATAN_MARGIN",
        direction: "CREDIT",
        amount: plan.totalAllocatedMargin,
        notes: `Realisasi pendapatan margin ${contract.contractNumber}`,
      });
    }

    await this.ledgerEngine.postBatch({
      tenantId: contract.tenantId,
      contractId: contract.id,
      idempotencyKey: `ledger-pay-${payment.id}`,
      referenceEvent: "INSTALLMENT_PAID",
      description: `Pembayaran angsuran kontrak ${contract.contractNumber}`,
      createdById: context.userId,
      entries: ledgerEntries,
    });

    // 5. Evaluasi Apakah Kontrak Kini Lunas Sepenuhnya
    let currentContractStatus = contract.status;
    if (plan.isFullySettled) {
      CreditContractStateMachine.transition(contract.status, "LUNAS", context.userId, {
        hasOutstandingDebt: false,
      });

      await this.repo.updateContract(contract.id, {
        status: "LUNAS",
        completedAt: new Date(),
      });
      currentContractStatus = "LUNAS";
    }

    // 6. Hitung Sisa Piutang Pokok & Denda Terkini dari Ledger
    const ledgerBalances = await this.ledgerEngine.getContractReceivableBalance(
      contract.tenantId,
      contract.id
    );

    // 7. Generate Data Struk Pembayaran
    const customer = await this.repo.getCustomer(contract.tenantId, contract.customerId);

    const receiptData: InstallmentReceiptData = {
      tenantName: "Krevia Furniture Store",
      tenantAddress: "Jl. Industri Furniture No. 88, Bandung",
      tenantPhone: "022-88776655",
      receiptNumber: `STR-${payment.paymentNumber}`,
      paymentDate: new Date(),
      cashierName: context.userId,
      customerName: customer?.fullName || "Pelanggan",
      customerNikMasked: customer?.nik || "****************",
      contractNumber: contract.contractNumber,
      installmentNumbersPaid: paidInstallmentNumbers,
      paymentMethod: payment.method as any,
      amountPaid: payment.amount,
      cashGiven: payment.cashGiven,
      changeReturned: payment.changeReturned,
      allocatedPrincipal: plan.totalAllocatedPrincipal,
      allocatedMargin: plan.totalAllocatedMargin,
      allocatedPenalty: plan.totalAllocatedPenalty,
      remainingPrincipalDebt: ledgerBalances.principalOutstanding,
      remainingPenaltyDebt: ledgerBalances.penaltyOutstanding,
      contractStatusAfterPayment: currentContractStatus,
    };

    const thermalReceiptText = ReceiptGenerator.generateThermalText(receiptData);
    const digitalReceiptHtml = ReceiptGenerator.generateDigitalReceiptHtml(receiptData);

    return {
      payment,
      receiptData,
      thermalReceiptText,
      digitalReceiptHtml,
      contractStatus: currentContractStatus,
    };
  }

  /**
   * Pelunasan Dipercepat (Early Settlement / Payoff)
   * Melunasi sisa pokok + denda, dan menghapus sisa margin masa depan yang belum jatuh tempo
   */
  async processEarlySettlement(params: {
    tenantId: string;
    contractId: string;
    futureMarginDiscountPct?: number; // 0..100%
    idempotencyKey: string;
    context: UserContext;
  }): Promise<{ netPayoffAmount: bigint; contract: any; receiptHtml: string }> {
    const contract = await this.repo.findContract(params.tenantId, params.contractId);
    if (!contract) throw new NotFoundError("Kontrak Kredit", params.contractId);

    const installments = await this.repo.getInstallments(contract.id);

    // Hitung rincian pelunasan
    const calculation = AllocationEngine.calculateEarlyPayoff({
      installments,
      futureMarginDiscountPct: params.futureMarginDiscountPct ?? 100,
    });

    // Proses penerimaan kas pelunasan
    const payment = await this.paymentService.processCashPayment({
      tenantId: params.tenantId,
      creditContractId: contract.id,
      amount: calculation.netPayoffAmount,
      cashGiven: calculation.netPayoffAmount,
      idempotencyKey: params.idempotencyKey,
      createdById: params.context.userId,
    });

    // Tandai semua sisa angsuran menjadi LUNAS
    for (const inst of installments) {
      if (inst.status !== "LUNAS") {
        await this.repo.updateInstallment(inst.id, {
          principalPaid: inst.principalDue,
          marginPaid: inst.marginDue,
          penaltyPaid: inst.penaltyAccrued,
          status: "LUNAS",
        });
      }
    }

    // Pembukuan Ledger untuk Pelunasan Dipercepat:
    const dueMarginPaid =
      calculation.netPayoffAmount - calculation.totalRemainingPrincipal - calculation.totalUnpaidPenalty;

    const entries: any[] = [
      // 1. Penerimaan Uang Kas / Bank
      {
        accountCode: "KAS_BANK",
        direction: "DEBIT",
        amount: calculation.netPayoffAmount,
        notes: `Kas pelunasan dipercepat kontrak ${contract.contractNumber}`,
      },
      // 2. Pelunasan Pokok dan Margin Jatuh Tempo
      {
        accountCode: "PIUTANG_POKOK",
        direction: "CREDIT",
        amount: calculation.totalRemainingPrincipal + (dueMarginPaid > 0n ? dueMarginPaid : 0n),
        notes: `Pelunasan pokok & margin jatuh tempo kontrak ${contract.contractNumber}`,
      },
    ];

    if (calculation.totalUnpaidPenalty > 0n) {
      entries.push({
        accountCode: "PIUTANG_DENDA",
        direction: "CREDIT",
        amount: calculation.totalUnpaidPenalty,
        notes: `Pelunasan denda kontrak ${contract.contractNumber}`,
      });
    }

    // 3. Realisasi Margin Jatuh Tempo yang Terbayar
    if (dueMarginPaid > 0n) {
      entries.push({
        accountCode: "MARGIN_DITANGGUHKAN",
        direction: "DEBIT",
        amount: dueMarginPaid,
        notes: `Realisasi margin jatuh tempo kontrak ${contract.contractNumber}`,
      });
      entries.push({
        accountCode: "PENDAPATAN_MARGIN",
        direction: "CREDIT",
        amount: dueMarginPaid,
        notes: `Pengakuan pendapatan margin jatuh tempo kontrak ${contract.contractNumber}`,
      });
    }

    // 4. Pembalikan Sisa Margin Masa Depan yang Dihapuskan (Diskon)
    if (calculation.marginDiscountAmount > 0n) {
      entries.push({
        accountCode: "MARGIN_DITANGGUHKAN",
        direction: "DEBIT",
        amount: calculation.marginDiscountAmount,
        notes: `Penghapusan margin masa depan kontrak ${contract.contractNumber}`,
      });
      entries.push({
        accountCode: "PIUTANG_POKOK",
        direction: "CREDIT",
        amount: calculation.marginDiscountAmount,
        notes: `Penghapusan piutang margin masa depan kontrak ${contract.contractNumber}`,
      });
    }

    await this.ledgerEngine.postBatch({
      tenantId: params.tenantId,
      contractId: contract.id,
      idempotencyKey: `early-settle-${payment.id}`,
      referenceEvent: "EARLY_SETTLEMENT",
      description: `Pelunasan dipercepat kontrak ${contract.contractNumber}`,
      createdById: params.context.userId,
      entries,
    });

    // Transisi kontrak menjadi LUNAS
    CreditContractStateMachine.transition(contract.status, "LUNAS", params.context.userId, {
      hasOutstandingDebt: false,
    });

    const updatedContract = await this.repo.updateContract(contract.id, {
      status: "LUNAS",
      completedAt: new Date(),
    });

    return {
      netPayoffAmount: calculation.netPayoffAmount,
      contract: updatedContract,
      receiptHtml: `<p>Pelunasan Dipercepat Berhasil: ${contract.contractNumber}</p>`,
    };
  }
}
