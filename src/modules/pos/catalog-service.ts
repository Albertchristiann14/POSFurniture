import { AuditLogger } from "@/modules/audit/audit-logger";

export interface IProductVariantModel {
  id: string;
  productId: string;
  skuVariant: string;
  name: string;
  basePrice: bigint;
  costPrice: bigint;
}

export interface IProductModel {
  id: string;
  tenantId: string;
  categoryId?: string;
  name: string;
  sku: string;
  description?: string;
  isCreditEligible: boolean;
  warrantyMonths: number;
  dimensions?: string; // P x L x T (cm)
  material?: string;   // e.g. "Kayu Jati Grade A"
  color?: string;
  qrShowroomCode: string;
  variants: IProductVariantModel[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IInventoryModel {
  id: string;
  outletId: string;
  variantId: string;
  quantityAvailable: number;
  quantityReserved: number;
  reorderThreshold: number;
}

export interface IStockMovementModel {
  id: string;
  inventoryId: string;
  changeAmount: number;
  reason: "RESTOCK" | "SALE" | "RESERVE_CREDIT" | "RELEASE_RESERVATION" | "DELIVERED" | "ADJUSTMENT";
  referenceId?: string;
  createdAt: Date;
}

export interface ICatalogRepository {
  createProduct(product: IProductModel): Promise<IProductModel>;
  findProductById(tenantId: string, id: string): Promise<IProductModel | null>;
  findProductBySku(tenantId: string, sku: string): Promise<IProductModel | null>;
  listProducts(tenantId: string, filter?: { categoryId?: string; isCreditEligible?: boolean }): Promise<IProductModel[]>;
  getInventory(outletId: string, variantId: string): Promise<IInventoryModel | null>;
  upsertInventory(inventory: IInventoryModel): Promise<IInventoryModel>;
  recordStockMovement(movement: IStockMovementModel): Promise<IStockMovementModel>;
}

export class InMemoryCatalogRepository implements ICatalogRepository {
  private products = new Map<string, IProductModel>();
  private inventories = new Map<string, IInventoryModel>(); // key: outletId:variantId
  private stockMovements: IStockMovementModel[] = [];

  async createProduct(product: IProductModel): Promise<IProductModel> {
    this.products.set(product.id, { ...product });
    return product;
  }

  async findProductById(tenantId: string, id: string): Promise<IProductModel | null> {
    const p = this.products.get(id);
    if (!p || p.tenantId !== tenantId) return null;
    return p;
  }

  async findProductBySku(tenantId: string, sku: string): Promise<IProductModel | null> {
    for (const p of this.products.values()) {
      if (p.tenantId === tenantId && p.sku === sku) return p;
    }
    return null;
  }

  async listProducts(
    tenantId: string,
    filter?: { categoryId?: string; isCreditEligible?: boolean }
  ): Promise<IProductModel[]> {
    return Array.from(this.products.values()).filter((p) => {
      if (p.tenantId !== tenantId) return false;
      if (filter?.categoryId && p.categoryId !== filter.categoryId) return false;
      if (filter?.isCreditEligible !== undefined && p.isCreditEligible !== filter.isCreditEligible) return false;
      return true;
    });
  }

  async getInventory(outletId: string, variantId: string): Promise<IInventoryModel | null> {
    const key = `${outletId}:${variantId}`;
    return this.inventories.get(key) || null;
  }

  async upsertInventory(inventory: IInventoryModel): Promise<IInventoryModel> {
    const key = `${inventory.outletId}:${inventory.variantId}`;
    this.inventories.set(key, { ...inventory });
    return inventory;
  }

  async recordStockMovement(movement: IStockMovementModel): Promise<IStockMovementModel> {
    this.stockMovements.push({ ...movement });
    return movement;
  }

  getStockMovements(inventoryId: string): IStockMovementModel[] {
    return this.stockMovements.filter((m) => m.inventoryId === inventoryId);
  }
}

export class CatalogService {
  constructor(
    private readonly repo: ICatalogRepository,
    private readonly auditLogger: AuditLogger
  ) {}

  async createProduct(
    tenantId: string,
    actorId: string,
    data: {
      name: string;
      sku: string;
      categoryId?: string;
      description?: string;
      isCreditEligible?: boolean;
      warrantyMonths?: number;
      dimensions?: string;
      material?: string;
      color?: string;
      variants: Array<{
        name: string;
        skuVariant: string;
        basePrice: bigint;
        costPrice?: bigint;
      }>;
    }
  ): Promise<IProductModel> {
    const existing = await this.repo.findProductBySku(tenantId, data.sku);
    if (existing) {
      throw new Error(`SKU '${data.sku}' sudah terdaftar dalam katalog tenant ini`);
    }

    if (!data.variants || data.variants.length === 0) {
      throw new Error("Produk wajib memiliki setidaknya satu varian");
    }

    const productId = crypto.randomUUID();
    const qrShowroomCode = `SHW-${tenantId.slice(0, 4)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const variants: IProductVariantModel[] = data.variants.map((v) => ({
      id: crypto.randomUUID(),
      productId,
      skuVariant: v.skuVariant,
      name: v.name,
      basePrice: v.basePrice,
      costPrice: v.costPrice ?? 0n,
    }));

    const product: IProductModel = {
      id: productId,
      tenantId,
      categoryId: data.categoryId,
      name: data.name,
      sku: data.sku,
      description: data.description,
      isCreditEligible: data.isCreditEligible ?? true,
      warrantyMonths: data.warrantyMonths ?? 0,
      dimensions: data.dimensions,
      material: data.material,
      color: data.color,
      qrShowroomCode,
      variants,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const saved = await this.repo.createProduct(product);

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "CATALOG_PRODUCT_CREATED",
      resource: "PRODUCT",
      resourceId: saved.id,
      payload: { sku: saved.sku, name: saved.name, variantCount: variants.length },
    });

    return saved;
  }

  async restock(
    tenantId: string,
    outletId: string,
    variantId: string,
    quantity: number,
    actorId: string,
    reason: string = "RESTOCK"
  ): Promise<IInventoryModel> {
    if (quantity <= 0) {
      throw new Error("Jumlah restock harus lebih dari 0");
    }

    let inv = await this.repo.getInventory(outletId, variantId);
    if (!inv) {
      inv = {
        id: crypto.randomUUID(),
        outletId,
        variantId,
        quantityAvailable: 0,
        quantityReserved: 0,
        reorderThreshold: 2,
      };
    }

    inv.quantityAvailable += quantity;
    const saved = await this.repo.upsertInventory(inv);

    await this.repo.recordStockMovement({
      id: crypto.randomUUID(),
      inventoryId: saved.id,
      changeAmount: quantity,
      reason: "RESTOCK",
      referenceId: reason,
      createdAt: new Date(),
    });

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "INVENTORY_RESTOCKED",
      resource: "INVENTORY",
      resourceId: saved.id,
      payload: { outletId, variantId, quantityAdded: quantity, newAvailable: saved.quantityAvailable },
    });

    return saved;
  }

  async reserveStockForCredit(
    tenantId: string,
    outletId: string,
    variantId: string,
    quantity: number,
    contractId: string,
    actorId: string
  ): Promise<IInventoryModel> {
    const inv = await this.repo.getInventory(outletId, variantId);
    if (!inv || inv.quantityAvailable < quantity) {
      throw new Error(
        `Stok tidak mencukupi untuk reservasi kredit. Tersedia: ${inv?.quantityAvailable ?? 0}, diminta: ${quantity}`
      );
    }

    inv.quantityAvailable -= quantity;
    inv.quantityReserved += quantity;
    const saved = await this.repo.upsertInventory(inv);

    await this.repo.recordStockMovement({
      id: crypto.randomUUID(),
      inventoryId: saved.id,
      changeAmount: -quantity,
      reason: "RESERVE_CREDIT",
      referenceId: contractId,
      createdAt: new Date(),
    });

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "INVENTORY_RESERVED_FOR_CREDIT",
      resource: "INVENTORY",
      resourceId: saved.id,
      payload: { outletId, variantId, quantity, contractId },
    });

    return saved;
  }

  async releaseReservation(
    tenantId: string,
    outletId: string,
    variantId: string,
    quantity: number,
    referenceId: string,
    actorId: string
  ): Promise<IInventoryModel> {
    const inv = await this.repo.getInventory(outletId, variantId);
    if (!inv || inv.quantityReserved < quantity) {
      throw new Error("Kuantitas reservasi yang hendak dibatalkan melebihi stok yang ditahan");
    }

    inv.quantityReserved -= quantity;
    inv.quantityAvailable += quantity;
    const saved = await this.repo.upsertInventory(inv);

    await this.repo.recordStockMovement({
      id: crypto.randomUUID(),
      inventoryId: saved.id,
      changeAmount: quantity,
      reason: "RELEASE_RESERVATION",
      referenceId,
      createdAt: new Date(),
    });

    return saved;
  }

  async directSaleDeduct(
    tenantId: string,
    outletId: string,
    variantId: string,
    quantity: number,
    orderId: string,
    actorId: string
  ): Promise<IInventoryModel> {
    const inv = await this.repo.getInventory(outletId, variantId);
    if (!inv || inv.quantityAvailable < quantity) {
      throw new Error(
        `Stok tidak mencukupi untuk penjualan kasir. Tersedia: ${inv?.quantityAvailable ?? 0}, diminta: ${quantity}`
      );
    }

    inv.quantityAvailable -= quantity;
    const saved = await this.repo.upsertInventory(inv);

    await this.repo.recordStockMovement({
      id: crypto.randomUUID(),
      inventoryId: saved.id,
      changeAmount: -quantity,
      reason: "SALE",
      referenceId: orderId,
      createdAt: new Date(),
    });

    return saved;
  }

  async fulfillReservedDelivery(
    tenantId: string,
    outletId: string,
    variantId: string,
    quantity: number,
    deliveryOrderId: string,
    actorId: string
  ): Promise<IInventoryModel> {
    const inv = await this.repo.getInventory(outletId, variantId);
    if (!inv || inv.quantityReserved < quantity) {
      throw new Error("Kuantitas pengiriman melebihi stok yang direservasi");
    }

    inv.quantityReserved -= quantity;
    const saved = await this.repo.upsertInventory(inv);

    await this.repo.recordStockMovement({
      id: crypto.randomUUID(),
      inventoryId: saved.id,
      changeAmount: -quantity,
      reason: "DELIVERED",
      referenceId: deliveryOrderId,
      createdAt: new Date(),
    });

    return saved;
  }
}
