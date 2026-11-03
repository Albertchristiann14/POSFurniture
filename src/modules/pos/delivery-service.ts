import { AuditLogger } from "@/modules/audit/audit-logger";

export type DeliveryStatus = "SCHEDULED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED";

export interface IDeliveryOrderModel {
  id: string;
  orderId: string;
  tenantId: string;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  geoCoordinates?: string;
  scheduledDate: Date;
  driverName?: string;
  licensePlate?: string;
  assemblyRequired: boolean;
  assemblyNotes?: string;
  status: DeliveryStatus;
  receivedAt?: Date;
  proofPhotoUrl?: string;
  digitalSignatureUrl?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeliveryRepository {
  createDelivery(delivery: IDeliveryOrderModel): Promise<IDeliveryOrderModel>;
  findDeliveryById(id: string): Promise<IDeliveryOrderModel | null>;
  findDeliveryByOrderId(orderId: string): Promise<IDeliveryOrderModel | null>;
  updateDelivery(delivery: IDeliveryOrderModel): Promise<IDeliveryOrderModel>;
  listDeliveries(tenantId: string, filter?: { status?: DeliveryStatus; scheduledDate?: Date }): Promise<IDeliveryOrderModel[]>;
}

export class InMemoryDeliveryRepository implements IDeliveryRepository {
  private deliveries = new Map<string, IDeliveryOrderModel>();

  async createDelivery(delivery: IDeliveryOrderModel): Promise<IDeliveryOrderModel> {
    this.deliveries.set(delivery.id, { ...delivery });
    return delivery;
  }

  async findDeliveryById(id: string): Promise<IDeliveryOrderModel | null> {
    return this.deliveries.get(id) || null;
  }

  async findDeliveryByOrderId(orderId: string): Promise<IDeliveryOrderModel | null> {
    for (const d of this.deliveries.values()) {
      if (d.orderId === orderId) return d;
    }
    return null;
  }

  async updateDelivery(delivery: IDeliveryOrderModel): Promise<IDeliveryOrderModel> {
    this.deliveries.set(delivery.id, { ...delivery });
    return delivery;
  }

  async listDeliveries(
    tenantId: string,
    filter?: { status?: DeliveryStatus }
  ): Promise<IDeliveryOrderModel[]> {
    return Array.from(this.deliveries.values()).filter((d) => {
      if (d.tenantId !== tenantId) return false;
      if (filter?.status && d.status !== filter.status) return false;
      return true;
    });
  }
}

export class DeliveryService {
  constructor(
    private readonly repo: IDeliveryRepository,
    private readonly auditLogger: AuditLogger
  ) {}

  async scheduleDelivery(
    tenantId: string,
    actorId: string,
    data: {
      orderId: string;
      recipientName: string;
      recipientPhone: string;
      shippingAddress: string;
      geoCoordinates?: string;
      scheduledDate: Date;
      driverName?: string;
      licensePlate?: string;
      assemblyRequired?: boolean;
      assemblyNotes?: string;
    }
  ): Promise<IDeliveryOrderModel> {
    const existing = await this.repo.findDeliveryByOrderId(data.orderId);
    if (existing) {
      throw new Error(`Pengiriman untuk Order ID '${data.orderId}' sudah pernah dijadwalkan`);
    }

    const delivery: IDeliveryOrderModel = {
      id: crypto.randomUUID(),
      tenantId,
      orderId: data.orderId,
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
      shippingAddress: data.shippingAddress,
      geoCoordinates: data.geoCoordinates,
      scheduledDate: data.scheduledDate,
      driverName: data.driverName,
      licensePlate: data.licensePlate,
      assemblyRequired: data.assemblyRequired ?? false,
      assemblyNotes: data.assemblyNotes,
      status: "SCHEDULED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const saved = await this.repo.createDelivery(delivery);

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "DELIVERY_SCHEDULED",
      resource: "DELIVERY_ORDER",
      resourceId: saved.id,
      payload: {
        orderId: data.orderId,
        recipient: data.recipientName,
        scheduledDate: data.scheduledDate.toISOString(),
      },
    });

    return saved;
  }

  async dispatchDelivery(
    tenantId: string,
    deliveryId: string,
    driverName: string,
    licensePlate: string,
    actorId: string
  ): Promise<IDeliveryOrderModel> {
    const delivery = await this.repo.findDeliveryById(deliveryId);
    if (!delivery || delivery.tenantId !== tenantId) {
      throw new Error("Surat jalan pengiriman tidak ditemukan");
    }

    if (delivery.status !== "SCHEDULED") {
      throw new Error(`Tidak dapat memberangkatkan pengiriman dengan status ${delivery.status}`);
    }

    delivery.status = "OUT_FOR_DELIVERY";
    delivery.driverName = driverName;
    delivery.licensePlate = licensePlate;
    delivery.updatedAt = new Date();

    const updated = await this.repo.updateDelivery(delivery);

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "DELIVERY_OUT_FOR_DELIVERY",
      resource: "DELIVERY_ORDER",
      resourceId: updated.id,
      payload: { driverName, licensePlate },
    });

    return updated;
  }

  async confirmDelivered(
    tenantId: string,
    deliveryId: string,
    proof: {
      proofPhotoUrl: string;
      digitalSignatureUrl?: string;
      notes?: string;
    },
    actorId: string
  ): Promise<IDeliveryOrderModel> {
    const delivery = await this.repo.findDeliveryById(deliveryId);
    if (!delivery || delivery.tenantId !== tenantId) {
      throw new Error("Surat jalan pengiriman tidak ditemukan");
    }

    if (delivery.status !== "OUT_FOR_DELIVERY") {
      throw new Error(`Konfirmasi serah terima hanya valid saat pengiriman OUT_FOR_DELIVERY`);
    }

    delivery.status = "DELIVERED";
    delivery.receivedAt = new Date();
    delivery.proofPhotoUrl = proof.proofPhotoUrl;
    delivery.digitalSignatureUrl = proof.digitalSignatureUrl;
    if (proof.notes) {
      delivery.assemblyNotes = (delivery.assemblyNotes ? delivery.assemblyNotes + " | " : "") + proof.notes;
    }
    delivery.updatedAt = new Date();

    const updated = await this.repo.updateDelivery(delivery);

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "DELIVERY_COMPLETED",
      resource: "DELIVERY_ORDER",
      resourceId: updated.id,
      payload: { receivedAt: delivery.receivedAt.toISOString() },
    });

    return updated;
  }

  async markDeliveryFailed(
    tenantId: string,
    deliveryId: string,
    reason: string,
    actorId: string
  ): Promise<IDeliveryOrderModel> {
    const delivery = await this.repo.findDeliveryById(deliveryId);
    if (!delivery || delivery.tenantId !== tenantId) {
      throw new Error("Surat jalan pengiriman tidak ditemukan");
    }

    delivery.status = "FAILED";
    delivery.failureReason = reason;
    delivery.updatedAt = new Date();

    const updated = await this.repo.updateDelivery(delivery);

    await this.auditLogger.log({
      tenantId,
      userId: actorId,
      action: "DELIVERY_FAILED",
      resource: "DELIVERY_ORDER",
      resourceId: updated.id,
      payload: { reason },
    });

    return updated;
  }
}
