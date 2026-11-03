import { describe, it, expect } from "vitest";
import { calculateInstallmentSchedule } from "@/modules/credit/calculator";
import { roundDivBigInt, formatRupiah, parseRupiah } from "@/shared/math/currency";

describe("Credit Calculation Engine (Kalkulator Cicilan Bersama)", () => {
  it("harus menjamin total cicilan pokok dan margin persis sama dengan total kontrak tanpa selisih 1 rupiah pun", () => {
    // Harga Furniture ganjil: Rp 13.789.555, DP: Rp 2.500.000, Tenor: 7 bulan (angka prima)
    const result = calculateInstallmentSchedule({
      itemTotalAmount: 13789555n,
      downPaymentAmount: 2500000n,
      tenorMonths: 7,
      marginMethod: "FLAT_MONTHLY",
      marginRateBps: 225, // 2.25% per bulan
      adminFeeAmount: 150000n,
    });

    const expectedPrincipal = 13789555n - 2500000n; // 11.289.555
    expect(result.principalTotal).toBe(expectedPrincipal);

    // Hitung jumlah akumulasi dari seluruh angsuran
    let sumPrincipal = 0n;
    let sumMargin = 0n;
    let sumTotal = 0n;

    for (const inst of result.installments) {
      sumPrincipal += inst.principalDue;
      sumMargin += inst.marginDue;
      sumTotal += inst.totalDue;
      expect(inst.totalDue).toBe(inst.principalDue + inst.marginDue);
    }

    // Integritas Mutlak: Tidak boleh ada selisih bahkan 1 rupiah
    expect(sumPrincipal).toBe(result.principalTotal);
    expect(sumMargin).toBe(result.marginTotal);
    expect(sumTotal).toBe(result.totalCreditFinanced);
    expect(result.installments.length).toBe(7);
  });

  it("harus mengalokasikan selisih pembulatan ke angsuran terakhir", () => {
    // 10.000.000 / 3 bulan = 3.333.333,333...
    const result = calculateInstallmentSchedule({
      itemTotalAmount: 12000000n,
      downPaymentAmount: 2000000n, // Pokok = 10.000.000
      tenorMonths: 3,
      marginMethod: "ZERO_MARGIN",
      marginRateBps: 0,
      adminFeeAmount: 50000n,
    });

    expect(result.installments[0].principalDue).toBe(3333333n);
    expect(result.installments[1].principalDue).toBe(3333333n);
    // Angsuran terakhir harus 3.333.334 agar total pas 10.000.000
    expect(result.installments[2].principalDue).toBe(3333334n);

    const total =
      result.installments[0].principalDue +
      result.installments[1].principalDue +
      result.installments[2].principalDue;
    expect(total).toBe(10000000n);
  });

  it("harus menghitung skema FLAT_TOTAL dengan benar", () => {
    const result = calculateInstallmentSchedule({
      itemTotalAmount: 20000000n,
      downPaymentAmount: 5000000n, // Pokok = 15.000.000
      tenorMonths: 12,
      marginMethod: "FLAT_TOTAL",
      marginRateBps: 1000, // 10% total flat
      adminFeeAmount: 100000n,
    });

    expect(result.principalTotal).toBe(15000000n);
    expect(result.marginTotal).toBe(1500000n); // 10% dari 15jt = 1.500.000

    const sumPrincipal = result.installments.reduce((acc, i) => acc + i.principalDue, 0n);
    const sumMargin = result.installments.reduce((acc, i) => acc + i.marginDue, 0n);

    expect(sumPrincipal).toBe(15000000n);
    expect(sumMargin).toBe(1500000n);
  });

  it("harus menghitung skema EFFECTIVE_ANNUITY dan melunasi pokok tepat 0 di akhir tenor", () => {
    const result = calculateInstallmentSchedule({
      itemTotalAmount: 15000000n,
      downPaymentAmount: 3000000n, // Pokok = 12.000.000
      tenorMonths: 12,
      marginMethod: "EFFECTIVE_ANNUITY",
      marginRateBps: 175, // 1.75% per bulan
      adminFeeAmount: 100000n,
    });

    expect(result.installments[11].remainingPrincipal).toBe(0n);
    const sumPrincipal = result.installments.reduce((acc, i) => acc + i.principalDue, 0n);
    expect(sumPrincipal).toBe(12000000n);
  });

  it("Fuzz / Property-Based Test: 200 transaksi acak harus memiliki selisih pembulatan tepat 0 rupiah", () => {
    const methods = ["FLAT_MONTHLY", "FLAT_TOTAL", "EFFECTIVE_ANNUITY", "ZERO_MARGIN"] as const;

    for (let i = 0; i < 200; i++) {
      // Nominal acak dari Rp 1.000.000 s/d Rp 150.000.000 dengan angka ganjil/kriting
      const itemTotal = BigInt(Math.floor(Math.random() * 149000000) + 1000001);
      // DP acak antara 10% s/d 80% dari harga barang
      const dpPct = Math.floor(Math.random() * 70) + 10;
      const dpAmount = (itemTotal * BigInt(dpPct)) / 100n;
      // Tenor acak 1 s/d 36 bulan
      const tenor = Math.floor(Math.random() * 36) + 1;
      const method = methods[i % methods.length];
      const rateBps = Math.floor(Math.random() * 300) + 50; // 0.5% - 3.5%
      const adminFee = BigInt(Math.floor(Math.random() * 200000));

      const result = calculateInstallmentSchedule({
        itemTotalAmount: itemTotal,
        downPaymentAmount: dpAmount,
        tenorMonths: tenor,
        marginMethod: method,
        marginRateBps: rateBps,
        adminFeeAmount: adminFee,
      });

      const sumPrincipal = result.installments.reduce((acc, inst) => acc + inst.principalDue, 0n);
      const sumMargin = result.installments.reduce((acc, inst) => acc + inst.marginDue, 0n);
      const sumTotal = result.installments.reduce((acc, inst) => acc + inst.totalDue, 0n);

      expect(sumPrincipal).toBe(result.principalTotal);
      expect(sumMargin).toBe(result.marginTotal);
      expect(sumTotal).toBe(result.totalCreditFinanced);
      expect(result.installments.length).toBe(tenor);

      for (const inst of result.installments) {
        expect(inst.totalDue).toBe(inst.principalDue + inst.marginDue);
      }
    }
  });

  it("harus menolak input tidak valid (DP negatif, DP >= harga barang, tenor <= 0)", () => {
    expect(() =>
      calculateInstallmentSchedule({
        itemTotalAmount: 10000000n,
        downPaymentAmount: -1000n,
        tenorMonths: 6,
        marginMethod: "FLAT_MONTHLY",
        marginRateBps: 200,
        adminFeeAmount: 0n,
      })
    ).toThrowError(/tidak boleh negatif/);

    expect(() =>
      calculateInstallmentSchedule({
        itemTotalAmount: 10000000n,
        downPaymentAmount: 10000000n,
        tenorMonths: 6,
        marginMethod: "FLAT_MONTHLY",
        marginRateBps: 200,
        adminFeeAmount: 0n,
      })
    ).toThrowError(/tidak boleh melebihi/);

    expect(() =>
      calculateInstallmentSchedule({
        itemTotalAmount: 10000000n,
        downPaymentAmount: 2000000n,
        tenorMonths: 0,
        marginMethod: "FLAT_MONTHLY",
        marginRateBps: 200,
        adminFeeAmount: 0n,
      })
    ).toThrowError(/lebih besar dari 0 bulan/);
  });
});

describe("Integer Currency Math", () => {
  it("harus membulatkan integer dengan Round Half-Up tanpa float drift", () => {
    // 5 / 2 = 2.5 -> dibulatkan ke 3
    expect(roundDivBigInt(5n, 2n)).toBe(3n);
    // 4 / 2 = 2
    expect(roundDivBigInt(4n, 2n)).toBe(2n);
    // 10 / 3 = 3.333 -> 3
    expect(roundDivBigInt(10n, 3n)).toBe(3n);
  });

  it("harus memformat Rupiah dengan tepat", () => {
    expect(formatRupiah(15000000n)).toBe("Rp 15.000.000");
    expect(formatRupiah(250000)).toBe("Rp 250.000");
  });

  it("harus mem-parse string Rupiah menjadi BigInt", () => {
    expect(parseRupiah("Rp 15.500.000")).toBe(15500000n);
    expect(parseRupiah("1000000")).toBe(1000000n);
    expect(parseRupiah(500000)).toBe(500000n);
  });
});
