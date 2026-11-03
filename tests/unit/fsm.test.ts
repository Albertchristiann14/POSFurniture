import { describe, it, expect } from "vitest";
import {
  CreditContractStateMachine,
  InvalidStateTransitionError,
} from "@/modules/credit/fsm";

describe("Credit Contract State Machine (FSM)", () => {
  const actor = "user-test-1";

  it("harus mengizinkan alur transisi status yang valid (Happy Path)", () => {
    // 1. DRAFT -> DIAJUKAN
    const t1 = CreditContractStateMachine.transition("DRAFT", "DIAJUKAN", actor);
    expect(t1.fromStatus).toBe("DRAFT");
    expect(t1.toStatus).toBe("DIAJUKAN");

    // 2. DIAJUKAN -> DISETUJUI
    const t2 = CreditContractStateMachine.transition("DIAJUKAN", "DISETUJUI", actor);
    expect(t2.toStatus).toBe("DISETUJUI");

    // 3. DISETUJUI -> AKTIF (dengan DP lunas & ttd)
    const t3 = CreditContractStateMachine.transition(
      "DISETUJUI",
      "AKTIF",
      actor,
      { isDownPaymentPaid: true, isContractSigned: true }
    );
    expect(t3.toStatus).toBe("AKTIF");

    // 4. AKTIF -> LUNAS (tanpa sisa hutang)
    const t4 = CreditContractStateMachine.transition(
      "AKTIF",
      "LUNAS",
      actor,
      { hasOutstandingDebt: false }
    );
    expect(t4.toStatus).toBe("LUNAS");
  });

  it("harus menolak aktivasi kontrak jika DP belum lunas atau belum ditandatangani", () => {
    // DP belum lunas
    expect(() =>
      CreditContractStateMachine.transition("DISETUJUI", "AKTIF", actor, {
        isDownPaymentPaid: false,
        isContractSigned: true,
      })
    ).toThrow(InvalidStateTransitionError);

    // Belum ditandatangani
    expect(() =>
      CreditContractStateMachine.transition("DISETUJUI", "AKTIF", actor, {
        isDownPaymentPaid: true,
        isContractSigned: false,
      })
    ).toThrow(InvalidStateTransitionError);
  });

  it("harus menolak pelunasan jika masih ada sisa tunggakan hutang", () => {
    expect(() =>
      CreditContractStateMachine.transition("AKTIF", "LUNAS", actor, {
        hasOutstandingDebt: true,
      })
    ).toThrow(/sisa kewajiban/);
  });

  it("harus menolak lompatan status ilegal (DRAFT langsung ke AKTIF, LUNAS ke AKTIF)", () => {
    expect(() =>
      CreditContractStateMachine.transition("DRAFT", "AKTIF", actor)
    ).toThrow(InvalidStateTransitionError);

    expect(() =>
      CreditContractStateMachine.transition("DISETUJUI", "LUNAS", actor)
    ).toThrow(InvalidStateTransitionError);

    // Terminal state LUNAS tidak bisa berubah ke status lain
    expect(() =>
      CreditContractStateMachine.transition("LUNAS", "AKTIF", actor)
    ).toThrow(InvalidStateTransitionError);

    // Terminal state DIBATALKAN tidak bisa berubah
    expect(() =>
      CreditContractStateMachine.transition("DIBATALKAN", "AKTIF", actor)
    ).toThrow(InvalidStateTransitionError);
  });

  it("harus mengizinkan pengajuan ditolak kembali ke DRAFT jika diperbaiki dengan dokumen baru", () => {
    const t = CreditContractStateMachine.transition("DITOLAK", "DRAFT", actor, undefined, "Perbaikan slip gaji");
    expect(t.toStatus).toBe("DRAFT");
    expect(t.reason).toBe("Perbaikan slip gaji");
  });
});
