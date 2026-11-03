"use client";

import React, { useState, useMemo } from "react";
import { calculateInstallmentSchedule } from "@/modules/credit/calculator";
import { formatRupiah } from "@/shared/math/currency";

export default function CreditSimulatorPage() {
  const [itemPrice, setItemPrice] = useState<number>(15000000);
  const [dpPercentage, setDpPercentage] = useState<number>(20);
  const [tenorMonths, setTenorMonths] = useState<number>(12);
  const [marginMethod, setMarginMethod] = useState<
    "FLAT_MONTHLY" | "FLAT_TOTAL" | "EFFECTIVE_ANNUITY" | "ZERO_MARGIN"
  >("FLAT_MONTHLY");
  const [marginRatePct, setMarginRatePct] = useState<number>(2.0); // 2.0% = 200 bps
  const [adminFee, setAdminFee] = useState<number>(100000);

  const dpAmount = useMemo(() => {
    return Math.round((itemPrice * dpPercentage) / 100);
  }, [itemPrice, dpPercentage]);

  const calculation = useMemo(() => {
    try {
      return calculateInstallmentSchedule({
        itemTotalAmount: BigInt(itemPrice),
        downPaymentAmount: BigInt(dpAmount),
        tenorMonths,
        marginMethod,
        marginRateBps: Math.round(marginRatePct * 100),
        adminFeeAmount: BigInt(adminFee),
      });
    } catch {
      return null;
    }
  }, [itemPrice, dpAmount, tenorMonths, marginMethod, marginRatePct, adminFee]);

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="border-b border-slate-800 pb-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded">
                Krevia POS • Furniture Edition
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold mt-2 text-white">
                Simulator Cicilan Internal Toko
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Kalkulator cicilan terpadu. Perhitungan di showroom identik 100% dengan kontrak resmi.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-emerald-900/30 border border-emerald-700/50 text-emerald-300 px-3 py-2 rounded-lg text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Integritas Moneter: Tanpa Float • Selisih 0 Rupiah</span>
            </div>
          </div>
        </header>

        {/* Form and Summary Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Controls Panel */}
          <div className="lg:col-span-5 bg-slate-800/80 border border-slate-700 rounded-xl p-6 space-y-6">
            <h2 className="text-lg font-semibold text-white border-b border-slate-700 pb-3">
              Parameter Simulasi
            </h2>

            {/* Harga Barang */}
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <label className="text-slate-300 font-medium">Harga Furniture</label>
                <span className="text-emerald-400 font-bold font-mono">
                  {formatRupiah(itemPrice)}
                </span>
              </div>
              <input
                type="range"
                min={2000000}
                max={50000000}
                step={500000}
                value={itemPrice}
                onChange={(e) => setItemPrice(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1 font-mono">
                <span>Rp 2 Juta</span>
                <span>Rp 50 Juta</span>
              </div>
            </div>

            {/* Uang Muka / DP */}
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <label className="text-slate-300 font-medium">
                  Uang Muka (DP: {dpPercentage}%)
                </label>
                <span className="text-amber-400 font-bold font-mono">
                  {formatRupiah(dpAmount)}
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={70}
                step={5}
                value={dpPercentage}
                onChange={(e) => setDpPercentage(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1 font-mono">
                <span>10%</span>
                <span>70%</span>
              </div>
            </div>

            {/* Pilihan Tenor */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Pilihan Tenor Cicilan
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[3, 6, 9, 12, 18, 24].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTenorMonths(t)}
                    className={`py-2 text-sm font-semibold rounded-lg border transition ${
                      tenorMonths === t
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/30"
                        : "bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    {t} Bulan
                  </button>
                ))}
              </div>
            </div>

            {/* Metode Margin */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Metode Margin Keuntungan
              </label>
              <select
                value={marginMethod}
                onChange={(e) => setMarginMethod(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="FLAT_MONTHLY">Flat per Bulan (Standar Retail)</option>
                <option value="FLAT_TOTAL">Flat Total dari Pokok</option>
                <option value="EFFECTIVE_ANNUITY">Efektif Anuitas (Perbankan)</option>
                <option value="ZERO_MARGIN">Bunga 0% (Promo Khusus)</option>
              </select>
            </div>

            {/* Margin Rate & Admin Fee */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Margin Rate (%/Bln)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  value={marginRatePct}
                  disabled={marginMethod === "ZERO_MARGIN"}
                  onChange={(e) => setMarginRatePct(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg p-2 text-sm font-mono focus:border-emerald-500 focus:outline-none disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Biaya Admin (Rp)
                </label>
                <input
                  type="number"
                  step="10000"
                  min="0"
                  value={adminFee}
                  onChange={(e) => setAdminFee(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg p-2 text-sm font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Results & Schedule */}
          <div className="lg:col-span-7 space-y-6">
            {calculation ? (
              <>
                {/* Hero Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-700/60 rounded-xl p-5">
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                      Angsuran Bulanan
                    </span>
                    <div className="text-3xl font-extrabold text-white mt-1 font-mono">
                      {formatRupiah(calculation.monthlyInstallmentEstimate)}
                    </div>
                    <span className="text-xs text-slate-400 mt-1 block">
                      selama {tenorMonths} bulan
                    </span>
                  </div>

                  <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-5 space-y-2">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Pokok Pembiayaan:</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {formatRupiah(calculation.principalTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Total Margin Toko:</span>
                      <span className="font-mono text-emerald-400 font-semibold">
                        {formatRupiah(calculation.marginTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Biaya Admin (di muka):</span>
                      <span className="font-mono text-slate-200">
                        {formatRupiah(calculation.adminFeeAmount)}
                      </span>
                    </div>
                    <div className="border-t border-slate-700 pt-2 flex justify-between text-sm font-bold text-white">
                      <span>Total Bayar:</span>
                      <span className="font-mono text-amber-400">
                        {formatRupiah(
                          calculation.totalCreditFinanced + calculation.downPaymentAmount + calculation.adminFeeAmount
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Schedule Table */}
                <div className="bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="font-semibold text-white text-sm">
                      Jadwal & Rincian Angsuran
                    </h3>
                    <span className="text-xs text-emerald-400 font-mono">
                      {calculation.installments.length} Bulan Cicilan
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider sticky top-0 font-medium">
                        <tr>
                          <th className="py-2.5 px-4">Ke</th>
                          <th className="py-2.5 px-4">Jatuh Tempo</th>
                          <th className="py-2.5 px-4 text-right">Pokok</th>
                          <th className="py-2.5 px-4 text-right">Margin</th>
                          <th className="py-2.5 px-4 text-right">Total Angsuran</th>
                          <th className="py-2.5 px-4 text-right">Sisa Pokok</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/60 font-mono">
                        {calculation.installments.map((row) => (
                          <tr
                            key={row.installmentNumber}
                            className="hover:bg-slate-700/30 transition"
                          >
                            <td className="py-2 px-4 text-slate-400 font-bold">
                              #{row.installmentNumber}
                            </td>
                            <td className="py-2 px-4 text-slate-300">
                              {new Date(row.dueDate).toLocaleDateString("id-ID", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </td>
                            <td className="py-2 px-4 text-right text-slate-200">
                              {formatRupiah(row.principalDue)}
                            </td>
                            <td className="py-2 px-4 text-right text-emerald-400">
                              {formatRupiah(row.marginDue)}
                            </td>
                            <td className="py-2 px-4 text-right font-bold text-white">
                              {formatRupiah(row.totalDue)}
                            </td>
                            <td className="py-2 px-4 text-right text-slate-400">
                              {formatRupiah(row.remainingPrincipal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-8 text-center text-slate-400 text-sm">
                Parameter tidak valid. Pastikan uang muka tidak melebihi harga furniture.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

