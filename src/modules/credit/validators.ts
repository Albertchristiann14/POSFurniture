import { z } from "zod";

const INDONESIAN_PHONE_REGEX = /^(\+62|62|0)8[1-9][0-9]{6,10}$/;
const NIK_REGEX = /^[1-9][0-9]{15}$/; // 16 digit angka, tidak diawali 0

export const CreateCreditCustomerSchema = z.object({
  nik: z.string().regex(NIK_REGEX, "NIK harus berupa 16 digit angka yang valid"),
  fullName: z.string().min(3, "Nama lengkap minimal 3 karakter").max(100),
  phone: z.string().regex(INDONESIAN_PHONE_REGEX, "Nomor HP tidak valid (format: 08xx / +628xx)"),
  addressKtp: z.string().min(10, "Alamat KTP minimal 10 karakter"),
  addressDom: z.string().min(10, "Alamat domisili minimal 10 karakter"),
  occupation: z.string().min(2, "Pekerjaan wajib diisi"),
  monthlyIncome: z.union([z.bigint(), z.number(), z.string()]).transform((val) => {
    const b = BigInt(val.toString().replace(/[^0-9]/g, ""));
    if (b <= 0n) throw new Error("Penghasilan bulanan harus lebih besar dari 0");
    return b;
  }),
  creditLimit: z
    .union([z.bigint(), z.number(), z.string()])
    .optional()
    .transform((val) => (val ? BigInt(val.toString().replace(/[^0-9]/g, "")) : 15000000n)),
  emergencyContact: z.object({
    name: z.string().min(3, "Nama kontak darurat minimal 3 karakter"),
    relation: z.string().min(2, "Hubungan kontak darurat wajib diisi"),
    phone: z.string().regex(INDONESIAN_PHONE_REGEX, "Nomor HP kontak darurat tidak valid"),
  }),
  guarantor: z
    .object({
      name: z.string().min(3),
      nik: z.string().regex(NIK_REGEX, "NIK penjamin harus 16 digit").optional(),
      phone: z.string().regex(INDONESIAN_PHONE_REGEX),
      relation: z.string().min(2),
    })
    .optional(),
  pdpConsent: z.literal(true, {
    errorMap: () => ({ message: "Persetujuan pemrosesan data pribadi (UU PDP) wajib dicentang" }),
  }),
});

export type CreateCreditCustomerInput = z.infer<typeof CreateCreditCustomerSchema>;

export const CreateCreditSchemeSchema = z.object({
  name: z.string().min(3, "Nama skema minimal 3 karakter").max(100),
  tenorMonths: z.number().int().min(1, "Tenor minimal 1 bulan").max(60, "Tenor maksimal 60 bulan"),
  marginMethod: z.enum(["FLAT_MONTHLY", "FLAT_TOTAL", "EFFECTIVE_ANNUITY", "ZERO_MARGIN"]),
  marginRateBps: z.number().int().min(0).max(5000, "Margin maksimal 50% (5000 bps)"),
  minDownPaymentPct: z.number().int().min(0).max(90, "Minimal DP maksimal 90%"),
  adminFeeAmount: z.union([z.bigint(), z.number(), z.string()]).transform((val) => {
    return BigInt(val.toString().replace(/[^0-9]/g, "") || "0");
  }),
  penaltyType: z.enum(["DAILY_PERCENTAGE", "DAILY_FIXED_AMOUNT", "ONE_TIME_FIXED"]),
  penaltyRateBps: z.number().int().min(0).max(1000).default(0),
  penaltyFixedFee: z.union([z.bigint(), z.number(), z.string()]).transform((val) => {
    return BigInt(val.toString().replace(/[^0-9]/g, "") || "0");
  }),
  gracePeriodDays: z.number().int().min(0).max(30).default(3),
  maxPenaltyCapPct: z.number().int().min(0).max(100).default(20),
  isActive: z.boolean().default(true),
});

export type CreateCreditSchemeInput = z.infer<typeof CreateCreditSchemeSchema>;

export const SimulationRequestSchema = z.object({
  itemTotalAmount: z.union([z.bigint(), z.number(), z.string()]).transform((val) => {
    const b = BigInt(val.toString().replace(/[^0-9]/g, ""));
    if (b <= 0n) throw new Error("Total harga barang harus lebih besar dari 0");
    return b;
  }),
  downPaymentAmount: z.union([z.bigint(), z.number(), z.string()]).transform((val) => {
    return BigInt(val.toString().replace(/[^0-9]/g, "") || "0");
  }),
  tenorMonths: z.number().int().min(1).max(60),
  schemeId: z.string().min(1).optional(),
  // Inline overrides jika simulasi kustom
  marginMethod: z.enum(["FLAT_MONTHLY", "FLAT_TOTAL", "EFFECTIVE_ANNUITY", "ZERO_MARGIN"]).optional(),
  marginRateBps: z.number().int().min(0).optional(),
  adminFeeAmount: z
    .union([z.bigint(), z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? BigInt(val.toString().replace(/[^0-9]/g, "") || "0") : undefined)),
});

export type SimulationRequestInput = z.infer<typeof SimulationRequestSchema>;

export const DocumentTypeEnum = z.enum(["KTP", "SELFIE_KTP", "SLIP_GAJI", "KARTU_KELUARGA"]);
export type DocumentType = z.infer<typeof DocumentTypeEnum>;

export const UploadDocumentValidationSchema = z.object({
  documentType: DocumentTypeEnum,
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"], {
    errorMap: () => ({ message: "Format dokumen harus berupa JPEG, PNG, atau PDF" }),
  }),
  fileSizeBytes: z.number().max(5 * 1024 * 1024, "Ukuran file dokumen maksimal 5 MB"),
});
