import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 sm:p-12">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Hero */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 bg-emerald-950/80 border border-emerald-800 text-emerald-400 px-3 py-1 rounded-full text-xs font-semibold tracking-wide">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>KREVIA POS • TOKO FURNITURE & MODUL KREDIT INTERNAL</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Sistem POS Multi-Tenant &amp; Pembiayaan Mandiri
          </h1>
          <p className="text-base sm:text-lg text-slate-400 max-w-3xl">
            Arsitektur tingkat industri dengan jaminan kebenaran data moneter, isolasi multi-tenant,
            enkripsi data nasabah (UU PDP), pembukuan double-entry append-only ledger, dan alur logistik
            gudang furniture.
          </p>
        </div>

        {/* Feature Badges & Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-950 border border-emerald-800/80 flex items-center justify-center text-emerald-400 font-bold">
              01
            </div>
            <h3 className="font-semibold text-white text-base">Integritas Keuangan Murni</h3>
            <p className="text-sm text-slate-400">
              Uang dihitung dalam integer Rupiah (tanpa float). Simulator dan kontrak menggunakan satu
              kalkulator bersama dengan selisih pembulatan tepat 0 Rupiah.
            </p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-amber-950 border border-amber-800/80 flex items-center justify-center text-amber-400 font-bold">
              02
            </div>
            <h3 className="font-semibold text-white text-base">Enkripsi At-Rest (UU PDP)</h3>
            <p className="text-sm text-slate-400">
              NIK, alamat, dan nomor HP dienkripsi menggunakan AES-256-GCM. Pencarian NIK unik menggunakan
              HMAC-SHA256 Blind Index dengan salt per-tenant.
            </p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400 font-bold">
              03
            </div>
            <h3 className="font-semibold text-white text-base">Double-Entry Append-Only</h3>
            <p className="text-sm text-slate-400">
              Setiap transaksi finansial (kontrak, DP, cicilan, denda) dibukukan ke jurnal berpasangan
              (Debit = Kredit). Data historis abadi tanpa mutasi sembarangan.
            </p>
          </div>
        </div>

        {/* Action Link to Simulator */}
        <div className="bg-gradient-to-r from-emerald-950/80 to-slate-900 border border-emerald-700/60 rounded-2xl p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white">Simulator Cicilan Showroom</h2>
            <p className="text-sm text-slate-300">
              Uji coba kalkulasi cicilan dengan berbagai tenor, margin, dan pembulatan real-time.
            </p>
          </div>
          <Link
            href="/simulator"
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-3 rounded-xl transition shadow-lg shadow-emerald-500/20"
          >
            <span>Buka Simulator Cicilan</span>
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        {/* Phase Progress Checklist */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-white text-sm uppercase tracking-wider text-slate-400">
            Status Progres Fase Krevia POS
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Fase K1: Fondasi, Nasabah, Skema, Simulator (SELESAI)</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>Fase K2: Pengajuan, Approval, Kontrak PDF, DP</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>Fase K3: Ledger Double-Entry, Jadwal, Denda Harian</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>Fase K4: Pembayaran Angsuran, QRIS, Alokasi</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>Fase K5: Penagihan, Aging Piutang, Audit Log</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>Fase K6: Hardening, Uji Beban, Verifikasi Final</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
