import { AuditLogger } from "@/modules/audit/audit-logger";

export interface ICashMovementModel {
  id: string;
  shiftId: string;
  amount: bigint; // positif (masuk) atau negatif (keluar)
  reason: "CASH_IN" | "CASH_OUT" | "EXPENSE";
  notes?: string;
  createdAt: Date;
}

export interface IShiftModel {
  id: string;
  tenantId: string;
  outletId: string;
  userId: string;
  openedAt: Date;
  closedAt?: Date;
  startCashAmount: bigint;
  endCashCalculated?: bigint;
  endCashActual?: bigint;
  discrepancy?: bigint;
  notes?: string;

  // Aggregated totals during shift
  totalCashSales: bigint;
  totalCashCreditDp: bigint;
  totalCashInstallments: bigint;
  totalQrisSales: bigint;
  totalCreditFinanced: bigint;

  cashMovements: ICashMovementModel[];
}

export interface IShiftRepository {
  createShift(shift: IShiftModel): Promise<IShiftModel>;
  findActiveShift(tenantId: string, outletId: string, userId: string): Promise<IShiftModel | null>;
  findShiftById(id: string): Promise<IShiftModel | null>;
  updateShift(shift: IShiftModel): Promise<IShiftModel>;
  addCashMovement(movement: ICashMovementModel): Promise<ICashMovementModel>;
}

export class InMemoryShiftRepository implements IShiftRepository {
  private shifts = new Map<string, IShiftModel>();

  async createShift(shift: IShiftModel): Promise<IShiftModel> {
    this.shifts.set(shift.id, { ...shift, cashMovements: [...shift.cashMovements] });
    return shift;
  }

  async findActiveShift(tenantId: string, outletId: string, userId: string): Promise<IShiftModel | null> {
    for (const s of this.shifts.values()) {
      if (s.tenantId === tenantId && s.outletId === outletId && s.userId === userId && !s.closedAt) {
        return s;
      }
    }
    return null;
  }

  async findShiftById(id: string): Promise<IShiftModel | null> {
    return this.shifts.get(id) || null;
  }

  async updateShift(shift: IShiftModel): Promise<IShiftModel> {
    this.shifts.set(shift.id, { ...shift, cashMovements: [...shift.cashMovements] });
    return shift;
  }

  async addCashMovement(movement: ICashMovementModel): Promise<ICashMovementModel> {
    const shift = this.shifts.get(movement.shiftId);
    if (shift) {
      shift.cashMovements.push(movement);
    }
    return movement;
  }
}

export class ShiftService {
  constructor(
    private readonly repo: IShiftRepository,
    private readonly auditLogger: AuditLogger
  ) {}

  async openShift(
    tenantId: string,
    outletId: string,
    userId: string,
    startCashAmount: bigint
  ): Promise<IShiftModel> {
    if (startCashAmount < 0n) {
      throw new Error("Modal awal kas tidak boleh bernilai negatif");
    }

    const active = await this.repo.findActiveShift(tenantId, outletId, userId);
    if (active) {
      throw new Error("Kasir masih memiliki shift aktif yang belum ditutup");
    }

    const shift: IShiftModel = {
      id: crypto.randomUUID(),
      tenantId,
      outletId,
      userId,
      openedAt: new Date(),
      startCashAmount,
      totalCashSales: 0n,
      totalCashCreditDp: 0n,
      totalCashInstallments: 0n,
      totalQrisSales: 0n,
      totalCreditFinanced: 0n,
      cashMovements: [],
    };

    const saved = await this.repo.createShift(shift);

    await this.auditLogger.log({
      tenantId,
      userId,
      action: "POS_SHIFT_OPENED",
      resource: "SHIFT",
      resourceId: saved.id,
      payload: { startCashAmount: startCashAmount.toString(), outletId },
    });

    return saved;
  }

  async recordCashMovement(
    tenantId: string,
    shiftId: string,
    userId: string,
    type: "CASH_IN" | "CASH_OUT" | "EXPENSE",
    amount: bigint,
    notes: string
  ): Promise<ICashMovementModel> {
    if (amount <= 0n) {
      throw new Error("Nominal mutasi kas harus lebih dari 0");
    }

    const shift = await this.repo.findShiftById(shiftId);
    if (!shift || shift.tenantId !== tenantId) {
      throw new Error("Shift tidak ditemukan");
    }
    if (shift.closedAt) {
      throw new Error("Tidak dapat mencatat mutasi kas pada shift yang sudah ditutup");
    }

    const signedAmount = type === "CASH_IN" ? amount : -amount;

    const movement: ICashMovementModel = {
      id: crypto.randomUUID(),
      shiftId,
      amount: signedAmount,
      reason: type,
      notes,
      createdAt: new Date(),
    };

    const saved = await this.repo.addCashMovement(movement);

    await this.auditLogger.log({
      tenantId,
      userId,
      action: `POS_CASH_MOVEMENT_${type}`,
      resource: "CASH_MOVEMENT",
      resourceId: saved.id,
      payload: { shiftId, type, amount: amount.toString(), notes },
    });

    return saved;
  }

  async recordSalePayment(
    shiftId: string,
    method: "CASH" | "QRIS" | "INTERNAL_CREDIT",
    amount: bigint
  ): Promise<void> {
    const shift = await this.repo.findShiftById(shiftId);
    if (!shift || shift.closedAt) return;

    if (method === "CASH") {
      shift.totalCashSales += amount;
    } else if (method === "QRIS") {
      shift.totalQrisSales += amount;
    } else if (method === "INTERNAL_CREDIT") {
      shift.totalCreditFinanced += amount;
    }

    await this.repo.updateShift(shift);
  }

  async recordCreditDownPaymentCash(shiftId: string, amount: bigint): Promise<void> {
    const shift = await this.repo.findShiftById(shiftId);
    if (!shift || shift.closedAt) return;

    shift.totalCashCreditDp += amount;
    await this.repo.updateShift(shift);
  }

  async recordInstallmentPaymentCash(shiftId: string, amount: bigint): Promise<void> {
    const shift = await this.repo.findShiftById(shiftId);
    if (!shift || shift.closedAt) return;

    shift.totalCashInstallments += amount;
    await this.repo.updateShift(shift);
  }

  async closeShift(
    tenantId: string,
    shiftId: string,
    userId: string,
    endCashActual: bigint,
    notes?: string
  ): Promise<IShiftModel> {
    if (endCashActual < 0n) {
      throw new Error("Nominal kas fisik aktual tidak boleh bernilai negatif");
    }

    const shift = await this.repo.findShiftById(shiftId);
    if (!shift || shift.tenantId !== tenantId) {
      throw new Error("Shift tidak ditemukan");
    }
    if (shift.closedAt) {
      throw new Error("Shift ini sudah ditutup sebelumnya");
    }

    // Hitung seluruh mutasi cash in/out
    let netPettyCash = 0n;
    for (const mov of shift.cashMovements) {
      netPettyCash += mov.amount;
    }

    // Expected = modal + penjualan tunai + DP tunai + angsuran tunai + net mutasi kas
    const endCashCalculated =
      shift.startCashAmount +
      shift.totalCashSales +
      shift.totalCashCreditDp +
      shift.totalCashInstallments +
      netPettyCash;

    const discrepancy = endCashActual - endCashCalculated;

    shift.closedAt = new Date();
    shift.endCashCalculated = endCashCalculated;
    shift.endCashActual = endCashActual;
    shift.discrepancy = discrepancy;
    shift.notes = notes;

    const updated = await this.repo.updateShift(shift);

    await this.auditLogger.log({
      tenantId,
      userId,
      action: "POS_SHIFT_CLOSED",
      resource: "SHIFT",
      resourceId: updated.id,
      payload: {
        startCash: shift.startCashAmount.toString(),
        calculated: endCashCalculated.toString(),
        actual: endCashActual.toString(),
        discrepancy: discrepancy.toString(),
      },
    });

    return updated;
  }
}
