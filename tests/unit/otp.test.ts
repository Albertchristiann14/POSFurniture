import { describe, it, expect, beforeEach } from "vitest";
import { OtpService } from "@/modules/credit/otp-service";
import { MockNotificationGateway } from "@/modules/notifications/reminder-service";

describe("Customer Portal OTP Verification & Rate Limiting", () => {
  let gateway: MockNotificationGateway;
  let otpService: OtpService;

  beforeEach(() => {
    gateway = new MockNotificationGateway();
    otpService = new OtpService(gateway);
  });

  it("1. harus mengirimkan OTP 6-digit dan berhasil memverifikasi", async () => {
    const contractNo = "KTR-261103-0001";
    const phone = "081234567890";

    const res = await otpService.requestOtp(contractNo, phone);
    expect(res.success).toBe(true);
    expect(res.maskedPhone).toBe("0812****7890");

    // Ambil kode OTP dari pesan gateway
    expect(gateway.sentMessages.length).toBe(1);
    const msg = gateway.sentMessages[0].message;
    const match = msg.match(/\b\d{6}\b/);
    expect(match).not.toBeNull();
    const code = match![0];

    // Verifikasi OTP
    const session = await otpService.verifyOtp(contractNo, phone, code);
    expect(session.token).toContain("csess-");
    expect(session.contractNumber).toBe(contractNo);

    // Validasi session token
    const validSession = otpService.validateSession(session.token);
    expect(validSession).not.toBeNull();
  });

  it("2. harus memblokir jika permintaan OTP melebihi batas rate limit (maks 3 kali)", async () => {
    const contractNo = "KTR-261103-0002";
    const phone = "081299998888";

    // 3 request pertama sukses
    await otpService.requestOtp(contractNo, phone);
    await otpService.requestOtp(contractNo, phone);
    await otpService.requestOtp(contractNo, phone);

    // Request ke-4 harus ditolak dengan error 429
    await expect(otpService.requestOtp(contractNo, phone)).rejects.toThrow(/Terlalu banyak permintaan OTP/);
  });

  it("3. harus mengunci OTP setelah 3 kali salah memasukkan kode", async () => {
    const contractNo = "KTR-261103-0003";
    const phone = "081277776666";

    await otpService.requestOtp(contractNo, phone);

    // Percobaan salah 1
    await expect(otpService.verifyOtp(contractNo, phone, "000000")).rejects.toThrow(/Sisa kesempatan: 2/);
    // Percobaan salah 2
    await expect(otpService.verifyOtp(contractNo, phone, "111111")).rejects.toThrow(/Sisa kesempatan: 1/);
    // Percobaan salah 3
    await expect(otpService.verifyOtp(contractNo, phone, "222222")).rejects.toThrow(/Batas percobaan OTP terlampaui/);
  });
});

