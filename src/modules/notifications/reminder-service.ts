export type ReminderStage = "H_MINUS_3" | "H_ZERO" | "H_PLUS_1" | "H_PLUS_7";

export interface ReminderPayload {
  customerName: string;
  phone: string;
  contractNumber: string;
  installmentNumber: number;
  dueDate: Date;
  totalDue: bigint;
  stage: ReminderStage;
  qrisPaymentUrl?: string;
}

export interface ReminderDeliveryResult {
  messageId: string;
  recipientPhone: string;
  status: "SENT" | "FAILED";
  timestamp: Date;
}

export interface NotificationGateway {
  sendWhatsApp(phone: string, message: string): Promise<ReminderDeliveryResult>;
}

export class MockNotificationGateway implements NotificationGateway {
  public sentMessages: Array<{ phone: string; message: string; timestamp: Date }> = [];

  async sendWhatsApp(phone: string, message: string): Promise<ReminderDeliveryResult> {
    const record = { phone, message, timestamp: new Date() };
    this.sentMessages.push(record);
    return {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      recipientPhone: phone,
      status: "SENT",
      timestamp: record.timestamp,
    };
  }
}

export class ReminderService {
  private sentHistory = new Set<string>(); // Set of `${installmentId}:${stage}:${dateStr}`

  constructor(private gateway: NotificationGateway = new MockNotificationGateway()) {}

  /**
   * Mengirim notifikasi pengingat secara idempotent
   */
  async dispatchReminder(installmentId: string, payload: ReminderPayload): Promise<boolean> {
    const todayStr = new Date().toISOString().slice(0, 10);
    const deduplicationKey = `${installmentId}:${payload.stage}:${todayStr}`;

    if (this.sentHistory.has(deduplicationKey)) {
      // Sudah dikirim hari ini untuk stage yang sama -> abaikan
      return false;
    }

    const message = this.buildMessageTemplate(payload);
    await this.gateway.sendWhatsApp(payload.phone, message);

    this.sentHistory.add(deduplicationKey);
    return true;
  }

  private buildMessageTemplate(payload: ReminderPayload): string {
    const formattedDue = payload.dueDate.toLocaleDateString("id-ID", { dateStyle: "long" });

    switch (payload.stage) {
      case "H_MINUS_3":
        return `Halo Bpk/Ibu ${payload.customerName}, mengingatkan tagihan cicilan furniture Anda No. Kontrak ${payload.contractNumber} (Angsuran #${payload.installmentNumber}) sebesar Rp ${payload.totalDue.toString()} akan jatuh tempo pada ${formattedDue}. Terima kasih.`;
      case "H_ZERO":
        return `Halo Bpk/Ibu ${payload.customerName}, hari ini adalah tanggal jatuh tempo angsuran #${payload.installmentNumber} kontrak ${payload.contractNumber} sebesar Rp ${payload.totalDue.toString()}. Silakan lakukan pembayaran via QRIS atau kasir toko kami.`;
      case "H_PLUS_1":
        return `PERINGATAN: Halo Bpk/Ibu ${payload.customerName}, angsuran #${payload.installmentNumber} kontrak ${payload.contractNumber} telah melewati tanggal jatuh tempo (${formattedDue}). Mohon segera lakukan pembayaran sebelum masa tenggang denda berakhir.`;
      case "H_PLUS_7":
        return `PEMBERITAHUAN TUNGGAKAN: Tagihan angsuran #${payload.installmentNumber} kontrak ${payload.contractNumber} telah menunggak lebih dari 7 hari dan denda keterlambatan harian mulai berjalan. Harap segera hubungi customer service kami.`;
    }
  }

  getHistory(): string[] {
    return Array.from(this.sentHistory);
  }
}
