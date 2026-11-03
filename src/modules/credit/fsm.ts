import { AppError } from "@/shared/errors";

export type CreditContractStatus =
  | "DRAFT"
  | "DIAJUKAN"
  | "DISETUJUI"
  | "DITOLAK"
  | "AKTIF"
  | "LUNAS"
  | "MACET"
  | "DIBATALKAN";

export interface StatusTransitionRecord {
  fromStatus: CreditContractStatus;
  toStatus: CreditContractStatus;
  changedById: string;
  reason?: string;
  timestamp: Date;
}

export class InvalidStateTransitionError extends AppError {
  constructor(from: CreditContractStatus, to: CreditContractStatus, reason?: string) {
    super(
      `Transisi status tidak valid dari ${from} ke ${to}${reason ? ` (${reason})` : ""}`,
      422,
      "INVALID_STATE_TRANSITION"
    );
  }
}

/**
 * Matriks Transisi Status yang Legal untuk Kontrak Kredit Internal:
 * DRAFT -> DIAJUKAN, DIBATALKAN
 * DIAJUKAN -> DISETUJUI, DITOLAK, DIBATALKAN
 * DISETUJUI -> AKTIF (saat DP lunas & TTD), DIBATALKAN
 * DITOLAK -> [*] (Terminal, atau re-draft bila perbaikan berkas)
 * AKTIF -> LUNAS, MACET
 * MACET -> LUNAS (pelunasan sisa), DIBATALKAN (write-off/sita)
 * LUNAS -> [*] (Terminal)
 * DIBATALKAN -> [*] (Terminal)
 */
export const ALLOWED_CREDIT_TRANSITIONS: Record<CreditContractStatus, CreditContractStatus[]> = {
  DRAFT: ["DIAJUKAN", "DIBATALKAN"],
  DIAJUKAN: ["DISETUJUI", "DITOLAK", "DIBATALKAN"],
  DISETUJUI: ["AKTIF", "DIBATALKAN"],
  DITOLAK: ["DRAFT"], // Boleh kembali ke DRAFT jika pengajuan diperbaiki dengan dokumen baru
  AKTIF: ["LUNAS", "MACET"],
  MACET: ["LUNAS", "DIBATALKAN"],
  LUNAS: [], // Terminal State
  DIBATALKAN: [], // Terminal State
};

export class CreditContractStateMachine {
  /**
   * Memvalidasi apakah perpindahan status legal
   */
  static canTransition(from: CreditContractStatus, to: CreditContractStatus): boolean {
    const allowed = ALLOWED_CREDIT_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  /**
   * Menjalankan transisi status dengan verifikasi guard conditions
   */
  static transition(
    currentStatus: CreditContractStatus,
    targetStatus: CreditContractStatus,
    actorId: string,
    guards?: {
      isDownPaymentPaid?: boolean;
      isContractSigned?: boolean;
      hasOutstandingDebt?: boolean;
    },
    reason?: string
  ): StatusTransitionRecord {
    if (!this.canTransition(currentStatus, targetStatus)) {
      throw new InvalidStateTransitionError(currentStatus, targetStatus);
    }

    // Guard: Menuju AKTIF wajib DP lunas dan kontrak ditandatangani
    if (targetStatus === "AKTIF") {
      if (!guards?.isDownPaymentPaid) {
        throw new InvalidStateTransitionError(
          currentStatus,
          targetStatus,
          "Uang Muka (DP) belum lunas"
        );
      }
      if (!guards?.isContractSigned) {
        throw new InvalidStateTransitionError(
          currentStatus,
          targetStatus,
          "Kontrak belum ditandatangani oleh nasabah/staff"
        );
      }
    }

    // Guard: Menuju LUNAS dilarang jika masih ada sisa hutang pokok/margin/denda
    if (targetStatus === "LUNAS") {
      if (guards?.hasOutstandingDebt) {
        throw new InvalidStateTransitionError(
          currentStatus,
          targetStatus,
          "Masih terdapat sisa kewajiban piutang yang belum terbayar"
        );
      }
    }

    return {
      fromStatus: currentStatus,
      toStatus: targetStatus,
      changedById: actorId,
      reason,
      timestamp: new Date(),
    };
  }
}
