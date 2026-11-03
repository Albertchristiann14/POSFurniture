import crypto from "node:crypto";
import { AppError } from "@/shared/errors";
import { NotificationGateway, MockNotificationGateway } from "@/modules/notifications/reminder-service";

export interface OtpRecord {
  contractNumber: string;
  phone: string;
  code: string;
  expiresAt: Date;
  attempts: number;
  isVerified: boolean;
}

export interface CustomerSession {
  token: string;
  contractNumber: string;
  phone: string;
  expiresAt: Date;
}

export class OtpService {
  private otps = new Map<string, OtpRecord>(); // key: `${contractNumber}:${phone}`
  private requestHistory = new Map<string, number[]>(); // rate limiting
  private activeSessions = new Map<string, CustomerSession>(); // key: session token

  constructor(private gateway: NotificationGateway = new MockNotificationGateway()) {}

  /**
   * Mengirimkan OTP 6-digit ke HP terdaftar (Rate Limited & Proteksi Enumerasi)
   */
  async requestOtp(contractNumber: string, phone: string): Promise<{ success: boolean; maskedPhone: string }> {
    const key = `${contractNumber}:${phone}`;
    const now = Date.now();

    // 1. Rate Limiter: Maksimal 3 request per 10 menit
    const windowMs = 10 * 60 * 1000;
    const history = this.requestHistory.get(key) || [];
    const recent = history.filter((ts) => now - ts < windowMs);
    if (recent.length >= 3) {
      throw new AppError(
        "Terlalu banyak permintaan OTP. Silakan tunggu 10 menit sebelum mencoba kembali.",
        429,
        "OTP_RATE_LIMITED"
      );
    }
    recent.push(now);
    this.requestHistory.set(key, recent);

    // 2. Generate 6 Digit Angka Acak Kriptografis
    const randomInt = crypto.randomInt(100000, 999999);
    const code = randomInt.toString();
    const expiresAt = new Date(now + 5 * 60 * 1000); // 5 menit

    this.otps.set(key, {
      contractNumber,
      phone,
      code,
      expiresAt,
      attempts: 0,
      isVerified: false,
    });

    // 3. Kirim ke WhatsApp
    const message = `[KREVIA POS] Kode verifikasi Anda adalah ${code}. Berlaku selama 5 menit. Jangan bagikan kode ini kepada siapapun demi keamanan cicilan Anda.`;
    await this.gateway.sendWhatsApp(phone, message);

    const maskedPhone = phone.slice(0, 4) + "****" + phone.slice(-4);
    return { success: true, maskedPhone };
  }

  /**
   * Memverifikasi OTP dan membuat Ephemeral Session Token (1 Jam)
   */
  async verifyOtp(contractNumber: string, phone: string, code: string): Promise<CustomerSession> {
    const key = `${contractNumber}:${phone}`;
    const record = this.otps.get(key);

    if (!record) {
      throw new AppError("Permintaan OTP tidak ditemukan. Silakan minta kode baru.", 404, "OTP_NOT_FOUND");
    }

    if (Date.now() > record.expiresAt.getTime()) {
      this.otps.delete(key);
      throw new AppError("Kode OTP telah kedaluwarsa. Silakan minta kode baru.", 400, "OTP_EXPIRED");
    }

    if (record.attempts >= 3) {
      this.otps.delete(key);
      throw new AppError(
        "Batas percobaan OTP terlampaui (3 kali salah). Akun dikunci sementara demi keamanan.",
        403,
        "OTP_MAX_ATTEMPTS_EXCEEDED"
      );
    }

    if (record.code !== code.trim()) {
      record.attempts++;
      if (record.attempts >= 3) {
        this.otps.delete(key);
        throw new AppError(
          "Batas percobaan OTP terlampaui (3 kali salah). Akun dikunci sementara demi keamanan.",
          403,
          "OTP_MAX_ATTEMPTS_EXCEEDED"
        );
      }
      throw new AppError(
        `Kode OTP salah. Sisa kesempatan: ${3 - record.attempts} kali.`,
        400,
        "INVALID_OTP"
      );
    }

    // OTP Valid
    record.isVerified = true;
    this.otps.delete(key);

    // Buat session token 1 jam
    const token = `csess-${crypto.randomBytes(24).toString("hex")}`;
    const session: CustomerSession = {
      token,
      contractNumber,
      phone,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };

    this.activeSessions.set(token, session);
    return session;
  }

  /**
   * Memvalidasi apakah session token nasabah valid
   */
  validateSession(token: string): CustomerSession | null {
    const session = this.activeSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt.getTime()) {
      this.activeSessions.delete(token);
      return null;
    }
    return session;
  }
}
