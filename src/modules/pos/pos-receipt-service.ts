import { formatRupiah } from "@/shared/math/currency";

export interface PosReceiptData {
  storeName: string;
  storeAddress: string;
  storePhone?: string;
  orderNumber: string;
  cashierName: string;
  orderDate: Date;
  items: Array<{
    productName: string;
    variantName: string;
    unitPrice: bigint;
    quantity: number;
    discountAmount: bigint;
    lineTotal: bigint;
  }>;
  subtotal: bigint;
  orderDiscount: bigint;
  taxAmount: bigint;
  deliveryFee: bigint;
  roundingAdjustment?: bigint;
  grandTotal: bigint;
  paymentMethod: "CASH" | "QRIS" | "INTERNAL_CREDIT" | "BANK_TRANSFER";
  cashGiven?: bigint;
  changeReturned?: bigint;
  contractNumber?: string;
  notes?: string;
}

export interface DeliveryNoteData {
  deliveryId: string;
  orderNumber: string;
  storeName: string;
  storeAddress: string;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  scheduledDate: Date;
  driverName?: string;
  licensePlate?: string;
  assemblyRequired: boolean;
  assemblyNotes?: string;
  items: Array<{
    productName: string;
    variantName: string;
    dimensions?: string;
    quantity: number;
  }>;
}

export class PosReceiptService {
  private static readonly RECEIPT_WIDTH = 42;

  private static padLine(left: string, right: string, width = PosReceiptService.RECEIPT_WIDTH): string {
    const spaceCount = Math.max(1, width - left.length - right.length);
    return left + " ".repeat(spaceCount) + right;
  }

  private static centerText(text: string, width = PosReceiptService.RECEIPT_WIDTH): string {
    if (text.length >= width) return text.substring(0, width);
    const leftPad = Math.floor((width - text.length) / 2);
    const rightPad = width - text.length - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  }

  private static divider(char = "-", width = PosReceiptService.RECEIPT_WIDTH): string {
    return char.repeat(width);
  }

  /**
   * Generates ESC/POS compatible 42-column plain text receipt
   */
  static generatePosReceiptText(data: PosReceiptData): string {
    const lines: string[] = [];

    // Header
    lines.push(this.centerText(data.storeName.toUpperCase()));
    lines.push(this.centerText(data.storeAddress));
    if (data.storePhone) lines.push(this.centerText(`Telp: ${data.storePhone}`));
    lines.push(this.divider("="));

    // Metadata
    lines.push(this.padLine(`No: ${data.orderNumber}`, data.orderDate.toLocaleDateString("id-ID")));
    lines.push(this.padLine(`Kasir: ${data.cashierName}`, data.orderDate.toLocaleTimeString("id-ID")));
    lines.push(this.divider("-"));

    // Item List
    for (const item of data.items) {
      lines.push(`${item.productName}`);
      if (item.variantName) {
        lines.push(`  [${item.variantName}]`);
      }
      const qtyPrice = `  ${item.quantity} x ${formatRupiah(item.unitPrice)}`;
      const totalStr = formatRupiah(item.lineTotal);
      lines.push(this.padLine(qtyPrice, totalStr));

      if (item.discountAmount > 0n) {
        lines.push(this.padLine("  Diskon Item:", `-${formatRupiah(item.discountAmount)}`));
      }
    }
    lines.push(this.divider("-"));

    // Financial Totals
    lines.push(this.padLine("Subtotal:", formatRupiah(data.subtotal)));
    if (data.orderDiscount > 0n) {
      lines.push(this.padLine("Diskon Faktur:", `-${formatRupiah(data.orderDiscount)}`));
    }
    if (data.taxAmount > 0n) {
      lines.push(this.padLine("PPN (11%):", formatRupiah(data.taxAmount)));
    }
    if (data.deliveryFee > 0n) {
      lines.push(this.padLine("Ongkos Kirim:", formatRupiah(data.deliveryFee)));
    }
    if (data.roundingAdjustment && data.roundingAdjustment !== 0n) {
      lines.push(this.padLine("Pembulatan:", formatRupiah(data.roundingAdjustment)));
    }
    lines.push(this.divider("="));
    lines.push(this.padLine("TOTAL AKHIR:", formatRupiah(data.grandTotal)));
    lines.push(this.divider("-"));

    // Payment Section
    lines.push(this.padLine("Metode Bayar:", data.paymentMethod));
    if (data.paymentMethod === "CASH") {
      if (data.cashGiven !== undefined) {
        lines.push(this.padLine("Tunai Diterima:", formatRupiah(data.cashGiven)));
      }
      if (data.changeReturned !== undefined) {
        lines.push(this.padLine("Kembalian:", formatRupiah(data.changeReturned)));
      }
    } else if (data.paymentMethod === "INTERNAL_CREDIT" && data.contractNumber) {
      lines.push(this.padLine("No Kontrak Kredit:", data.contractNumber));
    }

    if (data.notes) {
      lines.push(this.divider("-"));
      lines.push(`Catatan: ${data.notes}`);
    }

    // Footer
    lines.push(this.divider("="));
    lines.push(this.centerText("Terima Kasih atas Kunjungan Anda"));
    lines.push(this.centerText("Barang yang dibeli bergaransi resmi"));
    lines.push(this.centerText("Simpan struk ini sebagai bukti transaksi"));

    return lines.join("\n");
  }

  /**
   * Generates Surat Jalan / Delivery Note plain text for logistics team & customer signature
   */
  static generateDeliveryNoteText(data: DeliveryNoteData): string {
    const lines: string[] = [];

    lines.push(this.centerText("SURAT JALAN PENGIRIMAN FURNITURE"));
    lines.push(this.centerText(data.storeName.toUpperCase()));
    lines.push(this.divider("="));

    lines.push(this.padLine(`No SJ : ${data.deliveryId.slice(0, 13)}`, `Tgl: ${data.scheduledDate.toLocaleDateString("id-ID")}`));
    lines.push(this.padLine(`No Order: ${data.orderNumber}`, `Armada: ${data.licensePlate || "-"}`));
    lines.push(this.padLine(`Supir : ${data.driverName || "-"}`, `Rakit: ${data.assemblyRequired ? "YA" : "TIDAK"}`));
    lines.push(this.divider("-"));

    lines.push("Penerima:");
    lines.push(`  Nama   : ${data.recipientName}`);
    lines.push(`  Telepon: ${data.recipientPhone}`);
    lines.push(`  Alamat : ${data.shippingAddress}`);
    if (data.assemblyNotes) {
      lines.push(`  Catatan: ${data.assemblyNotes}`);
    }
    lines.push(this.divider("-"));

    lines.push("DAFTAR BARANG YANG DIKIRIM:");
    data.items.forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.productName} [${item.variantName}]`);
      if (item.dimensions) {
        lines.push(`   Dimensi: ${item.dimensions}`);
      }
      lines.push(`   Kuantitas: ${item.quantity} Unit`);
    });
    lines.push(this.divider("="));

    lines.push("PERNYATAAN SERAH TERIMA:");
    lines.push("Barang telah diterima dalam kondisi baik, lengkap,");
    lines.push("dan telah diperiksa fisik/fungsinya.");
    lines.push("");
    lines.push(this.padLine("   Pengirim/Supir", "Penerima/Pelanggan   "));
    lines.push("");
    lines.push("");
    lines.push(this.padLine(" (               )", " (                 ) "));

    return lines.join("\n");
  }
}
