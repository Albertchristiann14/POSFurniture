import { describe, it, expect, beforeEach } from "vitest";
import { DeliveryService, InMemoryDeliveryRepository } from "@/modules/pos/delivery-service";
import { AuditLogger, InMemoryAuditRepository } from "@/modules/audit/audit-logger";

describe("Fase 7: Furniture Delivery Service & State Progression", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let auditLogger: AuditLogger;
  let deliveryService: DeliveryService;

  const tenantId = "tenant-pos-1";
  const actorId = "user-logistics-admin";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    auditLogger = new AuditLogger(new InMemoryAuditRepository());
    deliveryService = new DeliveryService(deliveryRepo, auditLogger);
  });

  it("Menjadwalkan pengiriman furniture dengan instruksi perakitan di tempat", async () => {
    const delivery = await deliveryService.scheduleDelivery(tenantId, actorId, {
      orderId: "ord-1001",
      recipientName: "Bambang Soediro",
      recipientPhone: "081234567890",
      shippingAddress: "Jl. Margonda Raya No. 45, Beji, Depok",
      scheduledDate: new Date("2026-11-10T10:00:00Z"),
      assemblyRequired: true,
      assemblyNotes: "Rakit lemari 3 pintu di lantai 2, tangga sempit mohon hati-hati",
    });

    expect(delivery.id).toBeDefined();
    expect(delivery.status).toBe("SCHEDULED");
    expect(delivery.assemblyRequired).toBe(true);
  });

  it("Memberangkatkan armada pengiriman (OUT_FOR_DELIVERY) dengan data supir dan plat nomor", async () => {
    const delivery = await deliveryService.scheduleDelivery(tenantId, actorId, {
      orderId: "ord-1002",
      recipientName: "Siti Rahma",
      recipientPhone: "081298765432",
      shippingAddress: "Cluster Graha Indah Blok C1 No. 8",
      scheduledDate: new Date(),
    });

    const dispatched = await deliveryService.dispatchDelivery(
      tenantId,
      delivery.id,
      "Pak Joko",
      "B 9821 TKO",
      actorId
    );

    expect(dispatched.status).toBe("OUT_FOR_DELIVERY");
    expect(dispatched.driverName).toBe("Pak Joko");
    expect(dispatched.licensePlate).toBe("B 9821 TKO");
  });

  it("Konfirmasi serah terima barang (DELIVERED) dengan bukti foto dan catatan penerima", async () => {
    const delivery = await deliveryService.scheduleDelivery(tenantId, actorId, {
      orderId: "ord-1003",
      recipientName: "Ahmad Dani",
      recipientPhone: "081311223344",
      shippingAddress: "Jl. Tebet Barat Dalam VII No. 12",
      scheduledDate: new Date(),
    });

    await deliveryService.dispatchDelivery(tenantId, delivery.id, "Pak Joko", "B 9821 TKO", actorId);

    const completed = await deliveryService.confirmDelivered(
      tenantId,
      delivery.id,
      {
        proofPhotoUrl: "https://storage.kreviapos.id/proof/delivery-ord-1003.jpg",
        digitalSignatureUrl: "https://storage.kreviapos.id/signatures/sig-1003.png",
        notes: "Barang sudah dicek, sofa mulus tidak ada goresan",
      },
      actorId
    );

    expect(completed.status).toBe("DELIVERED");
    expect(completed.receivedAt).toBeDefined();
    expect(completed.proofPhotoUrl).toBe("https://storage.kreviapos.id/proof/delivery-ord-1003.jpg");
  });

  it("Menolak transisi tidak valid (misal: langsung konfirmasi DELIVERED sebelum OUT_FOR_DELIVERY)", async () => {
    const delivery = await deliveryService.scheduleDelivery(tenantId, actorId, {
      orderId: "ord-1004",
      recipientName: "Dewi",
      recipientPhone: "0815555555",
      shippingAddress: "Kemang Raya No. 88",
      scheduledDate: new Date(),
    });

    await expect(
      deliveryService.confirmDelivered(
        tenantId,
        delivery.id,
        { proofPhotoUrl: "https://example.com/photo.jpg" },
        actorId
      )
    ).rejects.toThrow("Konfirmasi serah terima hanya valid saat pengiriman OUT_FOR_DELIVERY");
  });
});
