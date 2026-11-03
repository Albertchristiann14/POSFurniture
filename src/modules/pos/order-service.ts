import { AuditLogger } from "@/modules/audit/audit-logger";
import { calculateCart, CartCalculationOptions, CartItemInput } from "./cart-calculator";
import { CatalogService } from "./catalog-service";
import { ShiftService } from "./shift-service";
import { DeliveryService, IDeliveryOrderModel } from "./delivery-service";
import { PaymentService } from "@/modules/payment/payment-service";

export type OrderStatus = "DRAFT" | "CONFIRMED" | "PROCESSING" | "OUT_FOR_DELIVERY" | "COMPLETED" | "CANCELLED";
export type FulfillmentStatus = "NOT_REQUIRED" | "DELIVERY_SCHEDULED" | "DELIVERED";
export type PosPaymentMethod = "CASH" | "QRIS" | "INTERNAL_CREDIT";

export interface IOrderItemModel {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPrice: bigint;
  unitCost: bigint;
  quantity: number;
  discountAmount: bigint;
  subtotal: bigint;
  dimensions?: string;
}

export interface IOrderModel {
  id: string;
  tenantId: string;
  outletId: string;
  shiftId?: string;
  orderNumber: string;
  createdById: string;
  orderStatus: OrderStatus;
  fulfillment: FulfillmentStatus;
  paymentMethod: PosPaymentMethod;
  subtotal: bigint;
  discountAmount: bigint;
  taxAmount: bigint;
  deliveryFee: bigint;
  totalAmount: bigint;
  paidAmount: bigint;
  cashGiven?: bigint;
  changeReturned?: bigint;
  creditContractId?: string;
  notes?: string;
  idempotencyKey: string;
  items: IOrderItemModel[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderRepository {
  createOrder(order: IOrderModel): Promise<IOrderModel>;
  findOrderById(tenantId: string, orderId: string): Promise<IOrderModel | null>;
  findOrderByOrderNumber(tenantId: string, orderNumber: string): Promise<IOrderModel | null>;
  findOrderByIdempotencyKey(tenantId: string, key: string): Promise<IOrderModel | null>;
  updateOrder(order: IOrderModel): Promise<IOrderModel>;
}

export class InMemoryOrderRepository implements IOrderRepository {
  private orders = new Map<string, IOrderModel>();

  async createOrder(order: IOrderModel): Promise<IOrderModel> {
    this.orders.set(order.id, { ...order, items: [...order.items] });
    return order;
  }

  async findOrderById(tenantId: string, orderId: string): Promise<IOrderModel | null> {
    const o = this.orders.get(orderId);
    if (!o || o.tenantId !== tenantId) return null;
    return o;
  }

  async findOrderByOrderNumber(tenantId: string, orderNumber: string): Promise<IOrderModel | null> {
    for (const o of this.orders.values()) {
      if (o.tenantId === tenantId && o.orderNumber === orderNumber) return o;
    }
    return null;
  }

  async findOrderByIdempotencyKey(tenantId: string, key: string): Promise<IOrderModel | null> {
    for (const o of this.orders.values()) {
      if (o.tenantId === tenantId && o.idempotencyKey === key) return o;
    }
    return null;
  }

  async updateOrder(order: IOrderModel): Promise<IOrderModel> {
    this.orders.set(order.id, { ...order, items: [...order.items] });
    return order;
  }
}

export interface CheckoutInput {
  tenantId: string;
  outletId: string;
  userId: string;
  shiftId?: string;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    unitPrice: bigint;
    unitCost?: bigint;
    quantity: number;
    discountAmount?: bigint;
    dimensions?: string;
  }>;
  options?: CartCalculationOptions;
  payment: {
    method: PosPaymentMethod;
    cashGiven?: bigint; // for CASH
    creditContractId?: string; // for INTERNAL_CREDIT
  };
  delivery?: {
    required: boolean;
    recipientName: string;
    recipientPhone: string;
    shippingAddress: string;
    scheduledDate: Date;
    assemblyRequired?: boolean;
    assemblyNotes?: string;
  };
  notes?: string;
}

export interface CheckoutResult {
  order: IOrderModel;
  delivery?: IDeliveryOrderModel;
  paymentDetails: {
    method: PosPaymentMethod;
    amountPaid: bigint;
    cashGiven?: bigint;
    changeReturned?: bigint;
    qrisQrString?: string;
  };
}

export class OrderService {
  constructor(
    private readonly repo: IOrderRepository,
    private readonly catalogService: CatalogService,
    private readonly shiftService: ShiftService,
    private readonly deliveryService: DeliveryService,
    private readonly paymentService: PaymentService,
    private readonly auditLogger: AuditLogger
  ) {}

  private generateOrderNumber(): string {
    const d = new Date();
    const yy = d.getFullYear().toString().slice(-2);
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000 + 1000);
    return `ORD-${yy}${mm}${dd}-${rand}`;
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    // 1. Idempotency Check
    const existing = await this.repo.findOrderByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (existing) {
      const delivery = await this.deliveryService["repo"].findDeliveryByOrderId(existing.id);
      return {
        order: existing,
        delivery: delivery || undefined,
        paymentDetails: {
          method: existing.paymentMethod,
          amountPaid: existing.paidAmount,
          cashGiven: existing.cashGiven,
          changeReturned: existing.changeReturned,
        },
      };
    }

    // 2. Kalkulasi Keranjang & Pajak (Pure Integer Math)
    const cartItemsInput: CartItemInput[] = input.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      discountAmount: i.discountAmount,
    }));

    const cartCalc = calculateCart(cartItemsInput, input.options);
    const orderId = crypto.randomUUID();
    const orderNumber = this.generateOrderNumber();

    // 3. Payment Processing & Verification
    let paidAmount = 0n;
    let cashGiven: bigint | undefined;
    let changeReturned: bigint | undefined;
    let qrisQrString: string | undefined;

    if (input.payment.method === "CASH") {
      if (!input.payment.cashGiven || input.payment.cashGiven < cartCalc.grandTotal) {
        throw new Error(
          `Uang tunai yang diberikan (${input.payment.cashGiven ?? 0}) kurang dari total tagihan (${cartCalc.grandTotal})`
        );
      }
      cashGiven = input.payment.cashGiven;
      changeReturned = cashGiven - cartCalc.grandTotal;
      paidAmount = cartCalc.grandTotal;

      // Update kasir shift jika shiftId diberikan
      if (input.shiftId) {
        await this.shiftService.recordSalePayment(input.shiftId, "CASH", paidAmount);
      }
    } else if (input.payment.method === "QRIS") {
      paidAmount = cartCalc.grandTotal;

      const qrisPayment = await this.paymentService.initiateDynamicQrisPayment({
        tenantId: input.tenantId,
        orderId,
        amount: paidAmount,
        idempotencyKey: `pay-${input.idempotencyKey}`,
        createdById: input.userId,
      });
      qrisQrString = qrisPayment.qrisQrString || undefined;

      if (input.shiftId) {
        await this.shiftService.recordSalePayment(input.shiftId, "QRIS", paidAmount);
      }
    } else if (input.payment.method === "INTERNAL_CREDIT") {
      if (!input.payment.creditContractId) {
        throw new Error("ID Kontrak kredit wajib disertakan untuk metode pembayaran INTERNAL_CREDIT");
      }
      paidAmount = cartCalc.grandTotal;

      if (input.shiftId) {
        await this.shiftService.recordSalePayment(input.shiftId, "INTERNAL_CREDIT", paidAmount);
      }
    }

    // 4. Manajemen Stok
    // Jika kredit: barang direservasi (RESERVE_CREDIT) sampai barang terkirim / diambil
    // Jika tunai/QRIS:
    //    - Jika ada delivery: reservasi stok sampai delivery selesai
    //    - Jika langsung bawa pulang: potong stok langsung (directSaleDeduct)
    const hasDelivery = input.delivery && input.delivery.required;

    for (const item of input.items) {
      if (input.payment.method === "INTERNAL_CREDIT") {
        await this.catalogService.reserveStockForCredit(
          input.tenantId,
          input.outletId,
          item.variantId,
          item.quantity,
          input.payment.creditContractId!,
          input.userId
        );
      } else if (hasDelivery) {
        await this.catalogService.reserveStockForCredit(
          input.tenantId,
          input.outletId,
          item.variantId,
          item.quantity,
          orderId,
          input.userId
        );
      } else {
        await this.catalogService.directSaleDeduct(
          input.tenantId,
          input.outletId,
          item.variantId,
          item.quantity,
          orderId,
          input.userId
        );
      }
    }

    // 5. Buat Entitas Order
    const orderItems: IOrderItemModel[] = input.items.map((i) => {
      const calcItem = cartCalc.items.find((c) => c.variantId === i.variantId)!;
      return {
        id: crypto.randomUUID(),
        orderId,
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        unitPrice: i.unitPrice,
        unitCost: i.unitCost ?? 0n,
        quantity: i.quantity,
        discountAmount: calcItem.discountAmount,
        subtotal: calcItem.lineSubtotal,
        dimensions: i.dimensions,
      };
    });

    const order: IOrderModel = {
      id: orderId,
      tenantId: input.tenantId,
      outletId: input.outletId,
      shiftId: input.shiftId,
      orderNumber,
      createdById: input.userId,
      orderStatus: hasDelivery ? "PROCESSING" : "COMPLETED",
      fulfillment: hasDelivery ? "DELIVERY_SCHEDULED" : "DELIVERED",
      paymentMethod: input.payment.method,
      subtotal: cartCalc.subtotal,
      discountAmount: cartCalc.totalDiscount,
      taxAmount: cartCalc.taxAmount,
      deliveryFee: cartCalc.deliveryFee,
      totalAmount: cartCalc.grandTotal,
      paidAmount,
      cashGiven,
      changeReturned,
      creditContractId: input.payment.creditContractId,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      items: orderItems,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const savedOrder = await this.repo.createOrder(order);

    // 6. Penjadwalan Delivery jika diperlukan
    let deliveryOrder: IDeliveryOrderModel | undefined;
    if (hasDelivery && input.delivery) {
      deliveryOrder = await this.deliveryService.scheduleDelivery(input.tenantId, input.userId, {
        orderId,
        recipientName: input.delivery.recipientName,
        recipientPhone: input.delivery.recipientPhone,
        shippingAddress: input.delivery.shippingAddress,
        scheduledDate: input.delivery.scheduledDate,
        assemblyRequired: input.delivery.assemblyRequired,
        assemblyNotes: input.delivery.assemblyNotes,
      });
    }

    await this.auditLogger.log({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "POS_ORDER_CREATED",
      resource: "ORDER",
      resourceId: savedOrder.id,
      payload: {
        orderNumber: savedOrder.orderNumber,
        grandTotal: savedOrder.totalAmount.toString(),
        paymentMethod: savedOrder.paymentMethod,
        hasDelivery: !!deliveryOrder,
      },
    });

    return {
      order: savedOrder,
      delivery: deliveryOrder,
      paymentDetails: {
        method: savedOrder.paymentMethod,
        amountPaid: savedOrder.paidAmount,
        cashGiven: savedOrder.cashGiven,
        changeReturned: savedOrder.changeReturned,
        qrisQrString,
      },
    };
  }

  async markOrderDelivered(tenantId: string, orderId: string, actorId: string): Promise<IOrderModel> {
    const order = await this.repo.findOrderById(tenantId, orderId);
    if (!order) {
      throw new Error("Order tidak ditemukan");
    }

    order.orderStatus = "COMPLETED";
    order.fulfillment = "DELIVERED";
    order.updatedAt = new Date();

    const updated = await this.repo.updateOrder(order);

    // Fulfill inventory reservation
    for (const item of order.items) {
      await this.catalogService.fulfillReservedDelivery(
        tenantId,
        order.outletId,
        item.variantId,
        item.quantity,
        orderId,
        actorId
      );
    }

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "POS_ORDER_DELIVERY_FULFILLED",
      resource: "ORDER",
      resourceId: updated.id,
      payload: { orderNumber: updated.orderNumber },
    });

    return updated;
  }
}
