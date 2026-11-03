import { roundDivBigInt } from "@/shared/math/currency";

export interface CartItemInput {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPrice: bigint;
  quantity: number;
  discountAmount?: bigint;
}

export type RoundingMode = "NONE" | "ROUND_UP_100" | "ROUND_DOWN_100" | "ROUND_NEAREST_100";

export interface CartCalculationOptions {
  orderDiscountAmount?: bigint;
  orderDiscountPercent?: number; // e.g. 10 for 10%
  taxRateBps?: number; // Basis points: 1100 = 11% PPN (Indonesian standard)
  deliveryFee?: bigint;
  roundingMode?: RoundingMode;
}

export interface CalculatedCartItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPrice: bigint;
  quantity: number;
  discountAmount: bigint;
  lineSubtotal: bigint;
}

export interface CartCalculationResult {
  items: CalculatedCartItem[];
  subtotal: bigint;
  orderDiscount: bigint;
  totalDiscount: bigint;
  taxableAmount: bigint;
  taxAmount: bigint;
  deliveryFee: bigint;
  roundingAdjustment: bigint;
  grandTotal: bigint;
}

/**
 * Calculates cart pricing with strict zero-float integer math.
 * Enforces Indonesian VAT (PPN 11%), item/order discounts, delivery fees, and optional cash rounding.
 */
export function calculateCart(
  itemsInput: CartItemInput[],
  options: CartCalculationOptions = {}
): CartCalculationResult {
  if (!itemsInput || itemsInput.length === 0) {
    return {
      items: [],
      subtotal: 0n,
      orderDiscount: 0n,
      totalDiscount: 0n,
      taxableAmount: 0n,
      taxAmount: 0n,
      deliveryFee: options.deliveryFee ?? 0n,
      roundingAdjustment: 0n,
      grandTotal: options.deliveryFee ?? 0n,
    };
  }

  let itemsSubtotal = 0n;
  let itemsTotalDiscount = 0n;

  const calculatedItems: CalculatedCartItem[] = itemsInput.map((item) => {
    if (item.quantity <= 0) {
      throw new Error(`Kuantitas item '${item.productName}' harus lebih dari 0`);
    }
    if (item.unitPrice < 0n) {
      throw new Error(`Harga item '${item.productName}' tidak boleh negatif`);
    }

    const itemGross = item.unitPrice * BigInt(item.quantity);
    const itemDiscount = item.discountAmount ?? 0n;
    if (itemDiscount < 0n) {
      throw new Error(`Diskon item '${item.productName}' tidak boleh negatif`);
    }
    if (itemDiscount > itemGross) {
      throw new Error(`Diskon item '${item.productName}' melebihi harga kotor item`);
    }

    const lineSubtotal = itemGross - itemDiscount;
    itemsSubtotal += lineSubtotal;
    itemsTotalDiscount += itemDiscount;

    return {
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discountAmount: itemDiscount,
      lineSubtotal,
    };
  });

  // Order-level discount calculation
  let orderDiscount = 0n;
  if (options.orderDiscountAmount && options.orderDiscountAmount > 0n) {
    orderDiscount = options.orderDiscountAmount;
  } else if (options.orderDiscountPercent && options.orderDiscountPercent > 0) {
    if (options.orderDiscountPercent > 100) {
      throw new Error("Persentase diskon faktur tidak boleh melebihi 100%");
    }
    orderDiscount = roundDivBigInt(
      itemsSubtotal * BigInt(options.orderDiscountPercent),
      100n
    );
  }

  if (orderDiscount > itemsSubtotal) {
    orderDiscount = itemsSubtotal;
  }

  const taxableAmount = itemsSubtotal - orderDiscount;
  const taxRateBps = options.taxRateBps !== undefined ? BigInt(options.taxRateBps) : 1100n; // Default 11% PPN
  const taxAmount = roundDivBigInt(taxableAmount * taxRateBps, 10000n);
  const deliveryFee = options.deliveryFee && options.deliveryFee > 0n ? options.deliveryFee : 0n;

  const rawGrandTotal = taxableAmount + taxAmount + deliveryFee;

  // Rounding adjustment (e.g. for Indonesian cash drawer rounding to nearest 100)
  let roundingAdjustment = 0n;
  const roundingMode = options.roundingMode || "NONE";

  if (roundingMode !== "NONE") {
    const remainder = rawGrandTotal % 100n;
    if (remainder !== 0n) {
      if (roundingMode === "ROUND_UP_100") {
        roundingAdjustment = 100n - remainder;
      } else if (roundingMode === "ROUND_DOWN_100") {
        roundingAdjustment = -remainder;
      } else if (roundingMode === "ROUND_NEAREST_100") {
        if (remainder >= 50n) {
          roundingAdjustment = 100n - remainder;
        } else {
          roundingAdjustment = -remainder;
        }
      }
    }
  }

  const grandTotal = rawGrandTotal + roundingAdjustment;

  return {
    items: calculatedItems,
    subtotal: itemsSubtotal,
    orderDiscount,
    totalDiscount: itemsTotalDiscount + orderDiscount,
    taxableAmount,
    taxAmount,
    deliveryFee,
    roundingAdjustment,
    grandTotal,
  };
}
