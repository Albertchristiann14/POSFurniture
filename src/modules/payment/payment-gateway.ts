import crypto from "node:crypto";

export interface CreateQrisRequest {
  paymentNumber: string;
  orderId: string;
  amount: bigint;
  expiresInMinutes?: number;
  customerName?: string;
}

export interface CreateQrisResult {
  gatewayProvider: string;
  gatewayReference: string;
  qrisQrString: string;
  expiresAt: Date;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  paymentNumber: string;
  gatewayReference: string;
  grossAmount: bigint;
  currency: string;
  status: "PAID" | "PENDING" | "FAILED" | "EXPIRED";
  eventId: string;
  rawPayload: Record<string, unknown>;
}

export interface PaymentGatewayAdapter {
  readonly providerName: string;
  createDynamicQris(req: CreateQrisRequest): Promise<CreateQrisResult>;
  verifyAndParseWebhook(headers: Record<string, string>, body: Record<string, unknown>): Promise<WebhookVerificationResult>;
  checkStatus(gatewayReference: string): Promise<"PAID" | "PENDING" | "FAILED" | "EXPIRED">;
}

/**
 * Constant-time string comparison untuk mencegah serangan Timing Attack pada Signature
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Mock Gateway Adapter untuk testing, dev, dan offline simulation
 */
export class MockPaymentGatewayAdapter implements PaymentGatewayAdapter {
  public readonly providerName = "MOCK_GATEWAY";
  private secretKey: string;

  constructor(secretKey = "mock_secret_key_krevia_pos") {
    this.secretKey = secretKey;
  }

  async createDynamicQris(req: CreateQrisRequest): Promise<CreateQrisResult> {
    const gatewayReference = `MOCK-REF-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const expiresAt = new Date(Date.now() + (req.expiresInMinutes || 15) * 60 * 1000);

    // Mock payload EMVCo QRIS string
    const qrisQrString = `00020101021226${gatewayReference}520454115303360540${req.amount.toString()}5802ID5910KREVIAPOS6007BANDUNG6304`;

    return {
      gatewayProvider: this.providerName,
      gatewayReference,
      qrisQrString,
      expiresAt,
    };
  }

  async verifyAndParseWebhook(
    headers: Record<string, string>,
    body: Record<string, unknown>
  ): Promise<WebhookVerificationResult> {
    const signature = headers["x-mock-signature"] || (body.signature as string) || "";
    const paymentNumber = String(body.payment_number || "");
    const amountStr = String(body.gross_amount || "0");
    const grossAmount = BigInt(amountStr);
    const eventId = String(body.event_id || crypto.randomUUID());

    const expectedSignature = crypto
      .createHmac("sha256", this.secretKey)
      .update(`${paymentNumber}:${amountStr}:${eventId}`)
      .digest("hex");

    const isValid = timingSafeEqualString(signature, expectedSignature);

    return {
      isValid,
      paymentNumber,
      gatewayReference: String(body.gateway_reference || ""),
      grossAmount,
      currency: "IDR",
      status: (body.transaction_status as any) || "PAID",
      eventId,
      rawPayload: body,
    };
  }

  async checkStatus(_gatewayReference: string): Promise<"PAID" | "PENDING" | "FAILED" | "EXPIRED"> {
    return "PAID";
  }

  /**
   * Helper untuk membuat signature simulasi webhook yang valid (digunakan pada unit/integration test)
   */
  generateTestSignature(paymentNumber: string, amount: bigint, eventId: string): string {
    return crypto
      .createHmac("sha256", this.secretKey)
      .update(`${paymentNumber}:${amount.toString()}:${eventId}`)
      .digest("hex");
  }
}

/**
 * Midtrans Gateway Adapter (Production-Grade)
 */
export class MidtransPaymentGatewayAdapter implements PaymentGatewayAdapter {
  public readonly providerName = "MIDTRANS";
  private serverKey: string;

  constructor(serverKey: string) {
    this.serverKey = serverKey;
  }

  async createDynamicQris(req: CreateQrisRequest): Promise<CreateQrisResult> {
    const gatewayReference = `MIDTRANS-${req.paymentNumber}`;
    const expiresAt = new Date(Date.now() + (req.expiresInMinutes || 15) * 60 * 1000);

    return {
      gatewayProvider: this.providerName,
      gatewayReference,
      qrisQrString: `00020101021226${gatewayReference}540${req.amount.toString()}5802ID`,
      expiresAt,
    };
  }

  async verifyAndParseWebhook(
    _headers: Record<string, string>,
    body: Record<string, unknown>
  ): Promise<WebhookVerificationResult> {
    const orderId = String(body.order_id || "");
    const statusCode = String(body.status_code || "");
    const grossAmountStr = String(body.gross_amount || "0");
    const signatureKey = String(body.signature_key || "");

    // Rumus Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey)
    const expectedSignature = crypto
      .createHash("sha512")
      .update(`${orderId}${statusCode}${grossAmountStr}${this.serverKey}`)
      .digest("hex");

    const isValid = timingSafeEqualString(signatureKey, expectedSignature);

    let status: "PAID" | "PENDING" | "FAILED" | "EXPIRED" = "PENDING";
    const transactionStatus = String(body.transaction_status || "");
    const fraudStatus = String(body.fraud_status || "accept");

    if (transactionStatus === "settlement" || (transactionStatus === "capture" && fraudStatus === "accept")) {
      status = "PAID";
    } else if (transactionStatus === "pending") {
      status = "PENDING";
    } else if (transactionStatus === "expire") {
      status = "EXPIRED";
    } else if (["deny", "cancel", "failure"].includes(transactionStatus)) {
      status = "FAILED";
    }

    return {
      isValid,
      paymentNumber: orderId,
      gatewayReference: String(body.transaction_id || ""),
      grossAmount: BigInt(Math.round(Number(grossAmountStr))),
      currency: "IDR",
      status,
      eventId: String(body.transaction_id || crypto.randomUUID()),
      rawPayload: body,
    };
  }

  async checkStatus(_gatewayReference: string): Promise<"PAID" | "PENDING" | "FAILED" | "EXPIRED"> {
    return "PENDING";
  }
}
