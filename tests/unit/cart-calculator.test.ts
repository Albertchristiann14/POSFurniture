import { describe, it, expect } from "vitest";
import { calculateCart, CartItemInput } from "@/modules/pos/cart-calculator";

describe("Fase 7: Cart Calculator & PPN / Discount Engine", () => {
  const sampleItems: CartItemInput[] = [
    {
      productId: "prod-sofa-1",
      variantId: "var-sofa-brown",
      productName: "Sofa 3 Dudukan Chesterfield",
      variantName: "Brown Leather",
      unitPrice: 5500000n,
      quantity: 1,
      discountAmount: 250000n, // Diskon item Rp 250.000
    },
    {
      productId: "prod-table-1",
      variantId: "var-table-teak",
      productName: "Meja Makan Jati Minimalis",
      variantName: "Natural Teak 180cm",
      unitPrice: 3200000n,
      quantity: 2, // Total Rp 6.400.000
    },
  ];

  it("Menghitung subtotal, PPN 11%, dan diskon item secara presisi integer Rupiah", () => {
    // Sofa: 5.500.000 - 250.000 = 5.250.000
    // Meja: 2 * 3.200.000 = 6.400.000
    // Subtotal: 11.650.000
    // DPP: 11.650.000
    // PPN 11%: 11.650.000 * 1100 / 10000 = 1.281.500
    // Grand Total: 11.650.000 + 1.281.500 = 12.931.500
    const result = calculateCart(sampleItems);

    expect(result.subtotal).toBe(11650000n);
    expect(result.orderDiscount).toBe(0n);
    expect(result.totalDiscount).toBe(250000n);
    expect(result.taxableAmount).toBe(11650000n);
    expect(result.taxAmount).toBe(1281500n);
    expect(result.deliveryFee).toBe(0n);
    expect(result.grandTotal).toBe(12931500n);
  });

  it("Menghitung diskon faktur persentase (10%) dan biaya pengiriman furniture (Rp 150.000)", () => {
    // Subtotal: 11.650.000
    // Diskon faktur 10%: 1.165.000
    // DPP (taxable base): 11.650.000 - 1.165.000 = 10.485.000
    // PPN 11%: 10.485.000 * 11 / 100 = 1.153.350
    // Ongkos kirim: 150.000
    // Grand Total: 10.485.000 + 1.153.350 + 150.000 = 11.788.350
    const result = calculateCart(sampleItems, {
      orderDiscountPercent: 10,
      deliveryFee: 150000n,
    });

    expect(result.subtotal).toBe(11650000n);
    expect(result.orderDiscount).toBe(1165000n);
    expect(result.taxableAmount).toBe(10485000n);
    expect(result.taxAmount).toBe(1153350n);
    expect(result.deliveryFee).toBe(150000n);
    expect(result.grandTotal).toBe(11788350n);
  });

  it("Mendukung pembulatan kasir (ROUND_NEAREST_100 & ROUND_UP_100)", () => {
    const oddItem: CartItemInput[] = [
      {
        productId: "p1",
        variantId: "v1",
        productName: "Bantal Sofa Dacron",
        variantName: "Standard",
        unitPrice: 99999n,
        quantity: 1,
      },
    ];
    // DPP: 99.999
    // PPN 11%: roundDiv(99999 * 1100, 10000) = roundDiv(109998900, 10000) = 11000
    // Raw total: 99.999 + 11.000 = 110.999
    // 110.999 % 100 = 99
    // ROUND_UP_100 -> adjustment: +1 -> 111.000
    const resRoundUp = calculateCart(oddItem, { roundingMode: "ROUND_UP_100" });
    expect(resRoundUp.taxAmount).toBe(11000n);
    expect(resRoundUp.roundingAdjustment).toBe(1n);
    expect(resRoundUp.grandTotal).toBe(111000n);
  });

  it("Menolak item dengan kuantitas <= 0 atau diskon melebihi harga", () => {
    expect(() =>
      calculateCart([
        {
          productId: "p1",
          variantId: "v1",
          productName: "Kursi",
          variantName: "Kayu",
          unitPrice: 500000n,
          quantity: 0,
        },
      ])
    ).toThrow("Kuantitas item 'Kursi' harus lebih dari 0");

    expect(() =>
      calculateCart([
        {
          productId: "p1",
          variantId: "v1",
          productName: "Kursi",
          variantName: "Kayu",
          unitPrice: 500000n,
          quantity: 1,
          discountAmount: 600000n,
        },
      ])
    ).toThrow("Diskon item 'Kursi' melebihi harga kotor item");
  });
});

