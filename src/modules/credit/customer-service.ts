import {
  CreateCreditCustomerInput,
  CreateCreditCustomerSchema,
  DocumentType,
} from "./validators";
import {
  encryptPii,
  decryptPii,
  generateNikBlindIndex,
  maskNik,
  maskPhone,
  maskName,
} from "./encryption";
import {
  AppError,
  DuplicateCustomerError,
  TenantMismatchError,
  NotFoundError,
  UnauthorizedAccessError,
  CreditLimitExceededError,
} from "@/shared/errors";
import { DocumentStorageService } from "@/server/storage/document-storage";
import { AuditLogger } from "@/modules/audit/audit-logger";

export interface ICreditCustomerModel {
  id: string;
  tenantId: string;
  nikBlindIndex: string;
  encryptedNik: string;
  encryptedFullName: string;
  encryptedPhone: string;
  encryptedAddressKtp: string;
  encryptedAddressDom: string;
  occupation?: string | null;
  monthlyIncome: bigint;
  emergencyContact?: unknown;
  guarantor?: unknown;
  creditScoreInternal: number;
  creditLimit: bigint;
  activeDebtBalance: bigint;
  totalLateDays: number;
  isBlacklisted: boolean;
  pdpConsentGivenAt: Date;
  pdpConsentIpAddress?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomerDocumentModel {
  id: string;
  customerId: string;
  documentType: string;
  storageKey: string;
  fileHashSha256: string;
  uploadedAt: Date;
}

export interface ICustomerRepository {
  findByBlindIndex(tenantId: string, blindIndex: string): Promise<ICreditCustomerModel | null>;
  findById(tenantId: string, id: string): Promise<ICreditCustomerModel | null>;
  create(customer: Omit<ICreditCustomerModel, "id" | "createdAt" | "updatedAt">): Promise<ICreditCustomerModel>;
  update(tenantId: string, id: string, data: Partial<ICreditCustomerModel>): Promise<ICreditCustomerModel>;
  createDocument(doc: Omit<ICustomerDocumentModel, "id" | "uploadedAt">): Promise<ICustomerDocumentModel>;
  findDocumentsByCustomer(customerId: string): Promise<ICustomerDocumentModel[]>;
  findDocumentById(id: string): Promise<ICustomerDocumentModel | null>;
}

export interface UserContext {
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "SALES" | "WAREHOUSE" | "COLLECTOR";
  ipAddress?: string;
  userAgent?: string;
}

export class InMemoryCustomerRepository implements ICustomerRepository {
  public customers: ICreditCustomerModel[] = [];
  public documents: ICustomerDocumentModel[] = [];

  async findByBlindIndex(tenantId: string, blindIndex: string): Promise<ICreditCustomerModel | null> {
    return this.customers.find((c) => c.tenantId === tenantId && c.nikBlindIndex === blindIndex) || null;
  }

  async findById(tenantId: string, id: string): Promise<ICreditCustomerModel | null> {
    return this.customers.find((c) => c.tenantId === tenantId && c.id === id) || null;
  }

  async create(data: Omit<ICreditCustomerModel, "id" | "createdAt" | "updatedAt">): Promise<ICreditCustomerModel> {
    const customer: ICreditCustomerModel = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.customers.push(customer);
    return customer;
  }

  async update(tenantId: string, id: string, data: Partial<ICreditCustomerModel>): Promise<ICreditCustomerModel> {
    const idx = this.customers.findIndex((c) => c.tenantId === tenantId && c.id === id);
    if (idx === -1) throw new NotFoundError("Data Pelanggan Kredit", id);
    this.customers[idx] = { ...this.customers[idx], ...data, updatedAt: new Date() };
    return this.customers[idx];
  }

  async createDocument(doc: Omit<ICustomerDocumentModel, "id" | "uploadedAt">): Promise<ICustomerDocumentModel> {
    const document: ICustomerDocumentModel = {
      ...doc,
      id: crypto.randomUUID(),
      uploadedAt: new Date(),
    };
    this.documents.push(document);
    return document;
  }

  async findDocumentsByCustomer(customerId: string): Promise<ICustomerDocumentModel[]> {
    return this.documents.filter((d) => d.customerId === customerId);
  }

  async findDocumentById(id: string): Promise<ICustomerDocumentModel | null> {
    return this.documents.find((d) => d.id === id) || null;
  }
}

export class CreditCustomerService {
  constructor(
    private customerRepo: ICustomerRepository,
    private storageService: DocumentStorageService,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Mendaftarkan pelanggan kredit baru dengan enkripsi PII dan Blind Index
   */
  async registerCustomer(input: CreateCreditCustomerInput, context: UserContext): Promise<{
    id: string;
    maskedNik: string;
    fullName: string;
    maskedPhone: string;
    creditLimit: bigint;
    creditScoreInternal: number;
  }> {
    const validated = CreateCreditCustomerSchema.parse(input);

    // 1. Cek duplikasi NIK via Blind Index (HMAC-SHA256)
    const blindIndex = generateNikBlindIndex(validated.nik, context.tenantId);
    const existing = await this.customerRepo.findByBlindIndex(context.tenantId, blindIndex);
    if (existing) {
      throw new DuplicateCustomerError(
        "Pelanggan dengan NIK ini sudah terdaftar di sistem outlet/tenant ini"
      );
    }

    // 2. Enkripsi data sensitif (AES-256-GCM)
    const encryptedNik = encryptPii(validated.nik);
    const encryptedFullName = encryptPii(validated.fullName);
    const encryptedPhone = encryptPii(validated.phone);
    const encryptedAddressKtp = encryptPii(validated.addressKtp);
    const encryptedAddressDom = encryptPii(validated.addressDom);

    // 3. Simpan ke database terisolasi
    const customer = await this.customerRepo.create({
      tenantId: context.tenantId,
      nikBlindIndex: blindIndex,
      encryptedNik,
      encryptedFullName,
      encryptedPhone,
      encryptedAddressKtp,
      encryptedAddressDom,
      occupation: validated.occupation,
      monthlyIncome: validated.monthlyIncome,
      emergencyContact: validated.emergencyContact,
      guarantor: validated.guarantor,
      creditScoreInternal: 100, // Skor default awal nasabah bersih
      creditLimit: validated.creditLimit || 15000000n,
      activeDebtBalance: 0n,
      totalLateDays: 0,
      isBlacklisted: false,
      pdpConsentGivenAt: new Date(),
      pdpConsentIpAddress: context.ipAddress || null,
    });

    // 4. Catat Audit Log
    await this.auditLogger.log({
      tenantId: context.tenantId,
      userId: context.userId,
      action: "CREATE_CREDIT_CUSTOMER",
      resource: "CreditCustomer",
      resourceId: customer.id,
      payload: {
        maskedNik: maskNik(validated.nik),
        creditLimit: customer.creditLimit.toString(),
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      id: customer.id,
      maskedNik: maskNik(validated.nik),
      fullName: validated.fullName,
      maskedPhone: maskPhone(validated.phone),
      creditLimit: customer.creditLimit,
      creditScoreInternal: customer.creditScoreInternal,
    };
  }

  /**
   * Upload dan tautkan berkas verifikasi kredit (KTP, Selfie, Slip Gaji, KK)
   */
  async uploadCustomerDocument(
    params: {
      customerId: string;
      documentType: DocumentType;
      fileBuffer: Buffer;
      originalFilename: string;
      mimeType: string;
    },
    context: UserContext
  ): Promise<ICustomerDocumentModel> {
    // 1. Pastikan customer ada dan milik tenant yang sama
    const customer = await this.customerRepo.findById(context.tenantId, params.customerId);
    if (!customer) {
      throw new NotFoundError("Data Pelanggan Kredit", params.customerId);
    }
    if (customer.tenantId !== context.tenantId) {
      throw new TenantMismatchError();
    }

    // 2. Simpan dokumen dengan validasi integritas
    const storageResult = await this.storageService.uploadAndSecureDocument({
      buffer: params.fileBuffer,
      originalFilename: params.originalFilename,
      mimeType: params.mimeType,
      documentType: params.documentType,
      customerId: customer.id,
      tenantId: context.tenantId,
    });

    // 3. Catat di database
    const doc = await this.customerRepo.createDocument({
      customerId: customer.id,
      documentType: params.documentType,
      storageKey: storageResult.storageKey,
      fileHashSha256: storageResult.fileHashSha256,
    });

    // 4. Catat Audit Log
    await this.auditLogger.log({
      tenantId: context.tenantId,
      userId: context.userId,
      action: "UPLOAD_CUSTOMER_DOC",
      resource: "CustomerDocument",
      resourceId: doc.id,
      payload: {
        customerId: customer.id,
        documentType: params.documentType,
        sha256: storageResult.fileHashSha256,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return doc;
  }

  /**
   * Akses dokumen dengan audit log ketat dan pemeriksaan RBAC
   */
  async getDocumentContent(
    documentId: string,
    context: UserContext
  ): Promise<{ buffer: Buffer; documentType: string; customerId: string }> {
    const doc = await this.customerRepo.findDocumentById(documentId);
    if (!doc) {
      throw new NotFoundError("Dokumen Nasabah", documentId);
    }

    // Pastikan customer milik tenant user
    const customer = await this.customerRepo.findById(context.tenantId, doc.customerId);
    if (!customer || customer.tenantId !== context.tenantId) {
      throw new TenantMismatchError("Tidak memiliki akses ke dokumen tenant lain");
    }

    // RBAC: Hanya OWNER, MANAGER, atau SALES/CASHIER yang berwenang
    const allowedRoles = ["OWNER", "MANAGER", "SALES", "CASHIER"];
    if (!allowedRoles.includes(context.role)) {
      throw new UnauthorizedAccessError(
        `Role ${context.role} tidak memiliki hak akses untuk membuka berkas kredit nasabah`
      );
    }

    // Ambil isi dokumen dengan verifikasi integritas hash
    const buffer = await this.storageService.retrieveDocument(doc.storageKey, doc.fileHashSha256);

    // WAJIB: Audit log setiap kali dokumen dibuka
    await this.auditLogger.log({
      tenantId: context.tenantId,
      userId: context.userId,
      action: "VIEW_CUSTOMER_DOC",
      resource: "CustomerDocument",
      resourceId: doc.id,
      payload: {
        customerId: customer.id,
        documentType: doc.documentType,
        viewerRole: context.role,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      buffer,
      documentType: doc.documentType,
      customerId: doc.customerId,
    };
  }

  /**
   * Mengambil detail nasabah (dengan opsi dekripsi penuh untuk Manager/Owner atau masking untuk Sales/Kasir)
   */
  async getCustomerProfile(
    customerId: string,
    context: UserContext
  ): Promise<{
    id: string;
    nik: string;
    fullName: string;
    phone: string;
    addressKtp: string;
    addressDom: string;
    monthlyIncome: bigint;
    creditLimit: bigint;
    activeDebtBalance: bigint;
    availableCreditLimit: bigint;
    creditScoreInternal: number;
    isBlacklisted: boolean;
    documents: ICustomerDocumentModel[];
  }> {
    const customer = await this.customerRepo.findById(context.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError("Data Pelanggan Kredit", customerId);
    }
    if (customer.tenantId !== context.tenantId) {
      throw new TenantMismatchError("Akses ditolak: Data pelanggan bukan milik tenant Anda");
    }

    const isHighPrivilege = context.role === "OWNER" || context.role === "MANAGER";

    const rawNik = decryptPii(customer.encryptedNik);
    const rawName = decryptPii(customer.encryptedFullName);
    const rawPhone = decryptPii(customer.encryptedPhone);
    const rawAddressKtp = decryptPii(customer.encryptedAddressKtp);
    const rawAddressDom = decryptPii(customer.encryptedAddressDom);

    const documents = await this.customerRepo.findDocumentsByCustomer(customer.id);
    const availableCreditLimit =
      customer.creditLimit > customer.activeDebtBalance
        ? customer.creditLimit - customer.activeDebtBalance
        : 0n;

    // Catat log audit pembacaan data pribadi
    await this.auditLogger.log({
      tenantId: context.tenantId,
      userId: context.userId,
      action: "VIEW_CUSTOMER_PROFILE",
      resource: "CreditCustomer",
      resourceId: customer.id,
      payload: { viewerRole: context.role, isHighPrivilege },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      id: customer.id,
      nik: isHighPrivilege ? rawNik : maskNik(rawNik),
      fullName: isHighPrivilege ? rawName : maskName(rawName),
      phone: isHighPrivilege ? rawPhone : maskPhone(rawPhone),
      addressKtp: isHighPrivilege ? rawAddressKtp : "********************",
      addressDom: isHighPrivilege ? rawAddressDom : "********************",
      monthlyIncome: customer.monthlyIncome,
      creditLimit: customer.creditLimit,
      activeDebtBalance: customer.activeDebtBalance,
      availableCreditLimit,
      creditScoreInternal: customer.creditScoreInternal,
      isBlacklisted: customer.isBlacklisted,
      documents,
    };
  }

  /**
   * Validasi kelayakan plafon kredit sebelum membuat pengajuan
   */
  async validateCreditEligibility(
    customerId: string,
    requestedPrincipal: bigint,
    context: UserContext
  ): Promise<{ isEligible: boolean; remainingLimit: bigint; warning?: string }> {
    const customer = await this.customerRepo.findById(context.tenantId, customerId);
    if (!customer) {
      throw new NotFoundError("Data Pelanggan Kredit", customerId);
    }

    if (customer.isBlacklisted) {
      throw new AppError("Pelanggan masuk dalam daftar hitam (blacklist) internal", 422, "CUSTOMER_BLACKLISTED");
    }

    const availableLimit =
      customer.creditLimit > customer.activeDebtBalance
        ? customer.creditLimit - customer.activeDebtBalance
        : 0n;

    if (requestedPrincipal > availableLimit) {
      throw new CreditLimitExceededError(requestedPrincipal, availableLimit);
    }

    let warning: string | undefined;
    if (customer.creditScoreInternal < 70) {
      warning = "Peringatan: Skor kredit internal nasabah di bawah 70. Diperlukan review khusus manager.";
    }

    return {
      isEligible: true,
      remainingLimit: availableLimit - requestedPrincipal,
      warning,
    };
  }
}
