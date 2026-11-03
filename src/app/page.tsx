import Link from "next/link";
import { ShoppingCart, Calculator, ShieldCheck, Database, Layers, CheckCircle2 } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 sm:p-12 font-sans">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Hero */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 bg-emerald-950/80 border border-emerald-800 text-emerald-400 px-3 py-1 rounded-full text-xs font-semibold tracking-wide">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>KREVIA POS • TOKO FURNITURE &amp; MODUL KREDIT INTERNAL</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Sistem POS Multi-Tenant &amp; Pembiayaan Mandiri
          </h1>
          <p className="text-base sm:text-lg text-slate-400 max-w-3xl leading-relaxed">
            Arsitektur tingkat enterprise dengan jaminan kebenaran data moneter (zero-float Rupiah), isolasi
            multi-tenant, enkripsi data pribadi nasabah (UU PDP), pembukuan double-entry append-only ledger,
            rekonsiliasi laci kasir, dan alur pengiriman armada furniture.
          </p>
        </div>

        {/* Quick Launchpad Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Card 1: Kasir POS */}
          <div className="bg-gradient-to-br from-emerald-950/90 via-slate-900 to-slate-900 border border-emerald-600/50 rounded-2xl p-7 flex flex-col justify-between space-y-5 shadow-lg shadow-emerald-950/40 group hover:border-emerald-500 transition">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <ShoppingCart className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold text-white">Aplikasi Kasir POS Showroom</h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Tampilan kasir landscape tablet &amp; desktop. Checkout tunai (hitung kembalian), QRIS
                dinamis, integrasi kredit toko, pengiriman armada furniture, dan cetak struk thermal ESC/POS.
              </p>
            </div>
            <Link
              href="/pos"
              className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-3 rounded-xl transition shadow-md"
            >
              <span>Buka Kasir POS Furniture</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>

          {/* Card 2: Simulator Kredit */}
          <div className="bg-gradient-to-br from-indigo-950/90 via-slate-900 to-slate-900 border border-indigo-600/50 rounded-2xl p-7 flex flex-col justify-between space-y-5 shadow-lg shadow-indigo-950/40 group hover:border-indigo-500 transition">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                <Calculator className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold text-white">Simulator Cicilan Internal</h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Kalkulator cicilan showroom mandiri tanpa leasing pihak ketiga. Simulasi metode Flat Bulanan,
                Flat Total, Anuitas Efektif, dan Nol Margin dengan selisih pembulatan 0 rupiah.
              </p>
            </div>
            <Link
              href="/simulator"
              className="inline-flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-400 text-slate-950 font-bold px-6 py-3 rounded-xl transition shadow-md"
            >
              <span>Buka Simulator Kredit</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>

        {/* Feature Badges & Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-950 border border-emerald-800/80 flex items-center justify-center text-emerald-400 font-bold">
              01
            </div>
            <h3 className="font-semibold text-white text-base">Integritas Keuangan Murni</h3>
            <p className="text-sm text-slate-400">
              Semua perhitungan uang menggunakan integer Rupiah murni (BigInt) dengan pembulatan Round Half-Up.
              Nol selisih satu rupiah pun.
            </p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-amber-950 border border-amber-800/80 flex items-center justify-center text-amber-400 font-bold">
              02
            </div>
            <h3 className="font-semibold text-white text-base">Enkripsi At-Rest (UU PDP)</h3>
            <p className="text-sm text-slate-400">
              NIK, alamat, dan nomor HP dienkripsi AES-256-GCM. Pencarian NIK unik menggunakan HMAC-SHA256
              Blind Index dengan salt khusus per tenant.
            </p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400 font-bold">
              03
            </div>
            <h3 className="font-semibold text-white text-base">Double-Entry Append-Only</h3>
            <p className="text-sm text-slate-400">
              Setiap transaksi finansial (kontrak, DP, cicilan, denda) dibukukan ke jurnal berpasangan
              (Debit == Kredit). Saldo piutang selalu terbukti matematis.
            </p>
          </div>
        </div>

        {/* Phase Progress Checklist */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white text-sm uppercase tracking-wider text-slate-400">
              Status Implementasi Lengkap (Fase 1 - 7)
            </h3>
            <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full font-bold">
              100% SELESAI &amp; TERVERIFIKASI
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase K1: Nasabah, Enkripsi PDP, Skema &amp; Simulator</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase K2: Pengajuan, Approval Limit, PDF Kontrak, DP</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase K3: Ledger Double-Entry, Maintenance Denda Harian</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase K4: Pembayaran Angsuran, Alokasi, OTP Portal</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase K5: Penagihan PTP, Aging OJK Kol 1-5, Restrukturisasi</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase K6: Hardening, Stress Test Ledger, Backup Enkripsi</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400 font-medium sm:col-span-2 md:col-span-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fase 7: Core POS Retail Furniture, Katalog, Reservasi Stok, Delivery Order, Shift Kasir &amp; Struk Thermal</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
