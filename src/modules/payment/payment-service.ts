import {
  PaymentGatewayAdapter,
  MockPaymentGatewayAdapter,
} from "./payment-gateway";
import { AppError, NotFoundError } from "@/shared/errors";
import { AuditLogger } from "@/modules/audit/audit-logger";

export type PaymentMethodType =
  | "CASH"
  | "QRIS_DYNAMIC"
  | "BANK_TRANSFER_MANUAL"
  | "SPLIT_PAYMENT"
  | "INTERNAL_CREDIT";

export type PaymentStatusType =
  | "CREATED"
  | "PENDING"
  | "PAID"
  | "EXPIRED"
  | "FAILED"
  | "REFUNDED"
  | "NEEDS_RECONCILIATION";

export interface IPaymentModel {
  id: string;
  tenantId: string;
  orderId?: string | null;
  creditContractId?: string | null;
  paymentNumber: string;
  method: PaymentMethodType;
  status: PaymentStatusType;
  amount: bigint;
  cashGiven?: bigint | null;
  changeReturned?: bigint | null;
  gatewayProvider?: string | null;
  gatewayReference?: string | null;
  qrisQrString?: string | null;
  expiresAt?: Date | null;
  paidAt?: Date | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaymentEventModel {
  id: string;
  paymentId: string;
  eventId: string;
  eventType: string;
  rawPayload: Record<string, unknown>;
  isSignatureValid: boolean;
  createdAt: Date;
}

export interface IPaymentRepository {
  create(payment: Omit<IPaymentModel, "id" | "createdAt" | "updatedAt">): Promise<IPaymentModel>;
  findById(id: string): Promise<IPaymentModel | null>;
  findByPaymentNumber(paymentNumber: string): Promise<IPaymentModel | null>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<IPaymentModel | null>;
  findActivePayment(params: { orderId?: string; creditContractId?: string }): Promise<IPaymentModel | null>;
  update(id: string, data: Partial<IPaymentModel>): Promise<IPaymentModel>;
  createEvent(event: Omit<IPaymentEventModel, "id" | "createdAt">): Promise<IPaymentEventModel>;
  findEvent(paymentId: string, eventId: string): Promise<IPaymentEventModel | null>;
}

export class InMemoryPaymentRepository implements IPaymentRepository {
  public payments: IPaymentModel[] = [];
  public events: IPaymentEventModel[] = [];

  async create(data: Omit<IPaymentModel, "id" | "createdAt" | "updatedAt">): Promise<IPaymentModel> {
    const payment: IPaymentModel = {
      ...data,
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.payments.push(payment);
    return payment;
  }

  async findById(id: string): Promise<IPaymentModel | null> {
    return this.payments.find((p) => p.id === id) || null;
  }

  async findByPaymentNumber(paymentNumber: string): Promise<IPaymentModel | null> {
    return this.payments.find((p) => p.paymentNumber === paymentNumber) || null;
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<IPaymentModel | null> {
    return this.payments.find((p) => p.tenantId === tenantId && p.idempotencyKey === key) || null;
  }

  async findActivePayment(params: { orderId?: string; creditContractId?: string }): Promise<IPaymentModel | null> {
    return (
      this.payments.find((p) => {
        const matchesTarget =
          (params.orderId && p.orderId === params.orderId) ||
          (params.creditContractId && p.creditContractId === params.creditContractId);
        const isActive = p.status === "CREATED" || p.status === "PENDING";
        const isNotExpired = !p.expiresAt || p.expiresAt > new Date();
        return matchesTarget && isActive && isNotExpired;
      }) || null
    );
  }

  async update(id: string, data: Partial<IPaymentModel>): Promise<IPaymentModel> {
    const idx = this.payments.findIndex((p) => p.id === id);
    if (idx === -1) throw new NotFoundError("Payment", id);
    this.payments[idx] = { ...this.payments[idx], ...data, updatedAt: new Date() };
    return this.payments[idx];
  }

  async createEvent(event: Omit<IPaymentEventModel, "id" | "createdAt">): Promise<IPaymentEventModel> {
    const record: IPaymentEventModel = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
    };
    this.events.push(record);
    return record;
  }

  async findEvent(paymentId: string, eventId: string): Promise<IPaymentEventModel | null> {
    return this.events.find((e) => e.paymentId === paymentId && e.eventId === eventId) || null;
  }
}

export type PaymentSuccessCallback = (payment: IPaymentModel) => Promise<void>;

export class PaymentService {
  private successCallbacks: PaymentSuccessCallback[] = [];

  constructor(
    private paymentRepo: IPaymentRepository,
    private gatewayAdapter: PaymentGatewayAdapter = new MockPaymentGatewayAdapter(),
    private auditLogger: AuditLogger
  ) {}

  onSuccess(callback: PaymentSuccessCallback): void {
    this.successCallbacks.push(callback);
  }

  /**
   * Membuat pembayaran tunai di kasir (Anti double payment + Idempotent)
   */
  async processCashPayment(params: {
    tenantId: string;
    orderId?: string;
    creditContractId?: string;
    amount: bigint;
    cashGiven: bigint;
    idempotencyKey: string;
    createdById: string;
  }): Promise<IPaymentModel> {
    // 1. Cek Idempotency Key
    const existingKey = await this.paymentRepo.findByIdempotencyKey(params.tenantId, params.idempotencyKey);
    if (existingKey) {
      return existingKey;
    }

    if (params.cashGiven < params.amount) {
      throw new AppError("Nominal uang tunai yang diberikan kurang dari total tagihan", 400);
    }

    const changeReturned = params.cashGiven - params.amount;
    const paymentNumber = `PAY-${Date.now().toString().slice(-8)}`;

    const payment = await this.paymentRepo.create({
      tenantId: params.tenantId,
      orderId: params.orderId || null,
      creditContractId: params.creditContractId || null,
      paymentNumber,
      method: "CASH",
      status: "PAID",
      amount: params.amount,
      cashGiven: params.cashGiven,
      changeReturned,
      paidAt: new Date(),
      idempotencyKey: params.idempotencyKey,
    });

    await this.auditLogger.log({
      tenantId: params.tenantId,
      userId: params.createdById,
      action: "PROCESS_CASH_PAYMENT",
      resource: "Payment",
      resourceId: payment.id,
      payload: {
        amount: payment.amount.toString(),
        change: changeReturned.toString(),
      },
    });

    // Jalankan callback penyelesaian (misal aktivasi kontrak atau update status order)
    for (const cb of this.successCallbacks) {
      await cb(payment);
    }

    return payment;
  }

  /**
   * Mengenerate QRIS dinamis dari Gateway Adapter (Anti double payment + Idempotent)
   */
  async initiateDynamicQrisPayment(params: {
    tenantId: string;
    orderId?: string;
    creditContractId?: string;
    amount: bigint;
    idempotencyKey: string;
    createdById: string;
  }): Promise<IPaymentModel> {
    // 1. Cek Idempotency Key
    const existingKey = await this.paymentRepo.findByIdempotencyKey(params.tenantId, params.idempotencyKey);
    if (existingKey) {
      return existingKey;
    }

    // 2. Anti Double Payment: Cek apakah sudah ada pembayaran aktif yang belum expired
    const activePayment = await this.paymentRepo.findActivePayment({
      orderId: params.orderId,
      creditContractId: params.creditContractId,
    });
    if (activePayment) {
      return activePayment; // Kembalikan pembayaran aktif yang sudah ada
    }

    const paymentNumber = `PAY-${Date.now().toString().slice(-8)}`;

    // 3. Hubungi Payment Gateway Adapter
    const gatewayRes = await this.gatewayAdapter.createDynamicQris({
      paymentNumber,
      orderId: params.orderId || params.creditContractId || paymentNumber,
      amount: params.amount,
      expiresInMinutes: 15,
    });

    const payment = await this.paymentRepo.create({
      tenantId: params.tenantId,
      orderId: params.orderId || null,
      creditContractId: params.creditContractId || null,
      paymentNumber,
      method: "QRIS_DYNAMIC",
      status: "PENDING",
      amount: params.amount,
      gatewayProvider: gatewayRes.gatewayProvider,
      gatewayReference: gatewayRes.gatewayReference,
      qrisQrString: gatewayRes.qrisQrString,
      expiresAt: gatewayRes.expiresAt,
      idempotencyKey: params.idempotencyKey,
    });

    return payment;
  }

  /**
   * Menangani Webhook Gateway secara Idempotent dan Terverifikasi
   */
  async handleGatewayWebhook(
    headers: Record<string, string>,
    body: Record<string, unknown>
  ): Promise<{ status: string; paymentId?: string }> {
    // 1. Verifikasi Signature Gateway dengan Constant-Time Comparison
    const verification = await this.gatewayAdapter.verifyAndParseWebhook(headers, body);

    if (!verification.isValid) {
      throw new AppError("Invalid gateway signature", 401, "INVALID_WEBHOOK_SIGNATURE");
    }

    // 2. Cari data payment di database
    const payment = await this.paymentRepo.findByPaymentNumber(verification.paymentNumber);
    if (!payment) {
      throw new NotFoundError("Payment untuk Webhook", verification.paymentNumber);
    }

    // 3. Idempotensi Webhook: Cek apakah eventId sudah pernah dicatat
    const existingEvent = await this.paymentRepo.findEvent(payment.id, verification.eventId);
    if (existingEvent) {
      // Event duplikat: kembalikan sukses tanpa proses ulang
      return { status: "DUPLICATE_EVENT_IGNORED", paymentId: payment.id };
    }

    // Catat event webhook ke tabel log payment_events
    await this.paymentRepo.createEvent({
      paymentId: payment.id,
      eventId: verification.eventId,
      eventType: verification.status,
      rawPayload: verification.rawPayload,
      isSignatureValid: true,
    });

    // 4. Verifikasi Integritas Nominal
    if (verification.grossAmount !== payment.amount) {
      // Nominal webhook tidak cocok dengan database: tandai rekonsiliasi!
      await this.paymentRepo.update(payment.id, {
        status: "NEEDS_RECONCILIATION",
      });
      await this.auditLogger.log({
        tenantId: payment.tenantId,
        action: "PAYMENT_AMOUNT_MISMATCH",
        resource: "Payment",
        resourceId: payment.id,
        payload: {
          expected: payment.amount.toString(),
          received: verification.grossAmount.toString(),
        },
      });
      return { status: "NEEDS_RECONCILIATION", paymentId: payment.id };
    }

    // 5. Update status pembayaran jika statusnya PAID
    if (verification.status === "PAID" && payment.status !== "PAID") {
      const updatedPayment = await this.paymentRepo.update(payment.id, {
        status: "PAID",
        paidAt: new Date(),
        gatewayReference: verification.gatewayReference,
      });

      // Jalankan callback penyelesaian (misal aktivasi kontrak)
      for (const cb of this.successCallbacks) {
        await cb(updatedPayment);
      }
    } else if (verification.status === "EXPIRED") {
      await this.paymentRepo.update(payment.id, { status: "EXPIRED" });
    }

    return { status: "PROCESSED", paymentId: payment.id };
  }
}
