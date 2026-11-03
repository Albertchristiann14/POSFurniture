import { describe, it, expect, beforeEach } from "vitest";
import { ShiftService, InMemoryShiftRepository } from "@/modules/pos/shift-service";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Fase 7: POS Shift Management & Cash Drawer Reconciliation", () => {
  let shiftRepo: InMemoryShiftRepository;
  let auditLogger: AuditLogger;
  let shiftService: ShiftService;

  const tenantId = "tenant-pos-1";
  const outletId = "outlet-jakarta";
  const userId = "cashier-budi";

  beforeEach(() => {
    shiftRepo = new InMemoryShiftRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    shiftService = new ShiftService(shiftRepo, auditLogger);
  });

  it("Membuka shift dengan modal awal kas yang valid", async () => {
    const shift = await shiftService.openShift(tenantId, outletId, userId, 500000n);

    expect(shift.id).toBeDefined();
    expect(shift.startCashAmount).toBe(500000n);
    expect(shift.totalCashSales).toBe(0n);
    expect(shift.closedAt).toBeUndefined();
  });

  it("Menolak membuka dua shift aktif bersamaan untuk kasir yang sama", async () => {
    await shiftService.openShift(tenantId, outletId, userId, 500000n);

    await expect(
      shiftService.openShift(tenantId, outletId, userId, 300000n)
    ).rejects.toThrow("Kasir masih memiliki shift aktif yang belum ditutup");
  });

  it("Mencatat mutasi kas kecil operasional (CASH_IN dan CASH_OUT/EXPENSE)", async () => {
    const shift = await shiftService.openShift(tenantId, outletId, userId, 500000n);

    // Kasir terima uang receh kembalian tambahan dari brankas utama
    await shiftService.recordCashMovement(
      tenantId,
      shift.id,
      userId,
      "CASH_IN",
      200000n,
      "Tambahan uang pecahan Rp 2.000 & Rp 5.000"
    );

    // Kasir beli lakban & spidol packing furniture
    await shiftService.recordCashMovement(
      tenantId,
      shift.id,
      userId,
      "EXPENSE",
      35000n,
      "Beli lakban coklat & bubble wrap kecil"
    );

    const fetched = await shiftRepo.findShiftById(shift.id);
    expect(fetched?.cashMovements.length).toBe(2);
    expect(fetched?.cashMovements[0].amount).toBe(200000n);
    expect(fetched?.cashMovements[1].amount).toBe(-35000n);
  });

  it("Menghitung rekonsiliasi kas tutup shift secara presisi (Penjualan Tunai + DP Kredit + Angsuran + Petty Cash)", async () => {
    const shift = await shiftService.openShift(tenantId, outletId, userId, 500000n); // Modal: 500.000

    // 1. Penjualan langsung tunai di kasir: Rp 1.500.000
    await shiftService.recordSalePayment(shift.id, "CASH", 1500000n);

    // 2. Pembayaran non-tunai (QRIS): Rp 3.000.000 (tidak masuk laci kas fisik)
    await shiftService.recordSalePayment(shift.id, "QRIS", 3000000n);

    // 3. Pelanggan setor Uang Muka (DP) kredit toko secara tunai di kasir: Rp 2.000.000
    await shiftService.recordCreditDownPaymentCash(shift.id, 2000000n);

    // 4. Nasabah kredit bayar cicilan bulanan secara tunai di kasir: Rp 850.000
    await shiftService.recordInstallmentPaymentCash(shift.id, 850000n);

    // 5. Kasir keluar uang operasional beli makan siang tim gudang: Rp 100.000
    await shiftService.recordCashMovement(
      tenantId,
      shift.id,
      userId,
      "CASH_OUT",
      100000n,
      "Konsumsi tim bongkar muat"
    );

    // Expected Cash di laci:
    // Modal Awal: 500.000
    // + Penjualan Tunai: 1.500.000
    // + DP Kredit Tunai: 2.000.000
    // + Angsuran Tunai:   850.000
    // - Pengeluaran Kas:  100.000
    // = Total Diharapkan: 4.750.000
    const expectedCash = 500000n + 1500000n + 2000000n + 850000n - 100000n; // 4.750.000

    // Kasir hitung fisik uang dan pas Rp 4.750.000
    const closedShift = await shiftService.closeShift(
      tenantId,
      shift.id,
      userId,
      4750000n,
      "Kas laci cocok dan seimbang"
    );

    expect(closedShift.closedAt).toBeDefined();
    expect(closedShift.endCashCalculated).toBe(expectedCash);
    expect(closedShift.endCashActual).toBe(4750000n);
    expect(closedShift.discrepancy).toBe(0n); // Balanced
    expect(closedShift.totalQrisSales).toBe(3000000n);
  });

  it("Mendeteksi selisih kas fisik (discrepancy surplus dan defisit)", async () => {
    // Kasus Selisih Kurang (Defisit)
    const shiftDeficit = await shiftService.openShift(tenantId, outletId, "cashier-2", 300000n);
    await shiftService.recordSalePayment(shiftDeficit.id, "CASH", 700000n);
    // Expected: 1.000.000, Fisik: 980.000 -> discrepancy: -20.000
    const closedDeficit = await shiftService.closeShift(tenantId, shiftDeficit.id, "cashier-2", 980000n);
    expect(closedDeficit.discrepancy).toBe(-20000n);

    // Kasus Selisih Lebih (Surplus)
    const shiftSurplus = await shiftService.openShift(tenantId, outletId, "cashier-3", 300000n);
    await shiftService.recordSalePayment(shiftSurplus.id, "CASH", 700000n);
    // Expected: 1.000.000, Fisik: 1.015.000 -> discrepancy: +15.000
    const closedSurplus = await shiftService.closeShift(tenantId, shiftSurplus.id, "cashier-3", 1015000n);
    expect(closedSurplus.discrepancy).toBe(15000n);
  });
});

