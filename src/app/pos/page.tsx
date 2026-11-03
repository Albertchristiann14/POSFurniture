"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Truck,
  CreditCard,
  Banknote,
  QrCode,
  ShieldCheck,
  CheckCircle2,
  Printer,
  FileText,
  Store,
  Clock,
  Layers,
  Search,
} from "lucide-react";
import { formatRupiah } from "@/shared/math/currency";

interface ProductCatalogItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  dimensions: string;
  material: string;
  warranty: number;
  isCreditEligible: boolean;
  basePrice: number;
  stock: number;
  image: string;
}

const SAMPLE_PRODUCTS: ProductCatalogItem[] = [
  {
    id: "prod-1",
    name: "Sofa 3 Dudukan Chesterfield",
    sku: "SOF-CHEST-03",
    category: "Sofa & Ruang Tamu",
    dimensions: "220 x 95 x 80 cm",
    material: "Solid Teak & Kulit Sintetis Premium",
    warranty: 24,
    isCreditEligible: true,
    basePrice: 5500000,
    stock: 4,
    image: "🛋️",
  },
  {
    id: "prod-2",
    name: "Meja Makan Jati Minimalis 6 Kursi",
    sku: "TBL-TEAK-06",
    category: "Ruang Makan",
    dimensions: "180 x 90 x 76 cm",
    material: "Kayu Jati Solid Grade A",
    warranty: 36,
    isCreditEligible: true,
    basePrice: 6800000,
    stock: 3,
    image: "🪑",
  },
  {
    id: "prod-3",
    name: "Tempat Tidur Queen Size Scandinavia",
    sku: "BED-SCAN-Q160",
    category: "Kamar Tidur",
    dimensions: "160 x 200 x 110 cm",
    material: "Mahoni & Fabric Headboard",
    warranty: 12,
    isCreditEligible: true,
    basePrice: 4200000,
    stock: 5,
    image: "🛏️",
  },
  {
    id: "prod-4",
    name: "Lemari Pakaian 3 Pintu Sliding",
    sku: "WDR-SLID-03",
    category: "Kamar Tidur",
    dimensions: "180 x 60 x 210 cm",
    material: "Plywood Laminasi HPL Taco",
    warranty: 12,
    isCreditEligible: true,
    basePrice: 4950000,
    stock: 2,
    image: "🚪",
  },
  {
    id: "prod-5",
    name: "Meja Kerja Ergonomis Kayu Solid",
    sku: "DSK-ERGO-01",
    category: "Ruang Kerja",
    dimensions: "140 x 70 x 75 cm",
    material: "Solid Sungkai & Rangka Besi Powder Coating",
    warranty: 24,
    isCreditEligible: true,
    basePrice: 2850000,
    stock: 8,
    image: "🖥️",
  },
  {
    id: "prod-6",
    name: "Bantal Sofa Dacron Lembut (Set of 2)",
    sku: "ACC-PLW-02",
    category: "Aksesoris",
    dimensions: "45 x 45 cm",
    material: "Siliconized Dacron & Sarung Linen",
    warranty: 0,
    isCreditEligible: false,
    basePrice: 150000,
    stock: 25,
    image: "✨",
  },
];

interface CartItem {
  product: ProductCatalogItem;
  quantity: number;
  discount: number;
}

export default function PosCashierPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("Semua");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState<number>(0);
  const [includeDelivery, setIncludeDelivery] = useState<boolean>(false);
  const [deliveryFee, setDeliveryFee] = useState<number>(150000);
  const [recipientName, setRecipientName] = useState<string>("");
  const [recipientPhone, setRecipientPhone] = useState<string>("");
  const [shippingAddress, setShippingAddress] = useState<string>("");
  const [assemblyRequired, setAssemblyRequired] = useState<boolean>(true);

  // Payment states
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "QRIS" | "INTERNAL_CREDIT">("CASH");
  const [cashGiven, setCashGiven] = useState<number>(0);

  // Credit installment states
  const [creditTenor, setCreditTenor] = useState<number>(6);
  const [creditMarginPct, setCreditMarginPct] = useState<number>(1.5);
  const [creditDpAmount, setCreditDpAmount] = useState<number>(0);

  // Checkout Success Modal
  const [successReceipt, setSuccessReceipt] = useState<{
    orderNumber: string;
    grandTotal: number;
    paymentMethod: string;
    cashGiven?: number;
    changeReturned?: number;
    qrisReference?: string;
    creditContractNumber?: string;
    monthlyInstallment?: number;
    items: CartItem[];
    subtotal: number;
    taxAmount: number;
    deliveryFee: number;
    includeDelivery: boolean;
  } | null>(null);

  // Categories
  const categories = ["Semua", "Sofa & Ruang Tamu", "Ruang Makan", "Kamar Tidur", "Ruang Kerja", "Aksesoris"];

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return SAMPLE_PRODUCTS.filter((p) => {
      const matchCat = selectedCategory === "Semua" || p.category === selectedCategory;
      const matchSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.material.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [selectedCategory, searchQuery]);

  // Cart Management
  const addToCart = (product: ProductCatalogItem) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          alert(`Stok maksimal ${product.name} tercapai (${product.stock} unit)`);
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1, discount: 0 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.product.id === productId) {
            const nextQty = item.quantity + delta;
            if (nextQty <= 0) return null;
            if (nextQty > item.product.stock) {
              alert(`Stok maksimal ${item.product.name} adalah ${item.product.stock}`);
              return item;
            }
            return { ...item, quantity: nextQty };
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Financial Calculations
  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.product.basePrice * item.quantity - item.discount, 0);
  }, [cart]);

  const orderDiscount = useMemo(() => {
    return Math.round((subtotal * orderDiscountPercent) / 100);
  }, [subtotal, orderDiscountPercent]);

  const taxableAmount = Math.max(0, subtotal - orderDiscount);
  const taxAmount = Math.round(taxableAmount * 0.11); // PPN 11%
  const currentDeliveryFee = includeDelivery ? deliveryFee : 0;
  const grandTotal = taxableAmount + taxAmount + currentDeliveryFee;

  // Credit calculation
  const defaultMinDp = Math.round(grandTotal * 0.2); // DP minimal 20%
  const actualDp = creditDpAmount > 0 ? creditDpAmount : defaultMinDp;
  const principalDebt = Math.max(0, grandTotal - actualDp);
  const totalMargin = Math.round((principalDebt * (creditMarginPct / 100) * creditTenor));
  const totalContract = principalDebt + totalMargin;
  const monthlyInstallment = creditTenor > 0 ? Math.round(totalContract / creditTenor) : 0;

  // Change returned
  const changeReturned = Math.max(0, cashGiven - grandTotal);

  const handleCheckout = () => {
    if (cart.length === 0) {
      alert("Keranjang belanja masih kosong!");
      return;
    }

    if (includeDelivery && (!recipientName || !shippingAddress)) {
      alert("Mohon isi Nama Penerima dan Alamat Pengiriman untuk layanan delivery!");
      return;
    }

    if (paymentMethod === "CASH" && cashGiven < grandTotal) {
      alert("Nominal uang tunai yang diberikan kasir kurang dari total tagihan!");
      return;
    }

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

    setSuccessReceipt({
      orderNumber,
      grandTotal,
      paymentMethod,
      cashGiven: paymentMethod === "CASH" ? cashGiven : undefined,
      changeReturned: paymentMethod === "CASH" ? changeReturned : undefined,
      qrisReference: paymentMethod === "QRIS" ? `MOCK-QRIS-${Date.now().toString().slice(-6)}` : undefined,
      creditContractNumber: paymentMethod === "INTERNAL_CREDIT" ? `KTR-261103-${Math.floor(Math.random() * 9000 + 1000)}` : undefined,
      monthlyInstallment: paymentMethod === "INTERNAL_CREDIT" ? monthlyInstallment : undefined,
      items: [...cart],
      subtotal,
      taxAmount,
      deliveryFee: currentDeliveryFee,
      includeDelivery,
    });

    // Reset cart
    setCart([]);
    setCashGiven(0);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Header */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-lg">
            🛋️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base text-white">KREVIA POS • TOKO FURNITURE</h1>
              <span className="bg-emerald-950 border border-emerald-800 text-emerald-400 text-xs px-2 py-0.5 rounded font-mono">
                OUTLET FATMAWATI
              </span>
            </div>
            <p className="text-xs text-slate-400">Kasir: Dewi Santoso • Shift #04 (Modal: Rp 1.000.000)</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
          >
            Beranda
          </Link>
          <Link
            href="/simulator"
            className="px-3 py-1.5 rounded-lg border border-emerald-800 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 font-medium transition"
          >
            Simulator Kredit
          </Link>
          <div className="bg-slate-800/80 border border-slate-700/80 px-3 py-1.5 rounded-lg text-slate-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono">Live Showroom POS</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden">
        {/* Left: Product Catalog & Filter (7 Cols) */}
        <div className="lg:col-span-7 xl:col-span-8 p-6 space-y-6 overflow-y-auto border-r border-slate-800/80">
          {/* Search and Category Filters */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari sofa, meja jati, lemari, SKU, atau material..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition placeholder:text-slate-500"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                    selectedCategory === cat
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredProducts.map((p) => {
              const inCart = cart.find((item) => item.product.id === p.id);
              return (
                <div
                  key={p.id}
                  className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition shadow-sm group"
                >
                  <div className="space-y-3">
                    <div className="h-28 bg-slate-950 rounded-xl flex items-center justify-center text-4xl border border-slate-800/60 group-hover:scale-105 transition-transform duration-300">
                      {p.image}
                    </div>

                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <h3 className="font-semibold text-slate-100 text-sm line-clamp-1">{p.name}</h3>
                      </div>
                      <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                    </div>

                    <div className="text-[11px] text-slate-400 space-y-0.5 border-t border-slate-800/60 pt-2">
                      <p className="line-clamp-1">📏 {p.dimensions}</p>
                      <p className="line-clamp-1">🪵 {p.material}</p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {p.isCreditEligible ? (
                        <span className="bg-emerald-950 border border-emerald-800/80 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-medium">
                          Cicilan Toko ✓
                        </span>
                      ) : (
                        <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded">
                          Cash Only
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 ml-auto font-mono">
                        Stok: <span className={p.stock <= 2 ? "text-amber-400 font-bold" : "text-emerald-400"}>{p.stock}</span>
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between gap-2 mt-3">
                    <div>
                      <span className="text-xs text-slate-400">Harga Tunai:</span>
                      <p className="font-bold text-sm text-emerald-400">{formatRupiah(p.basePrice)}</p>
                    </div>

                    <button
                      onClick={() => addToCart(p)}
                      disabled={p.stock <= 0}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium text-xs transition flex items-center gap-1.5 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{inCart ? `(${inCart.quantity})` : "Tambah"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Cart, Logistics & Checkout Panel (5 Cols) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-slate-900/60 flex flex-col h-full border-l border-slate-800/80 overflow-y-auto">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-emerald-400" />
              <h2 className="font-bold text-sm text-white">Keranjang Pesanan ({cart.length})</h2>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-red-400 hover:text-red-300 transition"
              >
                Kosongkan
              </button>
            )}
          </div>

          {/* Cart Item List */}
          <div className="p-5 space-y-3 flex-1 overflow-y-auto max-h-[320px]">
            {cart.length === 0 ? (
              <div className="text-center py-10 text-slate-500 space-y-2">
                <ShoppingCart className="w-8 h-8 mx-auto stroke-1" />
                <p className="text-xs">Keranjang masih kosong. Klik item furniture untuk menambahkan.</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.product.id}
                  className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="font-semibold text-slate-200 line-clamp-1">{item.product.name}</p>
                    <p className="text-emerald-400 font-mono">{formatRupiah(item.product.basePrice)}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-slate-700 bg-slate-900 rounded-lg overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.product.id, -1)}
                        className="p-1 hover:bg-slate-800 text-slate-300"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2 font-mono font-bold text-slate-100">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.product.id, 1)}
                        className="p-1 hover:bg-slate-800 text-slate-300"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Logistics & Delivery Options */}
          <div className="p-5 border-t border-slate-800/80 bg-slate-950/40 space-y-3 text-xs">
            <label className="flex items-center gap-2.5 cursor-pointer font-medium text-slate-200">
              <input
                type="checkbox"
                checked={includeDelivery}
                onChange={(e) => setIncludeDelivery(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              <span className="flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-amber-400" />
                <span>Pengiriman &amp; Perakitan Armada Toko (+Rp 150.000)</span>
              </span>
            </label>

            {includeDelivery && (
              <div className="space-y-2 pt-2 border-t border-slate-800/60 animate-in fade-in duration-200">
                <input
                  type="text"
                  placeholder="Nama Lengkap Penerima"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  placeholder="Nomor Telepon / WhatsApp"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
                <textarea
                  placeholder="Alamat Pengiriman Lengkap (Rumah/Apartemen/Lantai)"
                  rows={2}
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="p-5 border-t border-slate-800/80 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Metode Pembayaran</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <button
                onClick={() => setPaymentMethod("CASH")}
                className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === "CASH"
                    ? "bg-emerald-950/80 border-emerald-500 text-emerald-300 font-bold"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <Banknote className="w-4 h-4" />
                <span>Tunai</span>
              </button>

              <button
                onClick={() => setPaymentMethod("QRIS")}
                className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === "QRIS"
                    ? "bg-sky-950/80 border-sky-500 text-sky-300 font-bold"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <QrCode className="w-4 h-4" />
                <span>QRIS</span>
              </button>

              <button
                onClick={() => setPaymentMethod("INTERNAL_CREDIT")}
                className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === "INTERNAL_CREDIT"
                    ? "bg-indigo-950/80 border-indigo-500 text-indigo-300 font-bold"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Kredit Toko</span>
              </button>
            </div>

            {/* Cash Input */}
            {paymentMethod === "CASH" && (
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Nominal Uang Tunai:</span>
                  <button
                    onClick={() => setCashGiven(grandTotal)}
                    className="text-[11px] text-emerald-400 hover:underline"
                  >
                    Uang Pas
                  </button>
                </div>
                <input
                  type="number"
                  placeholder="Jumlah uang diterima..."
                  value={cashGiven || ""}
                  onChange={(e) => setCashGiven(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
                />
                <div className="flex items-center justify-between text-slate-300 pt-1">
                  <span>Kembalian:</span>
                  <span className="font-mono font-bold text-amber-400">{formatRupiah(changeReturned)}</span>
                </div>
              </div>
            )}

            {/* QRIS Dynamic Preview */}
            {paymentMethod === "QRIS" && (
              <div className="bg-slate-950 border border-sky-900/60 rounded-xl p-3 text-center space-y-2 text-xs">
                <div className="w-24 h-24 mx-auto bg-white p-2 rounded-lg flex items-center justify-center">
                  <QrCode className="w-20 h-20 text-slate-950" />
                </div>
                <p className="text-[11px] text-sky-400 font-mono">Dynamic QRIS Midtrans Adapter</p>
                <p className="text-[10px] text-slate-400">Expiry 15 Menit • Menunggu Notifikasi Webhook</p>
              </div>
            )}

            {/* Internal Credit Options */}
            {paymentMethod === "INTERNAL_CREDIT" && (
              <div className="bg-slate-950 border border-indigo-900/60 rounded-xl p-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Pilih Tenor:</span>
                  <div className="flex gap-1.5">
                    {[3, 6, 12].map((m) => (
                      <button
                        key={m}
                        onClick={() => setCreditTenor(m)}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition ${
                          creditTenor === m ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {m} Bln
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <span>DP Minimal (20%):</span>
                  <span className="font-mono font-bold text-emerald-400">{formatRupiah(defaultMinDp)}</span>
                </div>

                <div className="flex items-center justify-between text-slate-300">
                  <span>Angsuran per Bulan:</span>
                  <span className="font-mono font-bold text-indigo-400">{formatRupiah(monthlyInstallment)} / bln</span>
                </div>
              </div>
            )}
          </div>

          {/* Pricing Totals & Checkout Button */}
          <div className="p-5 border-t border-slate-800 bg-slate-950 space-y-3">
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Subtotal Item:</span>
                <span className="font-mono text-slate-200">{formatRupiah(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>PPN 11%:</span>
                <span className="font-mono text-slate-200">{formatRupiah(taxAmount)}</span>
              </div>
              {includeDelivery && (
                <div className="flex justify-between">
                  <span>Ongkos Kirim Toko:</span>
                  <span className="font-mono text-slate-200">{formatRupiah(deliveryFee)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                <span>Total Tagihan:</span>
                <span className="font-mono text-emerald-400 text-base">{formatRupiah(grandTotal)}</span>
              </div>
            </div>

            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>Proses Pembayaran ({formatRupiah(grandTotal)})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Success Modal with Thermal Receipt & Surat Jalan */}
      {successReceipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-full bg-emerald-950 border border-emerald-500 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-lg text-white">Transaksi Berhasil!</h3>
              <p className="text-xs text-slate-400">
                No. Order: <span className="font-mono text-emerald-400 font-bold">{successReceipt.orderNumber}</span>
              </p>
            </div>

            {/* Thermal ESC/POS Receipt View */}
            <div className="bg-white text-slate-950 p-4 rounded-xl font-mono text-xs shadow-inner space-y-2 border border-slate-200">
              <div className="text-center border-b border-dashed border-slate-400 pb-2">
                <p className="font-bold">KREVIA FURNITURE LIVING</p>
                <p className="text-[10px]">Jl. RS Fatmawati No. 10 Jakarta Selatan</p>
                <p className="text-[10px]">Telp: 021-7654321</p>
              </div>

              <div className="flex justify-between text-[11px]">
                <span>No: {successReceipt.orderNumber}</span>
                <span>{new Date().toLocaleDateString("id-ID")}</span>
              </div>
              <div className="flex justify-between text-[11px] border-b border-dashed border-slate-400 pb-1">
                <span>Kasir: Dewi Santoso</span>
                <span>{new Date().toLocaleTimeString("id-ID")}</span>
              </div>

              <div className="space-y-1 py-1">
                {successReceipt.items.map((it) => (
                  <div key={it.product.id} className="flex justify-between">
                    <span>
                      {it.quantity}x {it.product.name.slice(0, 18)}
                    </span>
                    <span>{formatRupiah(it.product.basePrice * it.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed border-slate-400 pt-1 space-y-0.5">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatRupiah(successReceipt.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>PPN 11%:</span>
                  <span>{formatRupiah(successReceipt.taxAmount)}</span>
                </div>
                {successReceipt.includeDelivery && (
                  <div className="flex justify-between">
                    <span>Ongkir Toko:</span>
                    <span>{formatRupiah(successReceipt.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm border-t border-slate-950 pt-1">
                  <span>TOTAL:</span>
                  <span>{formatRupiah(successReceipt.grandTotal)}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-400 pt-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Metode:</span>
                  <span>{successReceipt.paymentMethod}</span>
                </div>
                {successReceipt.cashGiven && (
                  <>
                    <div className="flex justify-between">
                      <span>Tunai:</span>
                      <span>{formatRupiah(successReceipt.cashGiven)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Kembali:</span>
                      <span>{formatRupiah(successReceipt.changeReturned || 0)}</span>
                    </div>
                  </>
                )}
                {successReceipt.creditContractNumber && (
                  <div className="flex justify-between font-bold text-indigo-700">
                    <span>No Kontrak:</span>
                    <span>{successReceipt.creditContractNumber}</span>
                  </div>
                )}
              </div>

              <div className="text-center pt-2 text-[10px] text-slate-600 border-t border-dashed border-slate-400">
                <p>Terima Kasih atas Kunjungan Anda</p>
                <p>Barang bergaransi resmi Krevia</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  window.print();
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Struk Thermal</span>
              </button>
              <button
                onClick={() => setSuccessReceipt(null)}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-xs transition"
              >
                Selesai / Transaksi Baru
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
