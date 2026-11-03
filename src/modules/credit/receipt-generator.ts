import { formatRupiah } from "@/shared/math/currency";

export interface InstallmentReceiptData {
  tenantName: string;
  tenantAddress: string;
  tenantPhone?: string;
  receiptNumber: string;
  paymentDate: Date;
  cashierName: string;
  customerName: string;
  customerNikMasked: string;
  contractNumber: string;
  installmentNumbersPaid: number[];
  paymentMethod: "CASH" | "QRIS_DYNAMIC" | "BANK_TRANSFER_MANUAL";
  amountPaid: bigint;
  cashGiven?: bigint | null;
  changeReturned?: bigint | null;
  allocatedPrincipal: bigint;
  allocatedMargin: bigint;
  allocatedPenalty: bigint;
  remainingPrincipalDebt: bigint;
  remainingPenaltyDebt: bigint;
  contractStatusAfterPayment: string;
}

export class ReceiptGenerator {
  /**
   * Menghasilkan teks struk monospaced yang ramah untuk Thermal Printer 58mm / 80mm (ESC/POS)
   */
  static generateThermalText(data: InstallmentReceiptData): string {
    const divider = "------------------------------------------";
    const doubleDivider = "==========================================";

    const padLine = (left: string, right: string, width = 42): string => {
      const space = Math.max(1, width - left.length - right.length);
      return left + " ".repeat(space) + right;
    };

    const lines: string[] = [
      centerText(data.tenantName.toUpperCase(), 42),
      centerText(data.tenantAddress, 42),
      data.tenantPhone ? centerText(`Telp: ${data.tenantPhone}`, 42) : "",
      doubleDivider,
      padLine("No. Struk :", data.receiptNumber),
      padLine("Tanggal   :", data.paymentDate.toLocaleString("id-ID")),
      padLine("Kasir     :", data.cashierName),
      divider,
      padLine("Konsumen  :", data.customerName),
      padLine("NIK       :", data.customerNikMasked),
      padLine("No Kontrak:", data.contractNumber),
      padLine("Angsuran  :", `Bulan #${data.installmentNumbersPaid.join(", #")}`),
      padLine("Metode    :", data.paymentMethod),
      divider,
      "RINCIAN PEMBAYARAN:",
      padLine("  Alokasi Denda   :", formatRupiah(data.allocatedPenalty)),
      padLine("  Alokasi Margin  :", formatRupiah(data.allocatedMargin)),
      padLine("  Alokasi Pokok   :", formatRupiah(data.allocatedPrincipal)),
      divider,
      padLine("TOTAL DIBAYAR     :", formatRupiah(data.amountPaid)),
      data.cashGiven
        ? padLine("Uang Tunai Diterima:", formatRupiah(data.cashGiven))
        : "",
      data.changeReturned
        ? padLine("Kembalian         :", formatRupiah(data.changeReturned))
        : "",
      doubleDivider,
      "SISA KEWAJIBAN PIUTANG:",
      padLine("  Sisa Pokok Hutang :", formatRupiah(data.remainingPrincipalDebt)),
      padLine("  Sisa Denda        :", formatRupiah(data.remainingPenaltyDebt)),
      padLine("  Status Kontrak    :", data.contractStatusAfterPayment),
      doubleDivider,
      centerText("TERIMA KASIH ATAS PEMBAYARAN ANDA", 42),
      centerText("Simpan struk ini sebagai bukti pembayaran sah", 42),
      "\n\n",
    ];

    return lines.filter((l) => l !== "").join("\n");
  }

  /**
   * Menghasilkan HTML struk digital yang rapi untuk ditampilkan di browser / mobile
   */
  static generateDigitalReceiptHtml(data: InstallmentReceiptData): string {
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Struk Pembayaran ${data.receiptNumber}</title>
  <style>
    body { font-family: monospace; background: #f8fafc; padding: 16px; color: #0f172a; }
    .receipt { max-width: 360px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    h2 { text-align: center; margin: 0; font-size: 16px; }
    p { margin: 4px 0; font-size: 12px; }
    .divider { border-bottom: 1px dashed #cbd5e1; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
    .bold { font-weight: bold; }
    .highlight { color: #047857; font-weight: bold; }
  </style>
</head>
<body>
  <div class="receipt">
    <h2>${data.tenantName}</h2>
    <p style="text-align: center; color: #64748b;">${data.tenantAddress}</p>
    <div class="divider"></div>
    <div class="row"><span>No. Struk</span><span class="bold">${data.receiptNumber}</span></div>
    <div class="row"><span>Tanggal</span><span>${data.paymentDate.toLocaleString("id-ID")}</span></div>
    <div class="row"><span>No. Kontrak</span><span class="bold">${data.contractNumber}</span></div>
    <div class="row"><span>Konsumen</span><span>${data.customerName}</span></div>
    <div class="row"><span>Angsuran</span><span>#${data.installmentNumbersPaid.join(", #")}</span></div>
    <div class="divider"></div>
    <div class="row"><span>Alokasi Denda</span><span>${formatRupiah(data.allocatedPenalty)}</span></div>
    <div class="row"><span>Alokasi Margin</span><span>${formatRupiah(data.allocatedMargin)}</span></div>
    <div class="row"><span>Alokasi Pokok</span><span>${formatRupiah(data.allocatedPrincipal)}</span></div>
    <div class="divider"></div>
    <div class="row bold" style="font-size: 14px;"><span>Total Bayar</span><span class="highlight">${formatRupiah(data.amountPaid)}</span></div>
    <div class="divider"></div>
    <div class="row"><span>Sisa Pokok</span><span class="bold">${formatRupiah(data.remainingPrincipalDebt)}</span></div>
    <div class="row"><span>Status Kontrak</span><span class="bold">${data.contractStatusAfterPayment}</span></div>
    <p style="text-align: center; margin-top: 20px; font-size: 11px; color: #64748b;">Terima kasih atas pembayaran Anda</p>
  </div>
</body>
</html>`;
  }
}

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const leftPad = Math.floor((width - text.length) / 2);
  const rightPad = width - text.length - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

