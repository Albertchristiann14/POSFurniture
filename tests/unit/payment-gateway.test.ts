import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  MockPaymentGatewayAdapter,
  MidtransPaymentGatewayAdapter,
  timingSafeEqualString,
} from "@/modules/payment/payment-gateway";

describe("Payment Gateway Adapters & Webhook Security", () => {
  describe("timingSafeEqualString", () => {
    it("harus membandingkan string dengan konstan waktu dan hasil akurat", () => {
      expect(timingSafeEqualString("abcdef123456", "abcdef123456")).toBe(true);
      expect(timingSafeEqualString("abcdef123456", "abcdef123457")).toBe(false);
      expect(timingSafeEqualString("short", "longer_string")).toBe(false);
      expect(timingSafeEqualString("", "")).toBe(false);
    });
  });

  describe("MockPaymentGatewayAdapter", () => {
    const adapter = new MockPaymentGatewayAdapter("secret-key-123");

    it("harus menghasilkan QRIS dinamis dengan expiry dan format yang tepat", async () => {
      const qris = await adapter.createDynamicQris({
        paymentNumber: "PAY-001",
        orderId: "ORD-001",
        amount: 2500000n,
        expiresInMinutes: 15,
      });

      expect(qris.gatewayProvider).toBe("MOCK_GATEWAY");
      expect(qris.gatewayReference).toContain("MOCK-REF-");
      expect(qris.qrisQrString).toContain("2500000");
      expect(qris.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("harus memvalidasi signature webhook yang sah dan menolak yang palsu", async () => {
      const paymentNumber = "PAY-001";
      const amount = 2500000n;
      const eventId = "evt-123";

      const validSig = adapter.generateTestSignature(paymentNumber, amount, eventId);

      // Webhook dengan signature sah
      const verifiedValid = await adapter.verifyAndParseWebhook(
        { "x-mock-signature": validSig },
        { payment_number: paymentNumber, gross_amount: "2500000", event_id: eventId, transaction_status: "PAID" }
      );
      expect(verifiedValid.isValid).toBe(true);
      expect(verifiedValid.grossAmount).toBe(amount);

      // Webhook dengan signature palsu / dimanipulasi
      const verifiedFake = await adapter.verifyAndParseWebhook(
        { "x-mock-signature": "fake-signature-hex-12345" },
        { payment_number: paymentNumber, gross_amount: "2500000", event_id: eventId }
      );
      expect(verifiedFake.isValid).toBe(false);
    });
  });

  describe("MidtransPaymentGatewayAdapter", () => {
    const serverKey = "SB-Mid-server-abc123XYZ";
    const adapter = new MidtransPaymentGatewayAdapter(serverKey);

    it("harus memverifikasi signature SHA-512 Midtrans secara tepat", async () => {
      const orderId = "PAY-261103-0001";
      const statusCode = "200";
      const grossAmount = "3500000.00";

      // SHA512(order_id + status_code + gross_amount + ServerKey)
      const validSignatureKey = crypto
        .createHash("sha512")
        .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
        .digest("hex");

      const verified = await adapter.verifyAndParseWebhook(
        {},
        {
          order_id: orderId,
          status_code: statusCode,
          gross_amount: grossAmount,
          signature_key: validSignatureKey,
          transaction_status: "settlement",
          fraud_status: "accept",
          transaction_id: "trx-midtrans-999",
        }
      );

      expect(verified.isValid).toBe(true);
      expect(verified.paymentNumber).toBe(orderId);
      expect(verified.status).toBe("PAID");
      expect(verified.grossAmount).toBe(3500000n);
    });

    it("harus menolak webhook Midtrans jika nominal uang dimanipulasi (tampered gross_amount)", async () => {
      const orderId = "PAY-261103-0001";
      const statusCode = "200";
      const originalAmount = "3500000.00";

      const signatureKey = crypto
        .createHash("sha512")
        .update(`${orderId}${statusCode}${originalAmount}${serverKey}`)
        .digest("hex");

      // Hacker mengubah gross_amount jadi 1.000.000 tapi memakai signature 3.500.000
      const verified = await adapter.verifyAndParseWebhook(
        {},
        {
          order_id: orderId,
          status_code: statusCode,
          gross_amount: "1000000.00",
          signature_key: signatureKey,
          transaction_status: "settlement",
        }
      );

      expect(verified.isValid).toBe(false);
    });
  });
});
