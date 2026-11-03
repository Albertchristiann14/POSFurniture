export type LedgerAccountCode =
  | "KAS_BANK" // 1010 - Kas & Bank
  | "PIUTANG_POKOK" // 1110 - Piutang Pokok Pembiayaan
  | "PIUTANG_DENDA" // 1120 - Piutang Denda Keterlambatan
  | "TITIPAN_PELANGGAN" // 2010 - Uang Muka / Titipan Kelebihan Bayar Konsumen
  | "MARGIN_DITANGGUHKAN" // 2110 - Pendapatan Margin Ditangguhkan (Bunga Masa Depan)
  | "PENDAPATAN_PENJUALAN" // 4010 - Pendapatan Penjualan Furniture
  | "PENDAPATAN_MARGIN" // 4110 - Pendapatan Margin Kredit Terealisasi
  | "PENDAPATAN_ADMIN" // 4120 - Pendapatan Biaya Administrasi
  | "PENDAPATAN_DENDA" // 4130 - Pendapatan Denda Keterlambatan Terealisasi
  | "BEBAN_HAPUS_PIUTANG" // 6010 - Beban Piutang Macet / Write-off
  | "BEBAN_DISKON_PELUNASAN_AWAL"; // 6020 - Beban Diskon Pelunasan Dipercepat

export type AccountCategory = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type NormalBalance = "DEBIT" | "CREDIT";

export interface AccountDefinition {
  code: LedgerAccountCode;
  accountNumber: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
}

export const CHART_OF_ACCOUNTS: Record<LedgerAccountCode, AccountDefinition> = {
  KAS_BANK: {
    code: "KAS_BANK",
    accountNumber: "1010",
    name: "Kas & Bank (Pembayaran Tunai / QRIS)",
    category: "ASSET",
    normalBalance: "DEBIT",
  },
  PIUTANG_POKOK: {
    code: "PIUTANG_POKOK",
    accountNumber: "1110",
    name: "Piutang Pembiayaan Pokok Konsumen",
    category: "ASSET",
    normalBalance: "DEBIT",
  },
  PIUTANG_DENDA: {
    code: "PIUTANG_DENDA",
    accountNumber: "1120",
    name: "Piutang Denda Keterlambatan",
    category: "ASSET",
    normalBalance: "DEBIT",
  },
  TITIPAN_PELANGGAN: {
    code: "TITIPAN_PELANGGAN",
    accountNumber: "2010",
    name: "Titipan / Kelebihan Bayar Konsumen",
    category: "LIABILITY",
    normalBalance: "CREDIT",
  },
  MARGIN_DITANGGUHKAN: {
    code: "MARGIN_DITANGGUHKAN",
    accountNumber: "2110",
    name: "Pendapatan Margin Ditangguhkan",
    category: "LIABILITY",
    normalBalance: "CREDIT",
  },
  PENDAPATAN_PENJUALAN: {
    code: "PENDAPATAN_PENJUALAN",
    accountNumber: "4010",
    name: "Pendapatan Penjualan Furniture",
    category: "REVENUE",
    normalBalance: "CREDIT",
  },
  PENDAPATAN_MARGIN: {
    code: "PENDAPATAN_MARGIN",
    accountNumber: "4110",
    name: "Pendapatan Margin Kredit",
    category: "REVENUE",
    normalBalance: "CREDIT",
  },
  PENDAPATAN_ADMIN: {
    code: "PENDAPATAN_ADMIN",
    accountNumber: "4120",
    name: "Pendapatan Biaya Administrasi Kredit",
    category: "REVENUE",
    normalBalance: "CREDIT",
  },
  PENDAPATAN_DENDA: {
    code: "PENDAPATAN_DENDA",
    accountNumber: "4130",
    name: "Pendapatan Denda Keterlambatan",
    category: "REVENUE",
    normalBalance: "CREDIT",
  },
  BEBAN_HAPUS_PIUTANG: {
    code: "BEBAN_HAPUS_PIUTANG",
    accountNumber: "6010",
    name: "Beban Penghapusan Piutang Macet",
    category: "EXPENSE",
    normalBalance: "DEBIT",
  },
  BEBAN_DISKON_PELUNASAN_AWAL: {
    code: "BEBAN_DISKON_PELUNASAN_AWAL",
    accountNumber: "6020",
    name: "Beban Diskon Pelunasan Dipercepat",
    category: "EXPENSE",
    normalBalance: "DEBIT",
  },
};

