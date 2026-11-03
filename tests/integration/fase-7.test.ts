import { describe, it, expect, beforeEach } from "vitest";
import { CatalogService, InMemoryCatalogRepository } from "@/modules/pos/catalog-service";
import { DeliveryService, InMemoryDeliveryRepository } from "@/modules/pos/delivery-service";
import { ShiftService, InMemoryShiftRepository } from "@/modules/pos/shift-service";
import { OrderService, InMemoryOrderRepository } from "@/modules/pos/order-service";
import { PaymentService, InMemoryPaymentRepository } from "@/modules/payment/payment-service";
import { MockPaymentGatewayAdapter } from "@/modules/payment/payment-gateway";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Fase 7: Core POS & Retail Furniture Full Integration", () => {
  let auditLogger: AuditLogger;
  let catalogRepo: InMemoryCatalogRepository;
  let catalogService: CatalogService;
  let deliveryRepo: InMemoryDeliveryRepository;
  let deliveryService: DeliveryService;
  let shiftRepo: InMemoryShiftRepository;
  let shiftService: ShiftService;
  let paymentRepo: InMemoryPaymentRepository;
  let paymentGateway: MockPaymentGatewayAdapter;
  let paymentService: PaymentService;
  let orderRepo: InMemoryOrderRepository;
  let orderService: OrderService;

  const tenantId = "tenant-krevia-furniture";
  const outletId = "outlet-utama-fatmawati";
  const cashierId = "user-kasir-dewi";
  const logisticsId = "user-logistik-supri";

  let sofaProdId: string;
  let sofaVarId: string;
  let tableProdId: string;
  let tableVarId: string;

  beforeEach(async () => {
    auditLogger = new AuditLogger(new InMemoryAuditRepository());

    catalogRepo = new InMemoryCatalogRepository();
    catalogService = new CatalogService(catalogRepo, auditLogger);

    deliveryRepo = new InMemoryDeliveryRepository();
    deliveryService = new DeliveryService(deliveryRepo, auditLogger);

    shiftRepo = new InMemoryShiftRepository();
    shiftService = new ShiftService(shiftRepo, auditLogger);

    paymentRepo = new InMemoryPaymentRepository();
    paymentGateway = new MockPaymentGatewayAdapter();
    paymentService = new PaymentService(paymentRepo, paymentGateway, auditLogger);

    orderRepo = new InMemoryOrderRepository();
    orderService = new OrderService(
      orderRepo,
      catalogService,
      shiftService,
      deliveryService,
      paymentService,
      auditLogger
    );

    // Setup Master Produk Furniture
    const sofaProduct = await catalogService.createProduct(tenantId, "admin-1", {
      name: "Sofa L-Shape Scandia Luxury",
      sku: "SOF-SCAN-01",
      dimensions: "260 x 160 x 85 cm",
      material: "Solid Teak Frame + Belgian Fabric",
      warrantyMonths: 24,
      isCreditEligible: true,
      variants: [
        {
          name: "Dark Grey Fabric",
          skuVariant: "SOF-SCAN-01-GRY",
          basePrice: 6000000n,
          costPrice: 4000000n,
        },
      ],
    });
    sofaProdId = sofaProduct.id;
    sofaVarId = sofaProduct.variants[0].id;

    const tableProduct = await catalogService.createProduct(tenantId, "admin-1", {
      name: "Meja Kopi Minimalis Jati",
      sku: "TBL-COFF-01",
      dimensions: "100 x 60 x 45 cm",
      material: "Kayu Jati Asli Jepara",
      warrantyMonths: 12,
      isCreditEligible: true,
      variants: [
        {
          name: "Natural Oak Finish",
          skuVariant: "TBL-COFF-01-OAK",
          basePrice: 1500000n,
          costPrice: 900000n,
        },
      ],
    });
    tableProdId = tableProduct.id;
    tableVarId = tableProduct.variants[0].id;

    // Restock Awal di Gudang Outlet: 5 Sofa, 10 Meja Kopi
    await catalogService.restock(tenantId, outletId, sofaVarId, 5, "admin-1");
    await catalogService.restock(tenantId, outletId, tableVarId, 10, "admin-1");
  });

  it("Skenario 1: Penjualan Langsung Walk-in Kasir Tunai dengan Kembalian & Potong Stok Langsung", async () => {
    // 1. Kasir buka shift dengan modal Rp 1.000.000
    const shift = await shiftService.openShift(tenantId, outletId, cashierId, 1000000n);

    // 2. Pelanggan beli 1 unit Meja Kopi langsung bawa pulang
    // Harga: Rp 1.500.000 + PPN 11% (Rp 165.000) = Rp 1.665.000
    const checkoutResult = await orderService.checkout({
      tenantId,
      outletId,
      userId: cashierId,
      shiftId: shift.id,
      idempotencyKey: "idem-pos-cash-01",
      items: [
        {
          productId: tableProdId,
          variantId: tableVarId,
          productName: "Meja Kopi Minimalis Jati",
          variantName: "Natural Oak Finish",
          unitPrice: 1500000n,
          quantity: 1,
        },
      ],
      payment: {
        method: "CASH",
        cashGiven: 1700000n, // Uang tunai dari pembeli
      },
    });

    expect(checkoutResult.order.orderStatus).toBe("COMPLETED");
    expect(checkoutResult.order.totalAmount).toBe(1665000n);
    expect(checkoutResult.order.cashGiven).toBe(1700000n);
    expect(checkoutResult.order.changeReturned).toBe(35000n);

    // 3. Stok meja kopi langsung berkurang dari 10 menjadi 9 (karena langsung bawa pulang)
    const inv = await catalogRepo.getInventory(outletId, tableVarId);
    expect(inv?.quantityAvailable).toBe(9);
    expect(inv?.quantityReserved).toBe(0);

    // 4. Kas shift terupdate
    const updatedShift = await shiftRepo.findShiftById(shift.id);
    expect(updatedShift?.totalCashSales).toBe(1665000n);
  });

  it("Skenario 2: Penjualan Showroom Non-Tunai (QRIS) + Delivery Order & Bukti Serah Terima", async () => {
    const shift = await shiftService.openShift(tenantId, outletId, cashierId, 1000000n);

    // 1. Pelanggan pesan 1 Sofa L-Shape dengan pengiriman toko (Ongkir Rp 200.000)
    // Subtotal: 6.000.000 + PPN 11% (660.000) + Ongkir (200.000) = Rp 6.860.000
    const checkoutResult = await orderService.checkout({
      tenantId,
      outletId,
      userId: cashierId,
      shiftId: shift.id,
      idempotencyKey: "idem-pos-qris-deliv-01",
      items: [
        {
          productId: sofaProdId,
          variantId: sofaVarId,
          productName: "Sofa L-Shape Scandia Luxury",
          variantName: "Dark Grey Fabric",
          unitPrice: 6000000n,
          quantity: 1,
        },
      ],
      options: {
        deliveryFee: 200000n,
      },
      payment: {
        method: "QRIS",
      },
      delivery: {
        required: true,
        recipientName: "Bpk. Rahmat",
        recipientPhone: "081233445566",
        shippingAddress: "Villa Melati Mas Blok A5 No. 12",
        scheduledDate: new Date("2026-11-08T10:00:00Z"),
        assemblyRequired: true,
        assemblyNotes: "Rakit kaki sofa di ruang keluarga lantai dasar",
      },
    });

    expect(checkoutResult.order.orderStatus).toBe("PROCESSING");
    expect(checkoutResult.order.fulfillment).toBe("DELIVERY_SCHEDULED");
    expect(checkoutResult.order.totalAmount).toBe(6860000n);
    expect(checkoutResult.paymentDetails.qrisQrString).toBeDefined();
    expect(checkoutResult.delivery).toBeDefined();

    // 2. Stok sofa direservasi (Available: 5 -> 4, Reserved: 0 -> 1)
    let invSofa = await catalogRepo.getInventory(outletId, sofaVarId);
    expect(invSofa?.quantityAvailable).toBe(4);
    expect(invSofa?.quantityReserved).toBe(1);

    // 3. Tim logistik memberangkatkan supir
    const deliveryId = checkoutResult.delivery!.id;
    await deliveryService.dispatchDelivery(tenantId, deliveryId, "Pak Supri", "B 5544 KRE", logisticsId);

    // 4. Tim logistik konfirmasi serah terima barang di tempat pelanggan
    await deliveryService.confirmDelivered(
      tenantId,
      deliveryId,
      {
        proofPhotoUrl: "https://storage.kreviapos.id/proofs/delivery-sofa-01.jpg",
        digitalSignatureUrl: "https://storage.kreviapos.id/sigs/rahmat-01.png",
        notes: "Barang sudah diterima dan dirakit rapi oleh Pak Supri",
      },
      logisticsId
    );

    // 5. Order ditandai selesai dan reservasi stok dipenuhi (Reserved: 1 -> 0)
    const finalizedOrder = await orderService.markOrderDelivered(tenantId, checkoutResult.order.id, logisticsId);
    expect(finalizedOrder.orderStatus).toBe("COMPLETED");
    expect(finalizedOrder.fulfillment).toBe("DELIVERED");

    invSofa = await catalogRepo.getInventory(outletId, sofaVarId);
    expect(invSofa?.quantityAvailable).toBe(4);
    expect(invSofa?.quantityReserved).toBe(0);
  });

  it("Skenario 3: Transaksi Kasir Menggunakan Modul Kredit Internal (DP Tunai di Kasir) & Rekonsiliasi Kas Lengkap", async () => {
    // 1. Kasir buka shift dengan modal Rp 1.000.000
    const shift = await shiftService.openShift(tenantId, outletId, cashierId, 1000000n);

    // 2. Transaksi A: Penjualan tunai langsung meja kopi (Rp 1.665.000)
    await orderService.checkout({
      tenantId,
      outletId,
      userId: cashierId,
      shiftId: shift.id,
      idempotencyKey: "idem-trans-a",
      items: [
        {
          productId: tableProdId,
          variantId: tableVarId,
          productName: "Meja Kopi Minimalis Jati",
          variantName: "Natural Oak Finish",
          unitPrice: 1500000n,
          quantity: 1,
        },
      ],
      payment: {
        method: "CASH",
        cashGiven: 1665000n,
      },
    });

    // 3. Transaksi B: Penjualan furniture via Modul Kredit Internal
    // Nasabah beli 2 unit Sofa L-Shape (Total Rp 12.000.000 + PPN Rp 1.320.000 = Rp 13.320.000)
    // Nasabah membayar DP Tunai di kasir sebesar Rp 3.000.000
    const creditContractId = "ktr-krevia-furniture-8899";
    await orderService.checkout({
      tenantId,
      outletId,
      userId: cashierId,
      shiftId: shift.id,
      idempotencyKey: "idem-trans-credit-b",
      items: [
        {
          productId: sofaProdId,
          variantId: sofaVarId,
          productName: "Sofa L-Shape Scandia Luxury",
          variantName: "Dark Grey Fabric",
          unitPrice: 6000000n,
          quantity: 2,
        },
      ],
      payment: {
        method: "INTERNAL_CREDIT",
        creditContractId,
      },
    });

    // Catat penerimaan DP tunai dari nasabah kredit ke laci kasir
    await shiftService.recordCreditDownPaymentCash(shift.id, 3000000n);

    // 4. Kasir catat pengeluaran kas kecil operasional (Beli bensin armada pickup Rp 100.000)
    await shiftService.recordCashMovement(
      tenantId,
      shift.id,
      cashierId,
      "EXPENSE",
      100000n,
      "Beli Pertamax armada pickup pengiriman"
    );

    // 5. Tutup shift kasir & validasi rekonsiliasi
    // Modal Awal: 1.000.000
    // + Penjualan Tunai: 1.665.000
    // + DP Kredit Tunai: 3.000.000
    // - Pengeluaran Kas: 100.000
    // = Total Kas yang Diharapkan: Rp 5.565.000
    const expectedClosingCash = 1000000n + 1665000n + 3000000n - 100000n; // 5.565.000

    const closedShift = await shiftService.closeShift(
      tenantId,
      shift.id,
      cashierId,
      5565000n,
      "Kas laci seimbang 100%"
    );

    expect(closedShift.closedAt).toBeDefined();
    expect(closedShift.endCashCalculated).toBe(expectedClosingCash);
    expect(closedShift.endCashActual).toBe(5565000n);
    expect(closedShift.discrepancy).toBe(0n); // Sempurna tidak ada selisih
    expect(closedShift.totalCashCreditDp).toBe(3000000n);
    expect(closedShift.totalCreditFinanced).toBe(13320000n);
  });

  it("Idempotency: Request checkout ulang dengan key yang sama tidak membuat order duplikat dan tidak memotong stok berulang", async () => {
    const shift = await shiftService.openShift(tenantId, outletId, cashierId, 1000000n);

    const first = await orderService.checkout({
      tenantId,
      outletId,
      userId: cashierId,
      shiftId: shift.id,
      idempotencyKey: "idem-anti-duplicate-key",
      items: [
        {
          productId: tableProdId,
          variantId: tableVarId,
          productName: "Meja Kopi Minimalis Jati",
          variantName: "Natural Oak Finish",
          unitPrice: 1500000n,
          quantity: 1,
        },
      ],
      payment: {
        method: "CASH",
        cashGiven: 2000000n,
      },
    });

    const invAfterFirst = await catalogRepo.getInventory(outletId, tableVarId);
    expect(invAfterFirst?.quantityAvailable).toBe(9); // dari 10 berkurang 1

    // Request kedua dengan idempotency key yang sama persis
    const second = await orderService.checkout({
      tenantId,
      outletId,
      userId: cashierId,
      shiftId: shift.id,
      idempotencyKey: "idem-anti-duplicate-key",
      items: [
        {
          productId: tableProdId,
          variantId: tableVarId,
          productName: "Meja Kopi Minimalis Jati",
          variantName: "Natural Oak Finish",
          unitPrice: 1500000n,
          quantity: 1,
        },
      ],
      payment: {
        method: "CASH",
        cashGiven: 2000000n,
      },
    });

    // Harus mengembalikan data order yang sama
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.orderNumber).toBe(first.order.orderNumber);

    // Stok TIDAK boleh terpotong dua kali (tetap 9)
    const invAfterSecond = await catalogRepo.getInventory(outletId, tableVarId);
    expect(invAfterSecond?.quantityAvailable).toBe(9);
  });
});
