import { describe, it, expect } from "vitest";
import { PosReceiptService } from "@/modules/pos/pos-receipt-service";

describe("Fase 7: POS Thermal Receipt & Delivery Note Generator", () => {
  it("Menghasilkan teks struk POS thermal 42 kolom yang rapi", () => {
    const receiptText = PosReceiptService.generatePosReceiptText({
      storeName: "Krevia Furniture Living",
      storeAddress: "Jl. Fatmawati Raya No. 10 Jakarta Selatan",
      storePhone: "021-7654321",
      orderNumber: "ORD-261103-9021",
      cashierName: "Budi Santoso",
      orderDate: new Date("2026-11-03T14:30:00Z"),
      items: [
        {
          productName: "Sofa 3 Seater Minimalis",
          variantName: "Grey Fabric",
          unitPrice: 4500000n,
          quantity: 1,
          discountAmount: 200000n,
          lineTotal: 4300000n,
        },
        {
          productName: "Bantal Sofa Dacron",
          variantName: "Cream",
          unitPrice: 75000n,
          quantity: 2,
          discountAmount: 0n,
          lineTotal: 150000n,
        },
      ],
      subtotal: 4450000n,
      orderDiscount: 0n,
      taxAmount: 489500n,
      deliveryFee: 150000n,
      grandTotal: 5089500n,
      paymentMethod: "CASH",
      cashGiven: 5100000n,
      changeReturned: 10500n,
    });

    expect(receiptText).toContain("KREVIA FURNITURE LIVING");
    expect(receiptText).toContain("ORD-261103-9021");
    expect(receiptText).toContain("Sofa 3 Seater Minimalis");
    expect(receiptText).toContain("Rp 5.089.500");
    expect(receiptText).toContain("Tunai Diterima:");
    expect(receiptText).toContain("Kembalian:");
  });

  it("Menghasilkan dokumen Surat Jalan / Delivery Note lengkap dengan manifest barang dan blok tanda tangan", () => {
    const deliveryNote = PosReceiptService.generateDeliveryNoteText({
      deliveryId: "del-8829102-uuid",
      orderNumber: "ORD-261103-9021",
      storeName: "Krevia Furniture Living",
      storeAddress: "Jl. Fatmawati Raya No. 10 Jakarta Selatan",
      recipientName: "Bpk. Hendra Gunawan",
      recipientPhone: "08119876543",
      shippingAddress: "Apartemen Botanica Tower 2 Lt. 15",
      scheduledDate: new Date("2026-11-05T09:00:00Z"),
      driverName: "Pak Agus",
      licensePlate: "B 1234 KFV",
      assemblyRequired: true,
      assemblyNotes: "Bawa perkakas kunci L dan bor untuk pemasangan kaki meja",
      items: [
        {
          productName: "Meja Makan Solid Wood",
          variantName: "Natural Finish",
          dimensions: "200 x 90 x 75 cm",
          quantity: 1,
        },
      ],
    });

    expect(deliveryNote).toContain("SURAT JALAN PENGIRIMAN FURNITURE");
    expect(deliveryNote).toContain("Bpk. Hendra Gunawan");
    expect(deliveryNote).toContain("Pak Agus");
    expect(deliveryNote).toContain("200 x 90 x 75 cm");
    expect(deliveryNote).toContain("PERNYATAAN SERAH TERIMA:");
    expect(deliveryNote).toContain("Pengirim/Supir");
    expect(deliveryNote).toContain("Penerima/Pelanggan");
  });
});
