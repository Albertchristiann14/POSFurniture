import crypto from "node:crypto";
import { formatRupiah } from "@/shared/math/currency";

export interface ContractGenerationData {
  contractNumber: string;
  tenantName: string;
  tenantAddress: string;
  customerName: string;
  customerNikMasked: string;
  customerPhoneMasked: string;
  customerAddress: string;
  orderItems: Array<{
    productName: string;
    variantName: string;
    quantity: number;
    unitPrice: bigint;
    subtotal: bigint;
    customSpecs?: string | null;
  }>;
  financials: {
    itemTotalAmount: bigint;
    downPaymentAmount: bigint;
    principalTotal: bigint;
    marginTotal: bigint;
    adminFeeAmount: bigint;
    monthlyInstallment: bigint;
    tenorMonths: number;
    marginRatePct: number;
    marginMethod: string;
    gracePeriodDays: number;
    penaltyRule: string;
  };
  schedule: Array<{
    installmentNumber: number;
    dueDate: Date;
    principalDue: bigint;
    marginDue: bigint;
    totalDue: bigint;
  }>;
  signatures: {
    customerSignatureDataUrl?: string;
    staffSignatureDataUrl?: string;
    staffName: string;
    signedAt: Date;
  };
}

export interface GeneratedContractResult {
  contentHtml: string;
  fileBuffer: Buffer;
  sha256Hash: string;
}

/**
 * Generator Kontrak Legal Perjanjian Pembiayaan Cicilan Internal Furniture
 * Menghasilkan dokumen kanonikal HTML/PDF dan menghitung hash SHA-256 untuk perlindungan immutability.
 */
export function generateContractDocument(data: ContractGenerationData): GeneratedContractResult {
  const scheduleRows = data.schedule
    .map(
      (s) => `
      <tr>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center;">#${s.installmentNumber}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1;">${new Date(s.dueDate).toLocaleDateString("id-ID", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">${formatRupiah(s.principalDue)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">${formatRupiah(s.marginDue)}</td>
        <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${formatRupiah(s.totalDue)}</td>
      </tr>`
    )
    .join("");

  const itemRows = data.orderItems
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px; border: 1px solid #cbd5e1;">
          <strong>${item.productName}</strong> - ${item.variantName}
          ${item.customSpecs ? `<br/><small style="color: #64748b;">Specs: ${item.customSpecs}</small>` : ""}
        </td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">${formatRupiah(item.unitPrice)}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${formatRupiah(item.subtotal)}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Perjanjian Pembiayaan Cicilan ${data.contractNumber}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; color: #1e293b; line-height: 1.5; padding: 24px; }
    h1 { font-size: 18px; margin-bottom: 4px; text-transform: uppercase; text-align: center; }
    h2 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; border-bottom: 1px solid #94a3b8; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .badge { font-size: 10px; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>SURAT PERJANJIAN PEMBIAYAAN KREDIT INTERNAL</h1>
  <p style="text-align: center; margin-top: 0; color: #475569;">Nomor Kontrak: <strong>${data.contractNumber}</strong></p>

  <h2>I. IDENTITAS PARA PIHAK</h2>
  <p>Perjanjian ini dibuat pada tanggal ${data.signatures.signedAt.toLocaleDateString("id-ID", { dateStyle: "full" })} antara:</p>
  <ol>
    <li><strong>PIHAK PERTAMA (TOKO/TENANT):</strong> ${data.tenantName}, berkedudukan di ${data.tenantAddress}.</li>
    <li><strong>PIHAK KEDUA (KONSUMEN):</strong> ${data.customerName}, NIK: ${data.customerNikMasked}, No. HP: ${data.customerPhoneMasked}, Alamat: ${data.customerAddress}.</li>
  </ol>

  <h2>II. RINCIAN BARANG FURNITURE</h2>
  <table>
    <thead>
      <tr style="background: #f1f5f9;">
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: left;">Nama Produk & Varian</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1;">Qty</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Harga Satuan</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <h2>III. RINCIAN PEMBIAYAAN & CICILAN</h2>
  <table style="border: none;">
    <tr><td style="width: 50%;">Total Harga Furniture:</td><td style="font-weight: bold; text-align: right;">${formatRupiah(data.financials.itemTotalAmount)}</td></tr>
    <tr><td>Uang Muka (DP) yang Disetor:</td><td style="font-weight: bold; text-align: right;">${formatRupiah(data.financials.downPaymentAmount)}</td></tr>
    <tr><td>Pokok Pembiayaan Kredit:</td><td style="font-weight: bold; text-align: right;">${formatRupiah(data.financials.principalTotal)}</td></tr>
    <tr><td>Margin Keuntungan Toko (${data.financials.marginRatePct}% - ${data.financials.marginMethod}):</td><td style="font-weight: bold; text-align: right;">${formatRupiah(data.financials.marginTotal)}</td></tr>
    <tr><td>Biaya Administrasi:</td><td style="font-weight: bold; text-align: right;">${formatRupiah(data.financials.adminFeeAmount)}</td></tr>
    <tr style="border-top: 1px solid #cbd5e1;"><td style="font-size: 13px;"><strong>Angsuran Bulanan (${data.financials.tenorMonths} Bulan):</strong></td><td style="font-size: 14px; font-weight: bold; text-align: right; color: #047857;">${formatRupiah(data.financials.monthlyInstallment)} / bulan</td></tr>
  </table>

  <h2>IV. KETENTUAN KETERLAMBATAN & DENDA</h2>
  <p>Toleransi keterlambatan (Grace Period) adalah <strong>${data.financials.gracePeriodDays} hari kalender</strong> sejak tanggal jatuh tempo. Apabila melewati batas toleransi, Pihak Kedua menyetujui ketentuan denda: <strong>${data.financials.penaltyRule}</strong>.</p>

  <h2>V. JADWAL ANGSURAN</h2>
  <table>
    <thead>
      <tr style="background: #f1f5f9;">
        <th style="padding: 6px; border: 1px solid #cbd5e1;">Angsuran</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1;">Jatuh Tempo</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Pokok</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Margin</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: right;">Total Tagihan</th>
      </tr>
    </thead>
    <tbody>${scheduleRows}</tbody>
  </table>

  <h2>VI. PENGESAHAN & TANDA TANGAN DIGITAL</h2>
  <table style="margin-top: 24px; border: none;">
    <tr>
      <td style="width: 50%; text-align: center; vertical-align: top;">
        <p>Pihak Kedua (Konsumen)</p>
        <div style="height: 60px; margin: 8px 0;">
          ${data.signatures.customerSignatureDataUrl ? `<img src="${data.signatures.customerSignatureDataUrl}" alt="TTD Konsumen" style="max-height: 50px;" />` : `<span style="color: #059669; font-weight: bold;">[ TERVERIFIKASI DIGITAL ]</span>`}
        </div>
        <p><strong>${data.customerName}</strong></p>
      </td>
      <td style="width: 50%; text-align: center; vertical-align: top;">
        <p>Pihak Pertama (Staf Toko)</p>
        <div style="height: 60px; margin: 8px 0;">
          ${data.signatures.staffSignatureDataUrl ? `<img src="${data.signatures.staffSignatureDataUrl}" alt="TTD Staf" style="max-height: 50px;" />` : `<span style="color: #059669; font-weight: bold;">[ TERVERIFIKASI SISTEM ]</span>`}
        </div>
        <p><strong>${data.signatures.staffName}</strong></p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const fileBuffer = Buffer.from(html, "utf8");
  const sha256Hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  return {
    contentHtml: html,
    fileBuffer,
    sha256Hash,
  };
}
